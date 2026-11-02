import { Server, type onAuthenticatePayload, type ServerConfiguration } from '@hocuspocus/server';
import fastify, { type FastifyInstance } from 'fastify';
import * as Y from 'yjs';
import type { DocumentPersistenceAdapter } from './persistence/adapter.js';
import { InMemoryPersistenceAdapter } from './persistence/in-memory.js';
import { PostgresPersistenceAdapter } from './persistence/postgres.js';
import { createAuthHooks, type CollabAuthOptions } from './auth/hooks.js';
import { registerAgentGatewayRoutes } from './gateway/routes.js';
import { decodeDocumentState, DocumentLifecycle } from './document-lifecycle.js';

export interface CollabServerOptions {
  port?: number;
  address?: string;
  adapter?: DocumentPersistenceAdapter;
  redisUrl?: string;
  authOptions?: CollabAuthOptions;
  gatewaySecret?: string;
  debounceMs?: number;
  maxDebounceMs?: number;
  quiet?: boolean;
}

export interface CollabServerInstance {
  server: Server;
  fastify: FastifyInstance;
  adapter: DocumentPersistenceAdapter;
  lifecycle: DocumentLifecycle;
  readonly port: number;
  listen(): Promise<{ port: number; url: string }>;
  destroy(): Promise<void>;
}

/**
 * Creates and configures the Hocuspocus collaboration server instance,
 * co-hosting the Fastify HTTP gateway and health check on the same port.
 */
