import { Server, type ServerConfiguration } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import { Redis } from '@hocuspocus/extension-redis';
import fastify, { type FastifyInstance } from 'fastify';
import type { DocumentPersistenceAdapter } from './persistence/adapter.js';
import { InMemoryPersistenceAdapter } from './persistence/in-memory.js';
import { PostgresPersistenceAdapter } from './persistence/postgres.js';
import { createAuthHooks, type CollabAuthOptions } from './auth/hooks.js';

export interface CollabServerOptions {
  port?: number;
  address?: string;
  adapter?: DocumentPersistenceAdapter;
  redisUrl?: string;
  authOptions?: CollabAuthOptions;
  debounceMs?: number;
  maxDebounceMs?: number;
  quiet?: boolean;
}

export interface CollabServerInstance {
  server: Server;
  fastify: FastifyInstance;
  adapter: DocumentPersistenceAdapter;
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

  // 1. Initialize Fastify for HTTP endpoints (/healthz, agent gateway)
  const app = fastify({ logger: false });

  app.get('/healthz', async (_req, reply) => {
    const checks: Record<string, string> = {
      database: 'ok',
      hocuspocus: 'ok',
      redis: redisUrl ? 'configured' : 'disabled',
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
      service: 'enterprise-blogger-collab',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    });
  });

  app.get('/health', async (_req, reply) => reply.redirect('/healthz'));
  app.get('/readyz', async (_req, reply) => reply.redirect('/healthz'));

  await app.ready();

  // 2. Configure Hocuspocus Extensions
  const extensions: any[] = [
    new Database({
      fetch: async ({ documentName }) => adapter.fetch(documentName),
      store: async ({ documentName, state, document }) => adapter.store(documentName, state, document),
    }),
  ];

  // Optional Redis Pub/Sub extension for multi-node clustering
  if (redisUrl) {
    try {
      const parsed = new URL(redisUrl);
      extensions.push(
        new Redis({
          host: parsed.hostname,
          port: parseInt(parsed.port || '6379', 10),
          prefix: 'enterprise_blogger:collab',
        }),
      );
    } catch {
      extensions.push(
        new Redis({
          host: '127.0.0.1',
          port: 6379,
          prefix: 'enterprise_blogger:collab',
        }),
      );
    }
  }

  // 3. Configure Authentication and Authorization Hooks
  const authHooks = createAuthHooks(options.authOptions);

  const serverConfig: Partial<ServerConfiguration> = {
    port: options.port ?? 4000,
    address: options.address ?? '0.0.0.0',
    debounce,
    maxDebounce,
    unloadImmediately: false,
    quiet: options.quiet ?? true,
    extensions,
    onAuthenticate: authHooks.onAuthenticate,
    onLoadDocument: authHooks.onLoadDocument,
    async onRequest({ request, response }) {
      const url = request.url || '';
      if (url.startsWith('/health') || url.startsWith('/readyz') || url.startsWith('/internal/')) {
        app.routing(request, response);
        throw undefined; // suppress default Hocuspocus 200 plain text response
      }
    },
  };

  const server = new Server(serverConfig);

  let destroyed = false;
  const destroy = async () => {
    if (destroyed) return;
    destroyed = true;

    // Immediately flush any debounced stores queued in memory before closing
    try {
      server.hocuspocus.flushPendingStores();
    } catch {
      // ignore
    }

    await server.destroy();
    await app.close();
    if (!options.adapter) {
      await adapter.destroy();
    }
  };

  return {
    server,
    fastify: app,
    adapter,
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
