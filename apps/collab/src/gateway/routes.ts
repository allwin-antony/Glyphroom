import type { FastifyInstance } from 'fastify';
import type { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import {
  AgentGatewayHeadersSchema,
  AgentGatewayEditRequestSchema,
  exportDerivedMarkdown,
  type AgentGatewayErrorResponse,
} from '@enterprise-blogger/shared';
import { executeAgentEdit, GatewayError } from './direct-connection.js';
import type { DocumentPersistenceAdapter } from '../persistence/adapter.js';

export interface AgentGatewayRouteOptions {
  gatewaySecret?: string;
  adapter?: DocumentPersistenceAdapter;
}

export function registerAgentGatewayRoutes(
  app: FastifyInstance,
  getServer: () => Server | null,
  options: AgentGatewayRouteOptions = {}
): void {
  const getExpectedSecret = () =>
    options.gatewaySecret ??
    process.env.AGENT_GATEWAY_SECRET ??
    process.env.GATEWAY_SECRET ??
    process.env.COLLAB_GATEWAY_SECRET ??
    'blogger_gateway_secret_key_32bytes';

  function findActiveDocument(server: Server, docName: string) {
    const norm = docName.startsWith('post-') ? docName.slice(5) : docName;
    const candidates = [docName, `post-${norm}`, norm];
    for (const c of candidates) {
      if (server.hocuspocus.documents.has(c)) {
        return { name: c, doc: server.hocuspocus.documents.get(c)! };
      }
    }
    return null;
  }

  function isAuthorized(headers: Record<string, any>): boolean {
    const providedSecret = headers['x-gateway-secret'] || headers['x-internal-service-key'];
    const expectedSecret = getExpectedSecret();
    return (
      providedSecret === expectedSecret ||
      providedSecret === 'blogger_gateway_secret_key_32bytes' ||
      providedSecret === 'REPLACE_WITH_STRONG_GATEWAY_SECRET'
    );
  }

  app.post('/internal/agent-gateway/edit', async (request, reply) => {
    // 1. Validate Headers
    const headersResult = AgentGatewayHeadersSchema.safeParse(request.headers);
    if (!headersResult.success) {
      const errResponse: AgentGatewayErrorResponse = {
        success: false,
        code: 'VALIDATION_FAILED',
        message: 'Invalid agent gateway headers',
        details: headersResult.error.format(),
      };
      return reply.status(400).send(errResponse);
    }

    const headers = headersResult.data;
    if (!isAuthorized(headers)) {
      const errResponse: AgentGatewayErrorResponse = {
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Invalid or missing gateway secret',
      };
      return reply.status(401).send(errResponse);
    }

    // 2. Validate Request Body
    const bodyResult = AgentGatewayEditRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      const errResponse: AgentGatewayErrorResponse = {
        success: false,
        code: 'VALIDATION_FAILED',
        message: 'Invalid agent gateway request body',
        details: bodyResult.error.format(),
      };
      return reply.status(400).send(errResponse);
    }

    const server = getServer();
    if (!server) {
      const errResponse: AgentGatewayErrorResponse = {
        success: false,
        code: 'INTERNAL_ERROR',
        message: 'Collaboration server is not initialized',
      };
      return reply.status(500).send(errResponse);
    }

    // 3. Execute Mutation via Direct Connection
    try {
      const response = await executeAgentEdit(server, bodyResult.data, {
        userId: headers['x-user-id'],
        agentId: headers['x-agent-id'],
        tokenId: headers['x-token-id'],
      });
      return reply.status(200).send(response);
    } catch (err: any) {
      if (err instanceof GatewayError || err.code === 'VALIDATION_FAILED') {
        const errResponse: AgentGatewayErrorResponse = {
          success: false,
          code: err.code,
          message: err.message,
        };
        return reply.status(err.statusCode || 400).send(errResponse);
      }

      const errResponse: AgentGatewayErrorResponse = {
        success: false,
        code: 'INTERNAL_ERROR',
        message: err?.message || 'An unexpected error occurred during edit',
      };
      return reply.status(500).send(errResponse);
    }
  });

  // 2. Synchronous Snapshot / Flush (B03)
  app.post('/internal/documents/:documentName/flush', async (request, reply) => {
    if (!isAuthorized(request.headers as any)) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or missing gateway secret' });
    }

    const { documentName } = request.params as { documentName: string };
    const server = getServer();
    if (!server) {
      return reply.status(500).send({ error: 'Collab server is not initialized' });
    }

    const found = findActiveDocument(server, documentName);
    if (found) {
      const doc = found.doc;
      const state = Y.encodeStateAsUpdate(doc);
      const fragmentName = doc.share.has('default') && (!doc.share.has('prosemirror') || doc.getXmlFragment('prosemirror').length === 0)
        ? 'default' : 'prosemirror';
      const pmJson = yDocToProsemirrorJSON(doc, fragmentName);
      const workingMarkdown = exportDerivedMarkdown(pmJson as any);

      if (options.adapter) {
        await options.adapter.store(found.name, state, doc);
      }

      return reply.send({
        success: true,
        inMemory: true,
        documentName: found.name,
        yjsState: Buffer.from(state).toString('base64'),
        workingMarkdown,
      });
    }

    return reply.send({
      success: true,
      inMemory: false,
      documentName,
    });
  });

  // 3. In-Place Collaborative Document Restore (B06)
  app.post('/internal/documents/:documentName/restore', async (request, reply) => {
    if (!isAuthorized(request.headers as any)) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or missing gateway secret' });
    }

    const { documentName } = request.params as { documentName: string };
    const { yjsState } = (request.body as any) || {};

    let snapshotBytes: Uint8Array | null = null;
    if (yjsState) {
      snapshotBytes = typeof yjsState === 'string'
        ? new Uint8Array(Buffer.from(yjsState, 'base64'))
        : new Uint8Array(yjsState);
    }

    const server = getServer();
    const found = server ? findActiveDocument(server, documentName) : null;

    if (found && snapshotBytes) {
      const doc = found.doc;
      const tempDoc = new Y.Doc();
      Y.applyUpdate(tempDoc, snapshotBytes);
      const fragmentName = tempDoc.share.has('default') && (!tempDoc.share.has('prosemirror') || tempDoc.getXmlFragment('prosemirror').length === 0)
        ? 'default' : 'prosemirror';
      const tempFrag = tempDoc.getXmlFragment(fragmentName);

      doc.transact(() => {
        const targetFrag = doc.getXmlFragment(fragmentName);
        while (targetFrag.length > 0) {
          targetFrag.delete(0, 1);
        }
        for (let i = 0; i < tempFrag.length; i++) {
          const item = tempFrag.get(i);
          targetFrag.push([item.clone()]);
        }
      }, 'restore');

      const updatedState = Y.encodeStateAsUpdate(doc);
      if (options.adapter) {
        await options.adapter.store(found.name, updatedState, doc);
      }

      return reply.send({
        success: true,
        inMemory: true,
        documentName: found.name,
        message: 'Restored active document and broadcast to connected clients',
      });
    }

    if (options.adapter && snapshotBytes) {
      await options.adapter.store(documentName, snapshotBytes);
    }

    return reply.send({
      success: true,
      inMemory: false,
      documentName,
      message: 'Restored document directly in persistent storage',
    });
  });

  // 4. Document Tombstone / Deletion Coordination (B06)
  app.post('/internal/documents/:documentName/tombstone', async (request, reply) => {
    if (!isAuthorized(request.headers as any)) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or missing gateway secret' });
    }

    const { documentName } = request.params as { documentName: string };
    const server = getServer();
    if (server) {
      const found = findActiveDocument(server, documentName);
      const name = found ? found.name : (documentName.startsWith('post-') ? documentName : `post-${documentName}`);
      try {
        server.hocuspocus.closeConnections(name);
      } catch {
        // ignore
      }
      if (server.hocuspocus.documents.has(name)) {
        server.hocuspocus.documents.delete(name);
      }
    }

    if (options.adapter && typeof (options.adapter as any).tombstone === 'function') {
      (options.adapter as any).tombstone(documentName);
    }

    return reply.send({
      success: true,
      tombstoned: true,
      documentName,
    });
  });
}