export async function createCollabServer(options: CollabServerOptions = {}): Promise<CollabServerInstance> {
  const adapter = options.adapter || new InMemoryPersistenceAdapter();
  const debounce = options.debounceMs ?? 3000;
  const maxDebounce = options.maxDebounceMs ?? 10000;
  const redisUrl = options.redisUrl || process.env.REDIS_URL;
  if (redisUrl) {
    throw new Error('Collaboration lifecycle requires a single instance; Redis clustering is not supported');
  }

  // 1. Initialize Fastify for HTTP endpoints (/healthz, agent gateway)
  const app = fastify({ logger: false });

  app.get('/healthz', async (_req, reply) => {
    const checks: Record<string, string> = {
      database: 'ok',
      hocuspocus: 'ok',
      redis: 'disabled',
    };

    let isHealthy = true;

    // Database check
    if (adapter instanceof PostgresPersistenceAdapter) {
      try {
        const dbStart = Date.now();
        await adapter.getPool().query('SELECT 1;');
        const latency = Date.now() - dbStart;
        checks.database = `connected (${latency}ms)`;
      } catch (err) {
        isHealthy = false;
        checks.database = `error: ${(err as Error).message}`;
      }
    } else {
      checks.database = 'in-memory (ok)';
    }

    // Collaboration engine check
    try {
      const docCount = server.hocuspocus.getDocumentsCount();
      const connCount = server.hocuspocus.getConnectionsCount();
      checks.hocuspocus = `active (documents: ${docCount}, connections: ${connCount})`;
    } catch (err) {
      isHealthy = false;
      checks.hocuspocus = `error: ${(err as Error).message}`;
    }

    const statusCode = isHealthy ? 200 : 503;
    return reply.status(statusCode).send({
      status: isHealthy ? 'healthy' : 'unhealthy',
      service: 'glyphroom-collab',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    });
  });

  app.get('/health', async (_req, reply) => reply.redirect('/healthz'));
  app.get('/readyz', async (_req, reply) => reply.redirect('/healthz'));

  let serverInstance: Server | null = null;
  const lifecycle = new DocumentLifecycle(() => serverInstance, adapter);
  registerAgentGatewayRoutes(app, () => serverInstance, {
    gatewaySecret: options.gatewaySecret,
    lifecycle,
  });

  await app.ready();

  // Authentication precedes any working-document sync, including warm rooms.
  const authHooks = createAuthHooks({
    ...options.authOptions,
  });
  const authenticate = async (data: onAuthenticatePayload) => {
    lifecycle.assertAvailable(data.documentName);
    const context = await authHooks.onAuthenticate(data);
    lifecycle.assertAvailable(data.documentName);
    return context;
  };

  const serverConfig: Partial<ServerConfiguration> = {
    port: options.port ?? 4000,
    address: options.address ?? '0.0.0.0',
    debounce,
    maxDebounce,
    unloadImmediately: false,
    quiet: options.quiet ?? true,
    // The bootstrap owns signals and must use the awaited lifecycle shutdown,
    // not Hocuspocus's native destroy path which swallows persistence failures.
    stopOnSignals: false,
    onAuthenticate: authenticate,
    async onTokenSync(data) {
      return authenticate({ ...data, request: data.connection.request, providerVersion: null });
    },
    async connected(data) {
      try {
        lifecycle.assertAvailable(data.documentName);
      } catch (error) {
        // A load admitted before deletion may finish connection setup later.
        data.connection.close({ code: 1013, reason: 'Document collaboration is unavailable' });
        throw error;
      }
    },
    async onLoadDocument(data) {
      await authHooks.onLoadDocument(data);
      try {
        const state = await adapter.fetch(data.documentName);
        if (state) {
          const snapshot = decodeDocumentState(state);
          try {
            Y.applyUpdate(data.document, Y.encodeStateAsUpdate(snapshot));
          } finally {
            snapshot.destroy();
          }
        }
      } catch {
        throw new Error('Document persistence is unavailable');
      }
    },
    async beforeHandleMessage(data) {
      await lifecycle.beforeMessage(data.documentName, data.connection, data.document);
    },
    async afterHandleMessage(data) {
      lifecycle.afterMessage(data.connection);
    },
    async onStoreDocument(data) {
      await lifecycle.store(data.documentName, data.document);
    },
    async onRequest({ request, response }) {
      const url = request.url || '';
      if (url.startsWith('/health') || url.startsWith('/readyz') || url.startsWith('/internal/')) {
        app.routing(request, response);
        throw undefined; // suppress default Hocuspocus 200 plain text response
      }
    },
  };

  const server = new Server(serverConfig);
  serverInstance = server;

  // Hocuspocus hooks alone don't cover the entire load/unload operation, and
  // direct transactions bypass WS hooks. Gate these public engine boundaries
  // too, so no load can install a room after a deletion acknowledgement.
  const engine = server.hocuspocus;
  const createDocument = engine.createDocument.bind(engine);
  engine.createDocument = (name, request, socketId, config, context) =>
    lifecycle.runMutation(name, () => createDocument(name, request, socketId, config, context));
  const unloadDocument = engine.unloadDocument.bind(engine);
  engine.unloadDocument = (document) => lifecycle.unload(document, () => unloadDocument(document));
  const openDirectConnection = engine.openDirectConnection.bind(engine);
  engine.openDirectConnection = async (name, context) => {
    const connection = await openDirectConnection(name, context);
    try {
      lifecycle.assertAvailable(name);
    } catch (error) {
      await connection.disconnect({ unloadImmediately: false });
      throw error;
    }
    const transact = connection.transact.bind(connection);
    connection.transact = (transaction) => lifecycle.runMutation(name, () => transact(transaction));
    return connection;
  };

  let destroying: Promise<void> | undefined;
  const destroy = (): Promise<void> => {
    destroying ??= (async () => {
      // Concurrent callers/signals share the same awaited durability barrier.
      await lifecycle.shutdown();
      await server.destroy();
      await app.close();
      if (!options.adapter) await adapter.destroy();
    })();
    return destroying;
  };

  return {
    server,
    fastify: app,
    adapter,
    lifecycle,
    get port() {
      return server.address.port;
    },
    async listen() {
      await server.listen();
      const port = server.address.port;
      return { port, url: `ws://127.0.0.1:${port}` };
    },
    destroy,
  };
}
