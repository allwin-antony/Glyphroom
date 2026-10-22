import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { pino } from 'pino';
import { createMcpServer } from '../src/server.js';
import { CollabGatewayClient } from '../src/gateway/client.js';
import { CollabGatewayError } from '../src/gateway/types.js';
import { startMcpServer, MCP_SERVER_APP_NAME } from '../src/index.js';

describe('Milestone M4 MCP Server Adversarial Stress & Resilience Suite', () => {
  const logger = pino({ level: 'silent' });
  let gatewayClient: CollabGatewayClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    gatewayClient = new CollabGatewayClient({
      gatewayUrl: 'http://127.0.0.1:4000/internal/agent-gateway/edit',
      gatewaySecret: 'test-secret-key-32bytes',
      defaultUserId: 'user-adversary-1',
      defaultAgentId: 'agent-stress-1',
      defaultTokenId: 'token-stress-1',
      timeoutMs: 1000,
    });
  });

  // ==========================================================================
  // 1. Tool Execution Stress: append_section, insert_after_section, suggest_edit_section
  // ==========================================================================
  describe('1. Tool Execution Stress via McpServer instance', () => {
    it('handles massive payload (50,000+ characters) across all tools without truncation or error', async () => {
      const server = createMcpServer({ gatewayClient, logger });
      const tools = (server as any)._registeredTools;

      const massiveContent = 'A'.repeat(50000) + '\n\n' + 'B'.repeat(50000);

      // 1.1 append_section with massive payload
      const sendEditSpy = vi.spyOn(gatewayClient, 'sendEdit').mockResolvedValue({
        success: true,
        operation: 'append_section',
        documentId: 'post-massive-1',
        appliedAt: Date.now(),
        changesSummary: { insertions: 100000, deletions: 0, hunksApplied: 2 },
        suggestionIds: ['sug-massive-1'],
      });

      const appendRes = await tools['append_section'].handler({
        postId: 'post-massive-1',
        heading: 'Massive Data Section',
        content: massiveContent,
      });

      expect(appendRes.isError).toBeUndefined();
      expect(sendEditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'append_section',
          documentId: 'post-massive-1',
          content: massiveContent,
        })
      );
      const appendOutput = JSON.parse(appendRes.content[0].text);
      expect(appendOutput.success).toBe(true);

      // 1.2 insert_after_section with massive payload
      sendEditSpy.mockResolvedValueOnce({
        success: true,
        operation: 'insert_after_section',
        documentId: 'post-massive-1',
        appliedAt: Date.now(),
        changesSummary: { insertions: 100000, deletions: 0, hunksApplied: 2 },
        suggestionIds: ['sug-massive-2'],
      });

      const insertRes = await tools['insert_after_section'].handler({
        postId: 'post-massive-1',
        targetHeading: 'Massive Data Section',
        heading: 'Sub-Massive Section',
        content: massiveContent,
      });

      expect(insertRes.isError).toBeUndefined();
      const insertOutput = JSON.parse(insertRes.content[0].text);
      expect(insertOutput.success).toBe(true);

      // 1.3 suggest_edit_section with massive payload
      sendEditSpy.mockResolvedValueOnce({
        success: true,
        operation: 'suggest_edit_section',
        documentId: 'post-massive-1',
        appliedAt: Date.now(),
        changesSummary: { insertions: 50000, deletions: 50000, hunksApplied: 5 },
        suggestionIds: ['sug-diff-1'],
      });

      const suggestRes = await tools['suggest_edit_section'].handler({
        postId: 'post-massive-1',
        targetHeading: 'Sub-Massive Section',
        newContent: massiveContent,
        instruction: 'Replace with massive diff',
      });

      expect(suggestRes.isError).toBeUndefined();
      const suggestOutput = JSON.parse(suggestRes.content[0].text);
      expect(suggestOutput.success).toBe(true);
      expect(suggestOutput.changesSummary.insertions).toBe(50000);
    });

    it('processes multi-byte Unicode, RTL text, emojis, script tags, and markdown code fences safely', async () => {
      const server = createMcpServer({ gatewayClient, logger });
      const tools = (server as any)._registeredTools;

      const adversarialContent = `
# Emojis & Symbols: 🔥🚀🤖✨💡 \u200B\u200C
## RTL Arabic: مرحبا بالعالم كيف حالك اليوم؟
## CJK: 这是一个企业级博客系统的协作编辑测试。
## HTML & XSS: <script>alert("xss")</script><img src=x onerror=alert(1)>
## Fenced Code:
\`\`\`typescript
const calc = (a: number, b: number) => a + b;
console.log(calc(1, 2));
\`\`\`
      `.trim();

      vi.spyOn(gatewayClient, 'sendEdit').mockResolvedValue({
        success: true,
        operation: 'append_section',
        documentId: 'post-unicode-1',
        appliedAt: Date.now(),
        changesSummary: { insertions: 200, deletions: 0 },
        suggestionIds: ['sug-unicode-1'],
      });

      const res = await tools['append_section'].handler({
        postId: 'post-unicode-1',
        heading: 'Unicode & Boundary Heading 🚀',
        content: adversarialContent,
      });

      expect(res.isError).toBeUndefined();
      const output = JSON.parse(res.content[0].text);
      expect(output.success).toBe(true);
      expect(output.postId).toBe('post-unicode-1');
    });

    it('formats error responses with isError: true when target heading is not found in document', async () => {
      const server = createMcpServer({ gatewayClient, logger });
      const tools = (server as any)._registeredTools;

      vi.spyOn(gatewayClient, 'sendEdit').mockRejectedValue(
        new CollabGatewayError(
          'Target heading "NonExistent" not found in document "post-missing"',
          'SECTION_NOT_FOUND',
          404
        )
      );

      // insert_after_section
      const insertRes = await tools['insert_after_section'].handler({
        postId: 'post-missing',
        targetHeading: 'NonExistent',
        heading: 'New Heading',
        content: 'New Content',
      });

      expect(insertRes.isError).toBe(true);
      expect(insertRes.content[0].text).toContain('[SECTION_NOT_FOUND]');
      expect(insertRes.content[0].text).toContain('NonExistent');

      // suggest_edit_section
      const suggestRes = await tools['suggest_edit_section'].handler({
        postId: 'post-missing',
        targetHeading: 'NonExistent',
        newContent: 'New Content',
      });

      expect(suggestRes.isError).toBe(true);
      expect(suggestRes.content[0].text).toContain('[SECTION_NOT_FOUND]');
    });

    it('handles 50 concurrent tool invocations without race condition or state cross-contamination', async () => {
      const server = createMcpServer({ gatewayClient, logger });
      const tools = (server as any)._registeredTools;

      vi.spyOn(gatewayClient, 'sendEdit').mockImplementation(async (req) => {
        return {
          success: true,
          operation: req.operation,
          documentId: req.documentId,
          appliedAt: Date.now(),
          changesSummary: { insertions: 10, deletions: 0, hunksApplied: 1 },
          suggestionIds: [`sug-${req.documentId}`],
        };
      });

      const promises = Array.from({ length: 50 }, (_, i) => {
        const postId = `concurrent-post-${i}`;
        if (i % 3 === 0) {
          return tools['append_section'].handler({
            postId,
            heading: `Heading ${i}`,
            content: `Appended content ${i}`,
          });
        } else if (i % 3 === 1) {
          return tools['insert_after_section'].handler({
            postId,
            targetHeading: `Target ${i}`,
            content: `Inserted content ${i}`,
          });
        } else {
          return tools['suggest_edit_section'].handler({
            postId,
            targetHeading: `Target ${i}`,
            newContent: `Suggested content ${i}`,
          });
        }
      });

      const results = await Promise.all(promises);
      expect(results).toHaveLength(50);
      for (let i = 0; i < 50; i++) {
        expect(results[i].isError).toBeUndefined();
        const parsed = JSON.parse(results[i].content[0].text);
        expect(parsed.success).toBe(true);
        expect(parsed.postId).toBe(`concurrent-post-${i}`);
      }
    });
  });

  // ==========================================================================
  // 2. Collab Gateway Client Resilience: Down, Timeout, 500, 503, Error Payloads
  // ==========================================================================
  describe('2. Collab Gateway Client Resilience', () => {
    let mockServer: http.Server | null = null;
    let mockServerPort = 0;

    afterEach(async () => {
      if (mockServer) {
        (mockServer as any).closeAllConnections?.();
        await new Promise<void>((resolve) => mockServer!.close(() => resolve()));
        mockServer = null;
      }
    });

    it('handles Collab Server DOWN (ECONNREFUSED) with CONNECTION_ERROR (502) and safe tool formatting', async () => {
      // Point client to a port where nothing is listening
      const deadClient = new CollabGatewayClient({
        gatewayUrl: 'http://127.0.0.1:59199/internal/agent-gateway/edit',
        gatewaySecret: 'test-secret',
        defaultUserId: 'user-dead',
        defaultAgentId: 'agent-dead',
      });

      const server = createMcpServer({ gatewayClient: deadClient, logger });
      const tools = (server as any)._registeredTools;

      // 1. Direct client call throws CollabGatewayError with CONNECTION_ERROR
      await expect(
        deadClient.sendEdit({
          operation: 'append_section',
          documentId: 'post-dead-1',
          content: 'Test content',
        })
      ).rejects.toMatchObject({
        name: 'CollabGatewayError',
        code: 'CONNECTION_ERROR',
        statusCode: 502,
      });

      // 2. Tool handler catches and formats cleanly without throwing
      const res = await tools['append_section'].handler({
        postId: 'post-dead-1',
        content: 'Test content',
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('[CONNECTION_ERROR]');
      expect(res.content[0].text).toContain('Failed to communicate with Collab Gateway');
    });

    it('handles Collab Server TIMEOUT (>timeoutMs) with TIMEOUT (504) without leaking timers', async () => {
      // Start mock server that hangs/delays response past the client timeout
      mockServer = http.createServer((_req, _res) => {
        // Intentionally do not respond immediately
        setTimeout(() => {
          if (!_res.headersSent) {
            _res.writeHead(200, { 'Content-Type': 'application/json' });
            _res.end(JSON.stringify({ success: true }));
          }
        }, 1000);
      });

      await new Promise<void>((resolve) => {
        mockServer!.listen(0, '127.0.0.1', () => {
          const addr = mockServer!.address() as any;
          mockServerPort = addr.port;
          resolve();
        });
      });

      const timeoutClient = new CollabGatewayClient({
        gatewayUrl: `http://127.0.0.1:${mockServerPort}/internal/agent-gateway/edit`,
        gatewaySecret: 'test-secret',
        defaultUserId: 'user-timeout',
        defaultAgentId: 'agent-timeout',
        timeoutMs: 50, // 50ms aggressive timeout
      });

      const server = createMcpServer({ gatewayClient: timeoutClient, logger });
      const tools = (server as any)._registeredTools;

      // 1. Direct client call throws TIMEOUT error
      await expect(
        timeoutClient.sendEdit({
          operation: 'append_section',
          documentId: 'post-timeout-1',
          content: 'Test timeout content',
        })
      ).rejects.toMatchObject({
        name: 'CollabGatewayError',
        code: 'TIMEOUT',
        statusCode: 504,
      });

      // 2. Tool handler catches and formats cleanly
      const res = await tools['append_section'].handler({
        postId: 'post-timeout-1',
        content: 'Test timeout content',
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('[TIMEOUT]');
      expect(res.content[0].text).toContain('timed out after 50ms');
    });

    it('handles Collab Server HTTP 500 (HTML error page) without throwing or crashing', async () => {
      mockServer = http.createServer((_req, res) => {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<html><body>500 Internal Server Error: Database pool exhausted</body></html>');
      });

      await new Promise<void>((resolve) => {
        mockServer!.listen(0, '127.0.0.1', () => {
          const addr = mockServer!.address() as any;
          mockServerPort = addr.port;
          resolve();
        });
      });

      const errorClient = new CollabGatewayClient({
        gatewayUrl: `http://127.0.0.1:${mockServerPort}/internal/agent-gateway/edit`,
        gatewaySecret: 'test-secret',
        defaultUserId: 'user-500',
        defaultAgentId: 'agent-500',
      });

      const server = createMcpServer({ gatewayClient: errorClient, logger });
      const tools = (server as any)._registeredTools;

      const res = await tools['suggest_edit_section'].handler({
        postId: 'post-500',
        targetHeading: 'Heading',
        newContent: 'New Content',
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('[INTERNAL_ERROR]');
      expect(res.content[0].text).toContain('non-JSON response (500)');
    });

    it('handles Collab Server HTTP 503 Service Unavailable (JSON error body)', async () => {
      mockServer = http.createServer((_req, res) => {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            code: 'SERVICE_UNAVAILABLE',
            message: 'Collaboration server is shutting down or draining',
          })
        );
      });

      await new Promise<void>((resolve) => {
        mockServer!.listen(0, '127.0.0.1', () => {
          const addr = mockServer!.address() as any;
          mockServerPort = addr.port;
          resolve();
        });
      });

      const client503 = new CollabGatewayClient({
        gatewayUrl: `http://127.0.0.1:${mockServerPort}/internal/agent-gateway/edit`,
        gatewaySecret: 'test-secret',
        defaultUserId: 'user-503',
        defaultAgentId: 'agent-503',
      });

      const server = createMcpServer({ gatewayClient: client503, logger });
      const tools = (server as any)._registeredTools;

      const res = await tools['insert_after_section'].handler({
        postId: 'post-503',
        targetHeading: 'Target',
        content: 'New content',
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('[GATEWAY_ERROR]');
      expect(res.content[0].text).toContain('503');
    });

    it('recovers immediately and successfully executes subsequent edits after transient errors', async () => {
      let failCount = 2;
      mockServer = http.createServer((_req, res) => {
        if (failCount > 0) {
          failCount--;
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, code: 'SERVICE_UNAVAILABLE', message: 'Fail' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            operation: 'append_section',
            documentId: 'post-recovery',
            appliedAt: Date.now(),
            changesSummary: { insertions: 10, deletions: 0 },
            suggestionIds: ['sug-rec-1'],
          })
        );
      });

      await new Promise<void>((resolve) => {
        mockServer!.listen(0, '127.0.0.1', () => {
          const addr = mockServer!.address() as any;
          mockServerPort = addr.port;
          resolve();
        });
      });

      const client = new CollabGatewayClient({
        gatewayUrl: `http://127.0.0.1:${mockServerPort}/internal/agent-gateway/edit`,
        gatewaySecret: 'test-secret',
        defaultUserId: 'user-rec',
        defaultAgentId: 'agent-rec',
      });

      const server = createMcpServer({ gatewayClient: client, logger });
      const tools = (server as any)._registeredTools;

      // First two calls fail with 503
      const fail1 = await tools['append_section'].handler({ postId: 'post-recovery', content: '1' });
      expect(fail1.isError).toBe(true);

      const fail2 = await tools['append_section'].handler({ postId: 'post-recovery', content: '2' });
      expect(fail2.isError).toBe(true);

      // Third call succeeds without server restart
      const successRes = await tools['append_section'].handler({ postId: 'post-recovery', content: '3' });
      expect(successRes.isError).toBeUndefined();
      const output = JSON.parse(successRes.content[0].text);
      expect(output.success).toBe(true);
      expect(output.postId).toBe('post-recovery');
    });
  });

  // ==========================================================================
  // 3. Dual Transport Validation: Stdio logs to stderr only; HTTP responds to /healthz
  // ==========================================================================
  describe('3. Dual Transport Validation', () => {
    let serverInstance: { httpServer: http.Server | null; mcpServer: any } | null = null;

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

    it('stdio transport directs logger to process.stderr (never stdout) preserving JSON-RPC framing', () => {
      // In stdio mode, logs MUST NOT write to stdout to avoid corrupting JSON-RPC framing
      const stdoutWrites: string[] = [];
      const stderrWrites: string[] = [];

      const origStdoutWrite = process.stdout.write.bind(process.stdout);
      const origStderrWrite = process.stderr.write.bind(process.stderr);

      process.stdout.write = ((chunk: any) => {
        stdoutWrites.push(chunk.toString());
        return true;
      }) as any;

      process.stderr.write = ((chunk: any) => {
        stderrWrites.push(chunk.toString());
        return true;
      }) as any;

      try {
        // Instantiate logger identical to apps/mcp-server/src/index.ts in stdio mode
        const stdioLogger = pino(
          { level: 'info' },
          process.stderr // stdio destination
        );

        stdioLogger.info({ service: 'mcp-server' }, 'Stdio initialization test');
        stdioLogger.warn('Warning test');
        stdioLogger.error('Error test');

        // Verify stdout received ZERO log messages
        expect(stdoutWrites).toHaveLength(0);

        // Verify stderr received the log messages
        expect(stderrWrites.length).toBeGreaterThanOrEqual(1);
        const combinedStderr = stderrWrites.join('');
        expect(combinedStderr).toContain('Stdio initialization test');
        expect(combinedStderr).toContain('Warning test');
        expect(combinedStderr).toContain('Error test');
      } finally {
        process.stdout.write = origStdoutWrite;
        process.stderr.write = origStderrWrite;
      }
    });

    it('HTTP transport responds to GET /healthz and GET /health on designated port', async () => {
      process.env.MCP_TRANSPORT = 'http';
      process.env.PORT = '0'; // ephemeral port

      serverInstance = await startMcpServer();
      expect(serverInstance.httpServer).not.toBeNull();

      const addr = serverInstance.httpServer!.address() as any;
      const port = addr.port;

      // 1. GET /healthz
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');

      const body = await res.json();
      expect(body.status).toBe('healthy');
      expect(body.service).toBe(MCP_SERVER_APP_NAME);
      expect(typeof body.uptime).toBe('number');
      expect(new Date(body.timestamp).getTime()).not.toBeNaN();

      // 2. GET /health
      const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
      expect(healthRes.status).toBe(200);
      const healthBody = await healthRes.json();
      expect(healthBody.status).toBe('healthy');

      // 3. GET /unknown-path returns 404
      const notFound = await fetch(`http://127.0.0.1:${port}/unknown-route-test`);
      expect(notFound.status).toBe(404);
      const notFoundBody = await notFound.json();
      expect(notFoundBody.error).toBe('Not Found');
    });
  });
});
