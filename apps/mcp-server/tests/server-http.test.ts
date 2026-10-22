import { describe, it, expect, afterEach } from 'vitest';
import type { Server as HttpServer } from 'node:http';
import { startMcpServer, MCP_SERVER_APP_NAME } from '../src/index.js';

describe('MCP Server HTTP Mode & /healthz Integration', () => {
  let serverInstance: { httpServer: HttpServer | null; mcpServer: any } | null = null;

  afterEach(async () => {
    if (serverInstance) {
      if (serverInstance.httpServer) {
        serverInstance.httpServer.close();
      }
      try {
        await serverInstance.mcpServer.close();
      } catch {
        // ignore
      }
      serverInstance = null;
    }
  });

  it('starts HTTP listener and returns 200 OK on /healthz matching deploy.sh requirements', async () => {
    process.env.MCP_TRANSPORT = 'http';
    process.env.PORT = '0'; // ephemeral port for test isolation

    serverInstance = await startMcpServer();
    expect(serverInstance.httpServer).not.toBeNull();

    const address = serverInstance.httpServer!.address();
    const port = typeof address === 'object' && address ? address.port : 5000;

    // 1. Query /healthz
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.service).toBe(MCP_SERVER_APP_NAME);
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.timestamp).toBeDefined();

    // 2. Query /health alias
    const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
    expect(healthRes.status).toBe(200);
    const healthBody = await healthRes.json();
    expect(healthBody.status).toBe('healthy');

    // 3. Query non-existent route
    const notFoundRes = await fetch(`http://127.0.0.1:${port}/unknown-path`);
    expect(notFoundRes.status).toBe(404);
  });
});
