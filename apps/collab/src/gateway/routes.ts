import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Server } from '@hocuspocus/server';
import {
  AgentGatewayHeadersSchema,
  AgentGatewayEditRequestSchema,
  type AgentGatewayErrorResponse,
} from '@enterprise-blogger/shared';
import { executeAgentEdit, GatewayError } from './direct-connection.js';
import { DocumentLifecycle, DocumentLifecycleError } from '../document-lifecycle.js';

export interface AgentGatewayRouteOptions {
  gatewaySecret?: string;
  lifecycle?: DocumentLifecycle;
}

export function registerAgentGatewayRoutes(
  app: FastifyInstance,
  getServer: () => Server | null,
  options: AgentGatewayRouteOptions = {},
): void {
  const expectedSecret = options.gatewaySecret ?? process.env.COLLAB_GATEWAY_SECRET
    ?? process.env.GATEWAY_SECRET ?? process.env.AGENT_GATEWAY_SECRET;

  function authorize(headers: Record<string, unknown>, reply: FastifyReply, agentGateway = false): boolean {
    if (!expectedSecret) {
      reply.status(503).send({ success: false, code: agentGateway ? 'INTERNAL_ERROR' : 'UNAVAILABLE', message: 'Gateway authentication is not configured' });
      return false;
    }
    const provided = headers['x-gateway-secret'] ?? headers['x-internal-service-key'];
    if (typeof provided !== 'string' || !timingSafeEqual(
      createHash('sha256').update(provided).digest(),
      createHash('sha256').update(expectedSecret).digest(),
    )) {
      reply.status(401).send({ success: false, code: 'UNAUTHORIZED', message: 'Invalid or missing gateway secret' });
      return false;
    }
    return true;
  }

  function lifecycle(): DocumentLifecycle {
    if (!options.lifecycle) throw new DocumentLifecycleError('UNAVAILABLE', 'Document lifecycle is unavailable', 503);
    return options.lifecycle;
  }

  function lifecycleError(error: unknown, reply: FastifyReply) {
    if (error instanceof DocumentLifecycleError) {
      return reply.status(error.statusCode).send({
        success: false,
        code: error.code,
        message: error.message,
        outcomeUnknown: error.outcomeUnknown,
      });
    }
    return reply.status(503).send({ success: false, code: 'UNAVAILABLE', message: 'Document lifecycle failed', outcomeUnknown: true });
  }

  app.post('/internal/agent-gateway/edit', async (request, reply) => {
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
    if (!authorize(headers, reply, true)) return;
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
      return reply.status(503).send({ success: false, code: 'INTERNAL_ERROR', message: 'Collaboration server is unavailable' });
    }
    try {
      lifecycle().assertAvailable(bodyResult.data.documentId);
      const response = await executeAgentEdit(server, bodyResult.data, {
        userId: headers['x-user-id'],
        agentId: headers['x-agent-id'],
        tokenId: headers['x-token-id'],
      });
      return reply.status(200).send(response);
    } catch (error: any) {
      if (error instanceof DocumentLifecycleError) {
        // Preserve the shared agent-gateway error enum; lifecycle RPCs have
        // their own detailed dependency/conflict codes.
        const errResponse: AgentGatewayErrorResponse = {
          success: false,
          code: error.code === 'VALIDATION_FAILED' ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR',
          message: error.message,
        };
        return reply.status(error.statusCode).send(errResponse);
      }
      if (error instanceof GatewayError || error?.code === 'VALIDATION_FAILED') {
        const errResponse: AgentGatewayErrorResponse = { success: false, code: error.code, message: error.message };
        return reply.status(error.statusCode || 400).send(errResponse);
      }
      return reply.status(500).send({ success: false, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred during edit' });
    }
  });

  app.post('/internal/documents/:documentName/flush', async (request, reply) => {
    if (!authorize(request.headers, reply)) return;
    const { documentName } = request.params as { documentName: string };
    try {
      return reply.send(await lifecycle().capture(documentName));
    } catch (error) {
      return lifecycleError(error, reply);
    }
  });

  app.post('/internal/documents/:documentName/restore', async (request, reply) => {
    if (!authorize(request.headers, reply)) return;
    const { documentName } = request.params as { documentName: string };
    const { yjsState, expectedCurrentFingerprint } = (request.body as any) ?? {};
    if (typeof yjsState !== 'string' || !yjsState || Buffer.from(yjsState, 'base64').toString('base64') !== yjsState
      || typeof expectedCurrentFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(expectedCurrentFingerprint)) {
      return reply.status(400).send({ success: false, code: 'VALIDATION_FAILED', message: 'Valid Yjs state and expected current fingerprint are required' });
    }
    try {
      return reply.send(await lifecycle().restore(documentName, new Uint8Array(Buffer.from(yjsState, 'base64')), expectedCurrentFingerprint));
    } catch (error) {
      return lifecycleError(error, reply);
    }
  });

  app.post('/internal/documents/:documentName/tombstone', async (request, reply) => {
    if (!authorize(request.headers, reply)) return;
    const { documentName } = request.params as { documentName: string };
    try {
      return reply.send(await lifecycle().tombstone(documentName));
    } catch (error) {
      return lifecycleError(error, reply);
    }
  });
}
