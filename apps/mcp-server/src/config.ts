import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();
try {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(dirname, '../.env'), override: true });
} catch {
  // Ignore fallback resolution errors
}

export interface McpServerConfig {
  port: number;
  host: string;
  transport: 'stdio' | 'http';
  gatewayUrl: string;
  gatewaySecret: string;
  defaultUserId: string;
  defaultAgentId: string;
  defaultTokenId: string;
  gatewayTimeoutMs: number;
  logLevel: string;
}

export function loadConfig(): McpServerConfig {
  const isStdioFlag = process.argv.includes('--stdio');
  const isHttpFlag = process.argv.includes('--http');

  const rawTransport = process.env.MCP_TRANSPORT?.toLowerCase();
  let transport: 'stdio' | 'http' = 'http';
  if (isStdioFlag) {
    transport = 'stdio';
  } else if (isHttpFlag) {
    transport = 'http';
  } else if (rawTransport === 'stdio') {
    transport = 'stdio';
  } else if (rawTransport === 'http' || rawTransport === 'sse') {
    transport = 'http';
  } else if (!process.stdin.isTTY && !process.env.PORT) {
    transport = 'stdio';
  }

  const gatewayUrl =
    process.env.COLLAB_GATEWAY_URL ||
    process.env.AGENT_GATEWAY_URL ||
    'http://127.0.0.1:4000/internal/agent-gateway/edit';

  const gatewaySecret =
    process.env.GATEWAY_SECRET ||
    process.env.COLLAB_GATEWAY_SECRET ||
    'REPLACE_WITH_STRONG_GATEWAY_SECRET';

  return {
    port: parseInt(process.env.PORT || process.env.MCP_PORT || '5000', 10),
    host: process.env.HOST || process.env.MCP_HOST || '0.0.0.0',
    transport,
    gatewayUrl,
    gatewaySecret,
    defaultUserId:
      process.env.MCP_USER_ID || process.env.DEFAULT_USER_ID || 'usr_agent_owner',
    defaultAgentId:
      process.env.MCP_AGENT_ID ||
      process.env.DEFAULT_AGENT_ID ||
      'enterprise_blogger_agent',
    defaultTokenId:
      process.env.MCP_TOKEN_ID || process.env.DEFAULT_TOKEN_ID || 'tok_agent_default',
    gatewayTimeoutMs: parseInt(process.env.GATEWAY_TIMEOUT_MS || '10000', 10),
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}
