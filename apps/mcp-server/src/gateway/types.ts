import type {
  AgentGatewayEditRequest,
  AgentGatewayEditResponse,
  AgentGatewayErrorResponse,
} from '@enterprise-blogger/shared';

export interface CollabGatewayClientOptions {
  gatewayUrl: string;
  gatewaySecret: string;
  defaultUserId: string;
  defaultAgentId: string;
  defaultTokenId?: string;
  timeoutMs?: number;
}

export interface RequestIdentityOverrides {
  userId?: string;
  agentId?: string;
  tokenId?: string;
}

export class CollabGatewayError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'GATEWAY_ERROR',
    public readonly statusCode?: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'CollabGatewayError';
  }
}
