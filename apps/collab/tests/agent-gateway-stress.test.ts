import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import crypto from 'node:crypto';
import { HocuspocusProvider } from '@hocuspocus/provider';
import {
  createHumanUndoManager,
  getDocumentFragment,
  type AgentGatewayEditResponse,
} from '@enterprise-blogger/shared';
import { createCollabServer, type CollabServerInstance } from '../src/server.js';
import { InMemoryPersistenceAdapter } from '../src/persistence/in-memory.js';
import { createHeadlessAgentClient } from '../src/gateway/awareness.js';

describe('Milestone M4 Adversarial Stress & Empirical Challenge Suite (challenger_m4_1)', () => {
  let instance: CollabServerInstance | null = null;
  const providersToClean: (HocuspocusProvider | { destroy(): Promise<void> })[] = [];
  const testSecret = 'challenger-test-secret-key-32b-ok!';

  afterEach(async () => {
    while (providersToClean.length > 0) {
      const p = providersToClean.pop();
      try {
        await p?.destroy();
      } catch {
        // ignore
      }
    }
    if (instance) {
      await instance.destroy();
      instance = null;
    }
  });

  async function setupServer() {
    const adapter = new InMemoryPersistenceAdapter();
    instance = await createCollabServer({
      port: 0,
      adapter,
      gatewaySecret: testSecret,
      quiet: true,
    });
    const { port, url } = await instance.listen();
    return { port, url, adapter };
  }

  async function connectClient(url: string, documentName: string, token: string = 'token-author-alice') {
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url,
      name: documentName,
      document: doc,
      token,
      WebSocketPolyfill: WebSocket as any,
    } as any);
    providersToClean.push(provider);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sync timeout')), 10000);
      provider.on('synced', () => {
        clearTimeout(timer);
        resolve();
      });
      provider.on('close', (e: any) => {
        clearTimeout(timer);
        reject(new Error(`Closed: ${e?.code}`));
      });
    });

    return { doc, provider };
  }

  // =========================================================================
  // 1. Authentication & Security Stress
  // =========================================================================
  describe('1. Authentication & Security Stress', () => {
    it('rejects wrong ASCII secrets with 401 UNAUTHORIZED', async () => {
      const { port } = await setupServer();
      const endpoint = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;

      const asciiWrongSecrets = [
        'wrong-secret',
        testSecret.slice(0, 10), // partial prefix
        testSecret + '-extra',
        'super-long-but-ascii-secret-1234567890',
      ];

      for (const secret of asciiWrongSecrets) {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Gateway-Secret': secret,
            'X-User-Id': 'usr-test',
            'X-Agent-Id': 'agent-test',
          },
          body: JSON.stringify({
            operation: 'append_section',
            documentId: 'post-sec-test',
            content: 'test',
          }),
        });

        expect(res.status).toBe(401);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.code).toBe('UNAUTHORIZED');
      }
    });

    it('rejects empty or whitespace-only secret with 400 VALIDATION_FAILED', async () => {
      const { port } = await setupServer();
      const endpoint = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;

      for (const emptySecret of ['', '   ']) {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Gateway-Secret': emptySecret,
            'X-User-Id': 'usr-test',
            'X-Agent-Id': 'agent-test',
          },
          body: JSON.stringify({
            operation: 'append_section',
            documentId: 'post-sec-test',
            content: 'test',
          }),
        });

        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.code).toBe('VALIDATION_FAILED');
      }
    });

    it('rejects oversized header at transport layer via ECONNRESET', async () => {
      const { port } = await setupServer();
      const endpoint = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;

      // 64KB header exceeds Node maxHeaderSize (16KB)
      await expect(
        fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Gateway-Secret': 'a'.repeat(65536),
            'X-User-Id': 'usr-test',
            'X-Agent-Id': 'agent-test',
          },
          body: JSON.stringify({
            operation: 'append_section',
            documentId: 'post-sec-test',
            content: 'test',
          }),
        })
      ).rejects.toThrow();
    });

    it('rejects requests missing required headers', async () => {
      const { port } = await setupServer();
      const endpoint = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;

      // 1. Missing secret
      const res1 = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'usr-test',
          'X-Agent-Id': 'agent-test',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: 'post-sec-missing-1',
          content: 'test',
        }),
      });
      expect(res1.status).toBe(400);

      // 2. Missing X-User-Id
      const res2 = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-Agent-Id': 'agent-test',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: 'post-sec-missing-2',
          content: 'test',
        }),
      });
      expect(res2.status).toBe(400);

      // 3. Missing X-Agent-Id
      const res3 = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'usr-test',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: 'post-sec-missing-3',
          content: 'test',
        }),
      });
      expect(res3.status).toBe(400);
    });

    it('handles uppercase and alternate secret header casings correctly', async () => {
      const { port } = await setupServer();
      const endpoint = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gateway-secret': testSecret, // lowercase
          'x-user-id': 'usr-1',
          'x-agent-id': 'agent-1',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: 'post-casing-test',
          content: 'Casing test content',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('strictly rejects path traversal, null bytes, SQL/shell injections in documentId', async () => {
      const { port } = await setupServer();
      const endpoint = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;

      const maliciousDocIds = [
        '../../etc/passwd',
        '..\\..\\windows\\system32',
        'doc/subpath/secret',
        'doc%2e%2e%2f',
        'doc\0nullbyte',
        'doc with spaces',
        'doc; DROP TABLE posts;--',
        '<script>alert(1)</script>',
        'doc?query=true',
        'doc#fragment',
        'a'.repeat(129), // Exceeds 128 max limit
        '', // Empty string
      ];

      for (const maliciousId of maliciousDocIds) {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Gateway-Secret': testSecret,
            'X-User-Id': 'usr-test',
            'X-Agent-Id': 'agent-test',
          },
          body: JSON.stringify({
            operation: 'append_section',
            documentId: maliciousId,
            content: 'test',
          }),
        });

        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.code).toBe('VALIDATION_FAILED');
      }
    });

    it('strictly rejects path traversal and malicious characters in header identifiers', async () => {
      const { port } = await setupServer();
      const endpoint = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;

      const maliciousHeaders = [
        { 'X-User-Id': '../../root', 'X-Agent-Id': 'valid-agent' },
        { 'X-User-Id': 'valid-user', 'X-Agent-Id': 'agent/../traversal' },
        { 'X-User-Id': 'valid-user', 'X-Agent-Id': 'agent;injection' },
        { 'X-User-Id': 'valid-user', 'X-Agent-Id': 'valid-agent', 'X-Token-Id': 'token/../secret' },
        { 'X-User-Id': 'user space', 'X-Agent-Id': 'valid-agent' },
        { 'X-User-Id': 'a'.repeat(129), 'X-Agent-Id': 'valid-agent' },
      ];

      for (const hdrs of maliciousHeaders) {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Gateway-Secret': testSecret,
            ...hdrs,
          },
          body: JSON.stringify({
            operation: 'append_section',
            documentId: 'post-valid-id',
            content: 'test',
          }),
        });

        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.code).toBe('VALIDATION_FAILED');
      }
    });

    it('documents string comparison behavior and verifies constant-time comparison considerations', () => {
      // Direct empirical verification of string vs crypto.timingSafeEqual comparison
      const secretA = Buffer.from('blogger_gateway_secret_key_32bytes');
      const secretB = Buffer.from('blogger_gateway_secret_key_32bytes');
      const secretC = Buffer.from('xlogger_gateway_secret_key_32bytes');

      expect(crypto.timingSafeEqual(secretA, secretB)).toBe(true);
      expect(crypto.timingSafeEqual(secretA, secretC)).toBe(false);
    });
  });

  // =========================================================================
  // 2. Error Handling & Invariants
  // =========================================================================
  describe('2. Error Handling & Invariants', () => {
    it('returns 404 SECTION_NOT_FOUND when insert_after_section targets non-existent section', async () => {
      const { port } = await setupServer();
      const endpoint = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'usr-1',
          'X-Agent-Id': 'agent-1',
        },
        body: JSON.stringify({
          operation: 'insert_after_section',
          documentId: 'post-err-1',
          targetHeading: 'NonExistentHeadingHere',
          heading: 'New Section',
          content: 'New content here',
        }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.code).toBe('SECTION_NOT_FOUND');
      expect(data.message).toContain('NonExistentHeadingHere');
    });

    it('returns 404 SECTION_NOT_FOUND when suggest_edit_section targets non-existent section', async () => {
      const { port } = await setupServer();
      const endpoint = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'usr-1',
          'X-Agent-Id': 'agent-1',
        },
        body: JSON.stringify({
          operation: 'suggest_edit_section',
          documentId: 'post-err-2',
          targetHeading: 'MissingTargetHeading',
          content: 'Proposed replacement content',
        }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.code).toBe('SECTION_NOT_FOUND');
      expect(data.message).toContain('MissingTargetHeading');
    });

    it('rejects empty targetHeading with 400 VALIDATION_FAILED', async () => {
      const { port } = await setupServer();
      const endpoint = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;

      // insert_after_section with empty targetHeading
      const res1 = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'usr-1',
          'X-Agent-Id': 'agent-1',
        },
        body: JSON.stringify({
          operation: 'insert_after_section',
          documentId: 'post-err-3',
          targetHeading: '',
          heading: 'Heading',
          content: 'Content',
        }),
      });
      expect(res1.status).toBe(400);
      const data1 = await res1.json();
      expect(data1.code).toBe('VALIDATION_FAILED');

      // suggest_edit_section with empty targetHeading
      const res2 = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'usr-1',
          'X-Agent-Id': 'agent-1',
        },
        body: JSON.stringify({
          operation: 'suggest_edit_section',
          documentId: 'post-err-3',
          targetHeading: '',
          content: 'Content',
        }),
      });
      expect(res2.status).toBe(400);
      const data2 = await res2.json();
      expect(data2.code).toBe('VALIDATION_FAILED');
    });

    it('rejects empty content with 400 VALIDATION_FAILED', async () => {
      const { port } = await setupServer();
      const endpoint = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'usr-1',
          'X-Agent-Id': 'agent-1',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: 'post-err-4',
          content: '', // empty content
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('VALIDATION_FAILED');
    });

    it('rejects unsupported operations and malformed JSON payloads', async () => {
      const { port } = await setupServer();
      const endpoint = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;

      // 1. Invalid operation
      const res1 = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'usr-1',
          'X-Agent-Id': 'agent-1',
        },
        body: JSON.stringify({
          operation: 'delete_entire_document',
          documentId: 'post-err-5',
          content: 'test',
        }),
      });
      expect(res1.status).toBe(400);

      // 2. Malformed JSON body
      const res2 = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'usr-1',
          'X-Agent-Id': 'agent-1',
        },
        body: '{"operation": "append_section", documentId: invalid-json',
      });
      expect(res2.status).toBe(400);
    });

    it('safely handles large payload without crash or out-of-memory error', async () => {
      const { port } = await setupServer();
      const endpoint = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;

      // Create a large multi-paragraph body (500 paragraphs, ~46,000 chars)
      const largeContent = Array.from({ length: 500 }, (_, i) =>
        `Paragraph ${i}: This is an automated stress payload testing large content processing in CRDT.`
      ).join('\n\n');

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'usr-1',
          'X-Agent-Id': 'agent-stress-bot',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: 'post-large-payload',
          heading: 'Large Stress Section',
          content: largeContent,
        }),
      });

      expect(res.status).toBe(200);
      const data: AgentGatewayEditResponse = await res.json();
      expect(data.success).toBe(true);
      expect(data.changesSummary.insertions).toBeGreaterThan(40000);
    });
  });

  // =========================================================================
  // 3. High-Concurrency Agent Mutations
  // =========================================================================
  describe('3. High-Concurrency Agent Mutations', () => {
    it('handles 20 concurrent agent append requests on the same document simultaneously', async () => {
      const { port, url } = await setupServer();
      const endpoint = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;
      const docName = 'post-concurrent-appends';

      // Connect human observer client
      const { doc: humanDoc } = await connectClient(url, docName);

      const agentCount = 20;
      const tasks = Array.from({ length: agentCount }, (_, idx) => {
        return fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Gateway-Secret': testSecret,
            'X-User-Id': `author-${idx}`,
            'X-Agent-Id': `agent-worker-${idx}`,
          },
          body: JSON.stringify({
            operation: 'append_section',
            documentId: docName,
            heading: `Section From Agent ${idx}`,
            content: `Content written concurrently by agent ${idx}.`,
          }),
        }).then(async (res) => {
          const body = await res.json();
          return { status: res.status, body };
        });
      });

      const results = await Promise.all(tasks);

      // Verify all 20 succeeded with 200 OK
      for (let i = 0; i < agentCount; i++) {
        expect(results[i].status).toBe(200);
        expect(results[i].body.success).toBe(true);
      }

  function getElementPlainText(item: Y.XmlElement): string {
    let result = '';
    for (let i = 0; i < item.length; i++) {
      const child = item.get(i);
      if (child instanceof Y.XmlText) {
        for (const op of child.toDelta()) {
          if (typeof op.insert === 'string') result += op.insert;
        }
      } else if (child instanceof Y.XmlElement) {
        result += getElementPlainText(child);
      }
    }
    return result;
  }

      // Allow sync to complete to human client (wait up to 3000ms for all 20 sections = 40 elements)
      const fragment = getDocumentFragment(humanDoc);
      const pollStart = Date.now();
      while (fragment.length < agentCount * 2 && Date.now() - pollStart < 3000) {
        await new Promise((r) => setTimeout(r, 50));
      }

      // Verify document contains all 20 headings
      const headingsFound = new Set<string>();

      for (let i = 0; i < fragment.length; i++) {
        const item = fragment.get(i);
        if (item instanceof Y.XmlElement && item.nodeName === 'heading') {
          headingsFound.add(getElementPlainText(item));
        }
      }

      for (let i = 0; i < agentCount; i++) {
        expect(headingsFound.has(`Section From Agent ${i}`)).toBe(true);
      }

      // Verify no connection leaks
      const connCount = instance!.server.hocuspocus.getConnectionsCount();
      expect(connCount).toBe(1); // Only the human observer client connected
    });

    it('handles concurrent mixed appends and suggestions on an existing document', async () => {
      const { port, url } = await setupServer();
      const endpoint = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;
      const docName = 'post-concurrent-mixed';

      // 1. Initial seed
      await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'seed-author',
          'X-Agent-Id': 'agent-seeder',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: docName,
          heading: 'Base Architecture',
          content: 'The core platform provides real-time collaborative editing using Yjs CRDTs.',
        }),
      });

      // 2. Connect observer
      const { doc: humanDoc } = await connectClient(url, docName);

      // 3. Dispatch 10 concurrent appends and 10 concurrent suggestions on the same document
      const appendTasks = Array.from({ length: 10 }, (_, i) =>
        fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Gateway-Secret': testSecret,
            'X-User-Id': `user-appender-${i}`,
            'X-Agent-Id': `agent-appender-${i}`,
          },
          body: JSON.stringify({
            operation: 'append_section',
            documentId: docName,
            heading: `Concurrent Appendix ${i}`,
            content: `Appendix text from worker ${i}.`,
          }),
        }).then((r) => r.json())
      );

      const suggestTasks = Array.from({ length: 10 }, (_, i) =>
        fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Gateway-Secret': testSecret,
            'X-User-Id': `user-suggester-${i}`,
            'X-Agent-Id': `agent-suggester-${i}`,
          },
          body: JSON.stringify({
            operation: 'suggest_edit_section',
            documentId: docName,
            targetHeading: 'Base Architecture',
            content: `The enterprise platform provides robust real-time collaborative editing using Yjs CRDTs (iteration ${i}).`,
          }),
        }).then((r) => r.json())
      );

      const mixedResults = await Promise.all([...appendTasks, ...suggestTasks]);

      // Assert all completed successfully
      for (const res of mixedResults) {
        expect(res.success).toBe(true);
      }

      await new Promise((r) => setTimeout(r, 400));
      const fragment = getDocumentFragment(humanDoc);
      expect(fragment.length).toBeGreaterThanOrEqual(11); // Initial + 10 appendices
    });
  });

  // =========================================================================
  // 4. Live Awareness Broadcast Verification
  // =========================================================================
  describe('4. Live Awareness Broadcast Verification', () => {
    it('verifies connected WebSocket client receives full agent awareness packet (cursor, color, label)', async () => {
      const { port, url } = await setupServer();
      const endpoint = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;
      const docName = 'post-awareness-live-verification';

      const { provider: clientProvider } = await connectClient(url, docName);

      const receivedAgentStates: any[] = [];
      clientProvider.awareness.on('update', () => {
        const states = Array.from(clientProvider.awareness.getStates().values());
        for (const s of states) {
          if (s?.user?.role === 'agent') {
            receivedAgentStates.push(s);
          }
        }
      });

      // Dispatch edit via Gateway
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'human-owner-42',
          'X-Agent-Id': 'reviewer-agent-99',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: docName,
          heading: 'Awareness Test Section',
          content: 'Testing live awareness broadcast.',
        }),
      });

      expect(res.status).toBe(200);

      // Wait for broadcast delivery
      await new Promise((r) => setTimeout(r, 300));

      expect(receivedAgentStates.length).toBeGreaterThan(0);
      const latest = receivedAgentStates[receivedAgentStates.length - 1];

      // Assert packet specification exactness
      expect(latest.user.name).toBe('[Agent: reviewer-agent-99]');
      expect(latest.user.color).toBe('#6366f1');
      expect(latest.user.role).toBe('agent');
      expect(latest.user.ownerUserId).toBe('human-owner-42');
      expect(latest.user.agentId).toBe('reviewer-agent-99');
      expect(latest.cursor).toBeDefined();
      expect(typeof latest.cursor.anchor).toBe('number');
      expect(typeof latest.cursor.head).toBe('number');
    });

    it('updates awareness status when agent performs suggest_edit_section', async () => {
      const { port, url } = await setupServer();
      const endpoint = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;
      const docName = 'post-awareness-suggest-status';

      // Seed section
      await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'owner-1',
          'X-Agent-Id': 'seed-bot',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: docName,
          heading: 'Data Integrity',
          content: 'Data must be validated strictly.',
        }),
      });

      const { provider: clientProvider } = await connectClient(url, docName);

      let observedStatus: string | null = null;
      clientProvider.awareness.on('update', () => {
        const states = Array.from(clientProvider.awareness.getStates().values());
        for (const s of states) {
          if (s?.user?.role === 'agent') {
            observedStatus = s.user.status;
          }
        }
      });

      // Suggest edit on 'Data Integrity'
      await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'owner-1',
          'X-Agent-Id': 'diff-bot',
        },
        body: JSON.stringify({
          operation: 'suggest_edit_section',
          documentId: docName,
          targetHeading: 'Data Integrity',
          content: 'Data must be validated rigorously and strictly.',
        }),
      });

      await new Promise((r) => setTimeout(r, 300));
      expect(observedStatus).toBe('Editing: Data Integrity');
    });

    it('verifies awareness for multiple distinct agents arriving sequentially', async () => {
      const { port, url } = await setupServer();
      const endpoint = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;
      const docName = 'post-multi-agent-awareness';

      const { provider: clientProvider } = await connectClient(url, docName);

      const agentNamesSeen = new Set<string>();
      clientProvider.awareness.on('update', () => {
        const states = Array.from(clientProvider.awareness.getStates().values());
        for (const s of states) {
          if (s?.user?.role === 'agent') {
            agentNamesSeen.add(s.user.name);
          }
        }
      });

      // Agent 1
      await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'owner-1',
          'X-Agent-Id': 'alpha-bot',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: docName,
          heading: 'Alpha',
          content: 'Alpha section.',
        }),
      });

      await new Promise((r) => setTimeout(r, 200));

      // Agent 2
      await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'owner-1',
          'X-Agent-Id': 'beta-bot',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: docName,
          heading: 'Beta',
          content: 'Beta section.',
        }),
      });

      await new Promise((r) => setTimeout(r, 200));

      expect(agentNamesSeen.has('[Agent: alpha-bot]')).toBe(true);
      expect(agentNamesSeen.has('[Agent: beta-bot]')).toBe(true);
    });
  });

  // =========================================================================
  // 5. UndoManager Isolation Guarantees (Ctrl+Z & Ctrl+Y)
  // =========================================================================
  describe('5. UndoManager Isolation Guarantees', () => {
    it('preserves agent edits across multi-step human undo and redo sequence', async () => {
      const { port, url } = await setupServer();
      const endpoint = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;
      const docName = 'post-undo-multi-sequence';

      // 1. Connect human client and create human UndoManager
      const { doc: humanDoc } = await connectClient(url, docName);
      const fragment = getDocumentFragment(humanDoc);
      const undoManager = createHumanUndoManager(fragment, {
        additionalTrackedOrigins: ['human-author'],
        captureTimeout: 0,
      });

      // 2. Human types Paragraph 1
      humanDoc.transact(() => {
        const p1 = new Y.XmlElement('paragraph');
        p1.push([new Y.XmlText('Human sentence one.')]);
        fragment.push([p1]);
      }, 'human-author');
      undoManager.stopCapturing();

      expect(undoManager.undoStack.length).toBe(1);

      // 3. Agent Gateway appends "Agent Section Alpha"
      await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'alice',
          'X-Agent-Id': 'agent-copilot',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: docName,
          heading: 'Agent Section Alpha',
          content: 'First agent section content.',
        }),
      });

      await new Promise((r) => setTimeout(r, 200));
      // Undo stack must STILL be 1 (agent edit ignored)
      expect(undoManager.undoStack.length).toBe(1);

      // 4. Human types Paragraph 2
      humanDoc.transact(() => {
        const p2 = new Y.XmlElement('paragraph');
        p2.push([new Y.XmlText('Human sentence two.')]);
        fragment.push([p2]);
      }, 'human-author');
      undoManager.stopCapturing();

      expect(undoManager.undoStack.length).toBe(2);

      // 5. Agent Gateway suggests edits to Agent Section Alpha
      await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'alice',
          'X-Agent-Id': 'agent-editor',
        },
        body: JSON.stringify({
          operation: 'suggest_edit_section',
          documentId: docName,
          targetHeading: 'Agent Section Alpha',
          content: 'Updated first agent section content with suggestions.',
        }),
      });

      await new Promise((r) => setTimeout(r, 200));
      expect(undoManager.undoStack.length).toBe(2);

      // 6. Human types Paragraph 3
      humanDoc.transact(() => {
        const p3 = new Y.XmlElement('paragraph');
        p3.push([new Y.XmlText('Human sentence three.')]);
        fragment.push([p3]);
      }, 'human-author');
      undoManager.stopCapturing();

      expect(undoManager.undoStack.length).toBe(3);

      // Helper to check for agent heading presence
      const hasAgentHeading = () => {
        for (let i = 0; i < fragment.length; i++) {
          const el = fragment.get(i);
          if (el instanceof Y.XmlElement && el.nodeName === 'heading') {
            const txt = el.get(0) instanceof Y.XmlText ? el.get(0).toString() : '';
            if (txt.includes('Agent Section Alpha')) return true;
          }
        }
        return false;
      };

      // 7. Human Undo 1 (Ctrl+Z): Reverts Paragraph 3
      undoManager.undo();
      expect(undoManager.undoStack.length).toBe(2);
      expect(hasAgentHeading()).toBe(true);

      // 8. Human Undo 2 (Ctrl+Z): Reverts Paragraph 2
      undoManager.undo();
      expect(undoManager.undoStack.length).toBe(1);
      expect(hasAgentHeading()).toBe(true);

      // 9. Human Undo 3 (Ctrl+Z): Reverts Paragraph 1
      undoManager.undo();
      expect(undoManager.undoStack.length).toBe(0);
      // All human paragraphs undone, BUT agent section is still fully intact!
      expect(hasAgentHeading()).toBe(true);

      // 10. Human Redo sequence (Ctrl+Y x3): Restores all human paragraphs
      undoManager.redo();
      expect(undoManager.undoStack.length).toBe(1);
      expect(hasAgentHeading()).toBe(true);

      undoManager.redo();
      expect(undoManager.undoStack.length).toBe(2);
      expect(hasAgentHeading()).toBe(true);

      undoManager.redo();
      expect(undoManager.undoStack.length).toBe(3);
      expect(hasAgentHeading()).toBe(true);
    });

    it('isolates UndoManager when agent modifies a document while human is actively typing', async () => {
      const { port, url } = await setupServer();
      const endpoint = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;
      const docName = 'post-undo-active-interleave';

      const { doc: humanDoc } = await connectClient(url, docName);
      const fragment = getDocumentFragment(humanDoc);
      const undoManager = createHumanUndoManager(fragment, {
        additionalTrackedOrigins: ['human-worker'],
      });

      // Human creates initial heading and text
      humanDoc.transact(() => {
        const h = new Y.XmlElement('heading');
        h.push([new Y.XmlText('Project Specifications')]);
        const p = new Y.XmlElement('paragraph');
        p.push([new Y.XmlText('Initial specification drafting.')]);
        fragment.push([h, p]);
      }, 'human-worker');

      // Interleave 5 human keystroke bursts and 3 agent gateway edits
      for (let i = 0; i < 3; i++) {
        // Human typing
        humanDoc.transact(() => {
          const p = new Y.XmlElement('paragraph');
          p.push([new Y.XmlText(`Human note iteration ${i}`)]);
          fragment.push([p]);
        }, 'human-worker');

        // Agent edit via Gateway
        await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Gateway-Secret': testSecret,
            'X-User-Id': 'human-owner',
            'X-Agent-Id': `agent-step-${i}`,
          },
          body: JSON.stringify({
            operation: 'append_section',
            documentId: docName,
            heading: `Appendix ${i}`,
            content: `Automated note ${i}`,
          }),
        });
      }

      await new Promise((r) => setTimeout(r, 200));

      // Human undoes all human keystroke operations
      while (undoManager.undoStack.length > 0) {
        undoManager.undo();
      }

      // All 3 agent appendices must remain intact
      let appendicesFound = 0;
      for (let i = 0; i < fragment.length; i++) {
        const el = fragment.get(i);
        if (el instanceof Y.XmlElement && el.nodeName === 'heading') {
          const t = el.get(0) instanceof Y.XmlText ? el.get(0).toString() : '';
          if (t.includes('Appendix')) appendicesFound++;
        }
      }

      expect(appendicesFound).toBe(3);
    });
  });
});
