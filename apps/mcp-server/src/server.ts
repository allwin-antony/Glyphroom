import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type pino from 'pino';
import type { CollabGatewayClient } from './gateway/client.js';
import { ApiClient } from './api/client.js';
import { registerAppendSectionTool } from './tools/append-section.js';
import { registerInsertAfterSectionTool } from './tools/insert-after.js';
import { registerSuggestEditSectionTool } from './tools/suggest-edit.js';
import { registerSearchPostsTool } from './tools/search-posts.js';
import { registerGetPostTool } from './tools/get-post.js';
import { registerCreatePostTool } from './tools/create-post.js';
import { registerAddCommentTool } from './tools/add-comment.js';
import { registerPublishPostTool } from './tools/publish-post.js';

export interface CreateMcpServerOptions {
  name?: string;
  version?: string;
  gatewayClient: CollabGatewayClient;
  apiClient?: ApiClient;
  apiUrl?: string;
  agentScopes?: string[];
  logger: pino.Logger;
}

export function createMcpServer(options: CreateMcpServerOptions): McpServer {
  const server = new McpServer({
    name: options.name || 'enterprise-blogger-mcp-server',
    version: options.version || '0.1.0',
  });

  const apiClient =
    options.apiClient ||
    new ApiClient({
      baseUrl: options.apiUrl || process.env.API_URL || 'http://127.0.0.1:4001',
    });

  // Collaborative Yjs editing tools (single-write authority via Collab Gateway)
  registerAppendSectionTool(server, options.gatewayClient, options.logger);
  registerInsertAfterSectionTool(server, options.gatewayClient, options.logger);
  registerSuggestEditSectionTool(server, options.gatewayClient, options.logger);

  // REST API & Knowledge discovery tools
  registerSearchPostsTool(server, apiClient, options.logger);
  registerGetPostTool(server, apiClient, options.logger);
  registerCreatePostTool(server, apiClient, options.logger);
  registerAddCommentTool(server, apiClient, options.logger);
  registerPublishPostTool(server, apiClient, options.logger, {
    agentScopes: options.agentScopes,
  });

  return server;
}
