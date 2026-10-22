import http from 'node:http';
import { pino } from 'pino';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig } from './config.js';
import { CollabGatewayClient } from './gateway/client.js';
import { createMcpServer } from './server.js';

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

  const gatewayClient = new CollabGatewayClient({
    gatewayUrl: config.gatewayUrl,
    gatewaySecret: config.gatewaySecret,
    defaultUserId: config.defaultUserId,
    defaultAgentId: config.defaultAgentId,
    defaultTokenId: config.defaultTokenId,
    timeoutMs: config.gatewayTimeoutMs,
  });

  const mcpServer = createMcpServer({
    gatewayClient,
    logger,
  });

  if (config.transport === 'stdio') {
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    logger.info('MCP server running over stdio');
    return { mcpServer, httpServer: null };
  } else {
    // HTTP Mode: hosts /healthz and /mcp streamable transport
    const streamableTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless session mode
    });

    await mcpServer.connect(streamableTransport);

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
        try {
          await streamableTransport.handleRequest(req, res);
        } catch (err: any) {
          logger.error({ err }, 'Error handling MCP request');
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
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
      console.log(`[MCP Server] ${signal} received. Shutting down...`);
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
