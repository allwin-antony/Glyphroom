import type { ZodRawShape } from 'zod';
import type { ApiClient } from '../api/client.js';
import type { CollabGatewayClient } from '../gateway/client.js';
import type pino from 'pino';

export interface McpToolContext {
  apiClient: ApiClient;
  gatewayClient: CollabGatewayClient;
  logger: pino.Logger;
  agentScopes?: string[];
  userId?: string;
}

export interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface McpToolContribution {
  pluginId: string;
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  requiredScopes: string[];
  handler: (args: any, context: McpToolContext) => Promise<CallToolResult>;
}

export interface GlyphroomMcpPlugin {
  id: string;
  name: string;
  version: string;
  tools: McpToolContribution[];
}
