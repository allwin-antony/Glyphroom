import {
  AgentGatewayEditRequestSchema,
  AgentGatewayEditResponseSchema,
  AgentGatewayErrorResponseSchema,
  AgentGatewayHeadersSchema,
  type AgentGatewayEditRequest,
  type AgentGatewayEditResponse,
} from '@enterprise-blogger/shared';
import {
  CollabGatewayError,
  type CollabGatewayClientOptions,
  type RequestIdentityOverrides,
} from './types.js';

export class CollabGatewayClient {
  private readonly gatewayUrl: string;
  private readonly gatewaySecret: string;
  private readonly defaultUserId: string;
  private readonly defaultAgentId: string;
  private readonly defaultTokenId?: string;
  private readonly timeoutMs: number;

  constructor(options: CollabGatewayClientOptions) {
    let url = options.gatewayUrl;
    if (!url.includes('/internal/agent-gateway/edit')) {
      url = url.replace(/\/+$/, '') + '/internal/agent-gateway/edit';
    }
    this.gatewayUrl = url;
    this.gatewaySecret = options.gatewaySecret;
    this.defaultUserId = options.defaultUserId;
    this.defaultAgentId = options.defaultAgentId;
    this.defaultTokenId = options.defaultTokenId;
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

  async sendEdit(
    payload: AgentGatewayEditRequest,
    overrides?: RequestIdentityOverrides
  ): Promise<AgentGatewayEditResponse> {
    // 1. Validate payload with shared schema
    const parseResult = AgentGatewayEditRequestSchema.safeParse(payload);
    if (!parseResult.success) {
      throw new CollabGatewayError(
        `Invalid edit payload: ${parseResult.error.message}`,
        'VALIDATION_FAILED',
        400,
        parseResult.error.format()
      );
    }

    // 2. Build headers and validate
    const rawHeaders: Record<string, string> = {
      'x-gateway-secret': this.gatewaySecret,
      'x-user-id': overrides?.userId || this.defaultUserId,
      'x-agent-id': overrides?.agentId || this.defaultAgentId,
    };
    const tokenId = overrides?.tokenId || this.defaultTokenId;
    if (tokenId) {
      rawHeaders['x-token-id'] = tokenId;
    }

    const headerResult = AgentGatewayHeadersSchema.safeParse(rawHeaders);
    if (!headerResult.success) {
      throw new CollabGatewayError(
        `Invalid gateway headers: ${headerResult.error.message}`,
        'VALIDATION_FAILED',
        400
      );
    }

    // 3. Perform HTTP POST with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.gatewayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': this.gatewaySecret,
          'X-User-Id': rawHeaders['x-user-id'],
          'X-Agent-Id': rawHeaders['x-agent-id'],
          ...(rawHeaders['x-token-id'] ? { 'X-Token-Id': rawHeaders['x-token-id'] } : {}),
        },
        body: JSON.stringify(parseResult.data),
        signal: controller.signal,
      });

      const responseText = await response.text();
      let responseJson: unknown;
      try {
        responseJson = JSON.parse(responseText);
      } catch {
        throw new CollabGatewayError(
          `Collab gateway returned non-JSON response (${response.status}): ${responseText.slice(0, 200)}`,
          'INTERNAL_ERROR',
          response.status
        );
      }

      if (!response.ok) {
        const errorParse = AgentGatewayErrorResponseSchema.safeParse(responseJson);
        if (errorParse.success) {
          throw new CollabGatewayError(
            errorParse.data.message,
            errorParse.data.code,
            response.status,
            errorParse.data.details
          );
        }
        throw new CollabGatewayError(
          `Collab gateway returned error (${response.status})`,
          'GATEWAY_ERROR',
          response.status,
          responseJson
        );
      }

      const successParse = AgentGatewayEditResponseSchema.safeParse(responseJson);
      if (!successParse.success) {
        throw new CollabGatewayError(
          `Collab gateway returned invalid success payload: ${successParse.error.message}`,
          'INTERNAL_ERROR',
          response.status
        );
      }

      return successParse.data;
    } catch (err: any) {
      if (err instanceof CollabGatewayError) {
        throw err;
      }
      if (err.name === 'AbortError') {
        throw new CollabGatewayError(
          `Collab gateway request timed out after ${this.timeoutMs}ms`,
          'TIMEOUT',
          504
        );
      }
      throw new CollabGatewayError(
        `Failed to communicate with Collab Gateway: ${err.message}`,
        'CONNECTION_ERROR',
        502
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
