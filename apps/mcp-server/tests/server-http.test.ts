import { describe, it, expect, afterEach } from 'vitest';
import type { Server as HttpServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
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

  it('handles repeated requests from independent MCP clients over HTTP', async () => {
    process.env.MCP_TRANSPORT = 'http';
    process.env.PORT = '0';

    serverInstance = await startMcpServer();
    const address = serverInstance.httpServer!.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an HTTP listening address');
    }

    const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
    const clients = [
      new Client({ name: 'http-test-one', version: '1.0.0' }),
      new Client({ name: 'http-test-two', version: '1.0.0' }),
    ];

    try {
      await Promise.all(clients.map(async (client) => {
        await client.connect(new StreamableHTTPClientTransport(url));

        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(['search_posts', 'get_post'])
        );

        const resources = await client.listResources();
        expect(resources.resources.length).toBeGreaterThan(0);

        const resource = await client.readResource({ uri: resources.resources[0].uri });
        expect(resource.contents.length).toBeGreaterThan(0);

        const nextTools = await client.listTools();
        expect(nextTools.tools.map((tool) => tool.name)).toEqual(
          tools.tools.map((tool) => tool.name)
        );
      }));

      for (const method of ['GET', 'DELETE']) {
        const response = await fetch(url, { method });
        expect(response.status).toBe(405);
        expect(response.headers.get('allow')).toBe('POST');
        await response.json();
      }
    } finally {
      await Promise.all(clients.map((client) => client.close()));
    }
  });
});
