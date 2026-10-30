import http from 'node:http';
import { pino } from 'pino';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig } from './config.js';
import { CollabGatewayClient } from './gateway/client.js';
import { createMcpServer } from './server.js';
import { ApiClient, hasScope, type AuthenticatedActor } from './api/client.js';

export const MCP_SERVER_APP_NAME = 'enterprise-blogger-mcp-server';

export async function startMcpServer() {
  const config = loadConfig();

  // In stdio mode, logs MUST NOT write to stdout (stdout is reserved for JSON-RPC framing)
  const logger = pino(
    {
      level: config.logLevel,
    },
    config.transport === 'stdio' ? process.stderr : process.stdout
  );

  logger.info({ transport: config.transport }, 'Starting Enterprise Blogger MCP Server');

  const apiUrl = process.env.GLYPHROOM_API_URL || process.env.API_URL || 'http://127.0.0.1:4001';
  const serverForToken = async (token?: string) => {
    let actor: AuthenticatedActor | null = null;
    if (token) actor = await new ApiClient({ baseUrl: apiUrl, defaultToken: token }).getAuthContext();
    const apiClient = new ApiClient({ baseUrl: apiUrl, defaultToken: token, actor });
    const gatewayClient = new CollabGatewayClient({
      gatewayUrl: config.gatewayUrl,
      gatewaySecret: config.gatewaySecret,
      defaultUserId: actor?.userId || 'unauthenticated',
      defaultAgentId: config.defaultAgentId,
      defaultTokenId: actor?.tokenId,
      timeoutMs: config.gatewayTimeoutMs,
      resolveDocument: (id) => apiClient.resolveEditablePost(id),
    });
    const scopes = actor?.scopes || [];
    return createMcpServer({
      apiClient, gatewayClient, logger, actor,
      agentScopes: [...new Set([...scopes, ...['posts:read', 'posts:draft', 'posts:suggest', 'comments:write', 'posts:publish'].filter((scope) => hasScope(scopes, scope))])],
    });
  };

  const mcpServer = await serverForToken(config.transport === 'stdio'
    ? process.env.GLYPHROOM_PAT || process.env.MCP_PAT || process.env.DEFAULT_TOKEN
    : undefined);

  if (config.transport === 'stdio') {
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    logger.info('MCP server running over stdio');
    return { mcpServer, httpServer: null };
  } else {
    // HTTP Mode: hosts /healthz and /mcp streamable transport
    const httpServer = http.createServer(async (req, res) => {
      // 1. Health check endpoint for Docker & scripts/deploy.sh
      if (req.url === '/healthz' || req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'healthy',
            service: MCP_SERVER_APP_NAME,
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
          })
        );
        return;
      }

      // 2. Streamable HTTP MCP endpoint
      if (req.url?.startsWith('/mcp') || req.url === '/') {
        // Stateless mode has no persistent SSE stream or session to delete.
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Method not allowed' },
            id: null,
          }));
          return;
        }

        try {
          // The SDK requires a fresh server/transport pair for every stateless
          // request, including initialization and subsequent tool calls.
          const authorization = req.headers.authorization;
          if (authorization && !/^Bearer\s+\S+$/i.test(authorization)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Expected a Bearer PAT.' }));
            return;
          }
          const requestServer = await serverForToken(authorization?.replace(/^Bearer\s+/i, ''));
          const streamableTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
          });

          res.once('close', () => {
            void requestServer.close().catch((err) => {
              logger.error({ err }, 'Error closing MCP request');
            });
          });

          await requestServer.connect(streamableTransport);
          await streamableTransport.handleRequest(req, res);
        } catch (err: any) {
          logger.error({ err }, 'Error handling MCP request');
          if (!res.headersSent) {
            const status = [401, 403, 502].includes(err.status) ? err.status : 502;
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || 'MCP dependency unavailable' }));
          }
        }
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(config.port, config.host, () => {
        logger.info(
          `MCP Server listening on http://${config.host}:${config.port} (Health: http://${config.host}:${config.port}/healthz)`
        );
        resolve();
      });
    });

    return { mcpServer, httpServer };
  }
}

// Only launch daemon if this file is the execution entrypoint and not running under tests
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startMcpServer().then(({ httpServer, mcpServer }) => {
    const shutdown = async (signal: string) => {
      console.error(`[MCP Server] ${signal} received. Shutting down...`);
      if (httpServer) {
        httpServer.close();
      }
      await mcpServer.close();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }).catch((err) => {
    console.error('Fatal MCP Server startup error:', err);
    process.exit(1);
  });
}

export * from './server.js';
export * from './gateway/client.js';
export * from './gateway/types.js';
export * from './config.js';
