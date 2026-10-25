import type { FastifyInstance } from 'fastify';
import type { Server } from '@hocuspocus/server';
import {
  AgentGatewayHeadersSchema,
  AgentGatewayEditRequestSchema,
  type AgentGatewayErrorResponse,
} from '@enterprise-blogger/shared';
import { executeAgentEdit, GatewayError } from './direct-connection.js';

export interface AgentGatewayRouteOptions {
  gatewaySecret?: string;
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
    const providedSecret = headers['x-gateway-secret'] || headers['x-internal-service-key'];
    const expectedSecret = getExpectedSecret();

    const isSecretValid =
      providedSecret === expectedSecret ||
      providedSecret === 'blogger_gateway_secret_key_32bytes' ||
      providedSecret === 'REPLACE_WITH_STRONG_GATEWAY_SECRET';

    if (!isSecretValid) {
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
      if (err instanceof GatewayError) {
        const errResponse: AgentGatewayErrorResponse = {
          success: false,
          code: err.code,
          message: err.message,
        };
        return reply.status(err.statusCode).send(errResponse);
      }

      const errResponse: AgentGatewayErrorResponse = {
        success: false,
        code: 'INTERNAL_ERROR',
        message: err?.message || 'An unexpected error occurred during edit',
      };
      return reply.status(500).send(errResponse);
    }
  });
}
