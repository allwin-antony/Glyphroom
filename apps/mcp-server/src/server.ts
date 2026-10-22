import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type pino from 'pino';
import type { CollabGatewayClient } from './gateway/client.js';
import { registerAppendSectionTool } from './tools/append-section.js';
import { registerInsertAfterSectionTool } from './tools/insert-after.js';
import { registerSuggestEditSectionTool } from './tools/suggest-edit.js';

export interface CreateMcpServerOptions {
  name?: string;
  version?: string;
  gatewayClient: CollabGatewayClient;
  logger: pino.Logger;
}

export function createMcpServer(options: CreateMcpServerOptions): McpServer {
  const server = new McpServer({
    name: options.name || 'enterprise-blogger-mcp-server',
    version: options.version || '0.1.0',
  });

  registerAppendSectionTool(server, options.gatewayClient, options.logger);
  registerInsertAfterSectionTool(server, options.gatewayClient, options.logger);
  registerSuggestEditSectionTool(server, options.gatewayClient, options.logger);

  return server;
}
