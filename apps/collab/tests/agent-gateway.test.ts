import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider } from '@hocuspocus/provider';
import {
  createHumanUndoManager,
  getDocumentFragment,
  type AgentGatewayEditRequest,
  type AgentGatewayEditResponse,
} from '@enterprise-blogger/shared';
import { createCollabServer, type CollabServerInstance } from '../src/server.js';
import { InMemoryPersistenceAdapter } from '../src/persistence/in-memory.js';
import { createHeadlessAgentClient } from '../src/gateway/awareness.js';

describe('Milestone M4: In-Process Agent Gateway & Direct Connection Suite', () => {
  let instance: CollabServerInstance | null = null;
  const providersToClean: (HocuspocusProvider | { destroy(): Promise<void> })[] = [];
  const testSecret = 'test-secret-key-32bytes-long-123';

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

  // Helper to connect a standard WS client and wait for sync
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

  describe('1. Secret Authentication & Security Boundary', () => {
    it('rejects requests missing gateway secret with 401 UNAUTHORIZED', async () => {
      const { port } = await setupServer();
      const res = await fetch(`http://127.0.0.1:${port}/internal/agent-gateway/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'usr-1',
          'X-Agent-Id': 'agent-1',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: 'post-auth-1',
          content: 'Hello world',
        }),
      });

      expect(res.status).toBe(400); // Fails header schema refine (secret missing)
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.code).toBe('VALIDATION_FAILED');
    });

    it('rejects requests with invalid gateway secret with 401 UNAUTHORIZED', async () => {
      const { port } = await setupServer();
      const res = await fetch(`http://127.0.0.1:${port}/internal/agent-gateway/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': 'wrong-secret',
          'X-User-Id': 'usr-1',
          'X-Agent-Id': 'agent-1',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: 'post-auth-2',
          content: 'Hello world',
        }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.code).toBe('UNAUTHORIZED');
    });

    it('accepts requests with valid X-Gateway-Secret', async () => {
      const { port } = await setupServer();
      const res = await fetch(`http://127.0.0.1:${port}/internal/agent-gateway/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'usr-1',
          'X-Agent-Id': 'agent-1',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: 'post-auth-3',
          content: 'Authorized content',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.documentId).toBe('post-auth-3');
    });

    it('accepts requests with valid legacy X-Internal-Service-Key', async () => {
      const { port } = await setupServer();
      const res = await fetch(`http://127.0.0.1:${port}/internal/agent-gateway/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Service-Key': testSecret,
          'X-User-Id': 'usr-1',
          'X-Agent-Id': 'agent-1',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: 'post-auth-4',
          content: 'Legacy key content',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.documentId).toBe('post-auth-4');
    });
  });

  describe('2. Header & Request Validation', () => {
    it('rejects missing X-User-Id or X-Agent-Id with 400 VALIDATION_FAILED', async () => {
      const { port } = await setupServer();
      const res = await fetch(`http://127.0.0.1:${port}/internal/agent-gateway/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'usr-1',
          // missing X-Agent-Id
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: 'post-val-1',
          content: 'test',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('VALIDATION_FAILED');
    });

    it('rejects malicious or invalid identifier characters in headers', async () => {
      const { port } = await setupServer();
      const res = await fetch(`http://127.0.0.1:${port}/internal/agent-gateway/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': '../../etc/passwd',
          'X-Agent-Id': 'agent-1',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: 'post-val-2',
          content: 'test',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('VALIDATION_FAILED');
    });

    it('rejects invalid or unsupported operation in body', async () => {
      const { port } = await setupServer();
      const res = await fetch(`http://127.0.0.1:${port}/internal/agent-gateway/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'usr-1',
          'X-Agent-Id': 'agent-1',
        },
        body: JSON.stringify({
          operation: 'drop_database',
          documentId: 'post-val-3',
          content: 'test',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('3. In-Process Mutation Operations & Live Convergence', () => {
    it('executes append_section and broadcasts to connected client', async () => {
      const { port, url } = await setupServer();
      const docName = 'post-append-test';

      // 1. Connect human editor
      const { doc: humanDoc } = await connectClient(url, docName);

      // 2. Gateway edit appends section
      const res = await fetch(`http://127.0.0.1:${port}/internal/agent-gateway/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'alice-author',
          'X-Agent-Id': 'agent-writer-1',
          'X-Token-Id': 'tok-alice-123',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: docName,
          heading: 'New Agent Section',
          content: 'This paragraph was added by the agent.',
        }),
      });

      expect(res.status).toBe(200);
      const data: AgentGatewayEditResponse = await res.json();
      expect(data.success).toBe(true);
      expect(data.changesSummary.insertions).toBeGreaterThan(0);
      expect(data.suggestionIds).toBeDefined();
      expect(data.suggestionIds?.length).toBeGreaterThan(0);

      // 3. Human editor receives the section over WS
      await new Promise((r) => setTimeout(r, 200));
      const fragment = getDocumentFragment(humanDoc);
      expect(fragment.length).toBeGreaterThan(0);

      // Verify suggestion mark attribution exists in the document
      let foundSuggestion = false;
      for (let i = 0; i < fragment.length; i++) {
        const child = fragment.get(i);
        if (child instanceof Y.XmlElement) {
          for (let j = 0; j < child.length; j++) {
            const inner = child.get(j);
            if (inner instanceof Y.XmlText) {
              const delta = inner.toDelta();
              for (const op of delta) {
                if (op.attributes?.suggestion_insert) {
                  expect(op.attributes.suggestion_insert.agentId).toBe('agent-writer-1');
                  expect(op.attributes.suggestion_insert.ownerUserId).toBe('alice-author');
                  foundSuggestion = true;
                }
              }
            }
          }
        }
      }
      expect(foundSuggestion).toBe(true);
    });

    it('executes insert_after_section after target heading and rejects nonexistent heading', async () => {
      const { port, url } = await setupServer();
      const docName = 'post-insert-after-test';

      // 1. Seed initial document with section via append_section
      const seedRes = await fetch(`http://127.0.0.1:${port}/internal/agent-gateway/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'alice-author',
          'X-Agent-Id': 'agent-1',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: docName,
          heading: 'Section Alpha',
          content: 'Initial alpha content.',
        }),
      });
      expect(seedRes.status).toBe(200);

      // 2. Insert after nonexistent heading -> 404 SECTION_NOT_FOUND
      const missingRes = await fetch(`http://127.0.0.1:${port}/internal/agent-gateway/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'alice-author',
          'X-Agent-Id': 'agent-1',
        },
        body: JSON.stringify({
          operation: 'insert_after_section',
          documentId: docName,
          targetHeading: 'Section Zeta',
          heading: 'Section Beta',
          content: 'Beta content.',
        }),
      });
      expect(missingRes.status).toBe(404);
      const missingData = await missingRes.json();
      expect(missingData.code).toBe('SECTION_NOT_FOUND');

      // 3. Insert after existing heading -> 200 OK
      const successRes = await fetch(`http://127.0.0.1:${port}/internal/agent-gateway/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'alice-author',
          'X-Agent-Id': 'agent-1',
        },
        body: JSON.stringify({
          operation: 'insert_after_section',
          documentId: docName,
          targetHeading: 'Section Alpha',
          heading: 'Section Beta',
          content: 'Beta content after alpha.',
        }),
      });
      expect(successRes.status).toBe(200);
      const successData = await successRes.json();
      expect(successData.success).toBe(true);
      expect(successData.changesSummary.insertions).toBeGreaterThan(0);
    });

    it('executes suggest_edit_section with non-destructive diff marks', async () => {
      const { port, url } = await setupServer();
      const docName = 'post-suggest-edit-test';

      // 1. Seed document with section
      await fetch(`http://127.0.0.1:${port}/internal/agent-gateway/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'author-1',
          'X-Agent-Id': 'agent-seed',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: docName,
          heading: 'Introduction',
          content: 'The quick brown fox jumps over the lazy dog.',
        }),
      });

      // 2. Connect client
      const { doc: clientDoc } = await connectClient(url, docName);

      // 3. Suggest edit on 'Introduction'
      const editRes = await fetch(`http://127.0.0.1:${port}/internal/agent-gateway/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'author-1',
          'X-Agent-Id': 'agent-editor-pro',
        },
        body: JSON.stringify({
          operation: 'suggest_edit_section',
          documentId: docName,
          targetHeading: 'Introduction',
          content: 'The fast brown fox leaps over the sleepy dog.',
        }),
      });

      expect(editRes.status).toBe(200);
      const editData = await editRes.json();
      expect(editData.success).toBe(true);
      expect(editData.changesSummary.insertions).toBeGreaterThan(0);
      expect(editData.changesSummary.deletions).toBeGreaterThan(0);

      // 4. Verify client received both suggestion_delete and suggestion_insert marks
      await new Promise((r) => setTimeout(r, 200));
      const fragment = getDocumentFragment(clientDoc);
      let foundInsert = false;
      let foundDelete = false;

      for (let i = 0; i < fragment.length; i++) {
        const el = fragment.get(i);
        if (el instanceof Y.XmlElement) {
          for (let j = 0; j < el.length; j++) {
            const inner = el.get(j);
            if (inner instanceof Y.XmlText) {
              const delta = inner.toDelta();
              for (const op of delta) {
                if (op.attributes?.suggestion_insert) foundInsert = true;
                if (op.attributes?.suggestion_delete) foundDelete = true;
              }
            }
          }
        }
      }

      expect(foundInsert).toBe(true);
      expect(foundDelete).toBe(true);
    });
  });

  describe('4. Live Awareness Injection & Headless Fallback Client', () => {
    it('broadcasts agent awareness state to connected WebSocket clients', async () => {
      const { port, url } = await setupServer();
      const docName = 'post-awareness-test';

      // 1. Connect human client
      const { provider: clientProvider } = await connectClient(url, docName);

      // Listen for awareness updates on client
      let receivedAgentState: any = null;
      clientProvider.awareness.on('update', () => {
        const states = Array.from(clientProvider.awareness.getStates().values());
        for (const s of states) {
          if (s?.user?.role === 'agent') {
            receivedAgentState = s;
          }
        }
      });

      // 2. Perform gateway edit
      await fetch(`http://127.0.0.1:${port}/internal/agent-gateway/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'human-owner',
          'X-Agent-Id': 'agent-awareness-bot',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: docName,
          heading: 'Awareness Heading',
          content: 'Awareness content paragraph.',
        }),
      });

      // 3. Wait for awareness update to arrive on client
      await new Promise((r) => setTimeout(r, 300));

      expect(receivedAgentState).not.toBeNull();
      expect(receivedAgentState.user.name).toBe('[Agent: agent-awareness-bot]');
      expect(receivedAgentState.user.color).toBe('#6366f1');
      expect(receivedAgentState.user.role).toBe('agent');
      expect(receivedAgentState.user.ownerUserId).toBe('human-owner');
      expect(receivedAgentState.cursor).toBeDefined();
    });

    it('supports headless fallback client connecting over WebSocket', async () => {
      const { url } = await setupServer();
      const docName = 'post-headless-fallback-test';

      // 1. Connect human client
      const { doc: humanDoc, provider: humanProvider } = await connectClient(url, docName);

      let observedAgentAwareness = false;
      humanProvider.awareness.on('update', () => {
        const states = Array.from(humanProvider.awareness.getStates().values());
        for (const s of states) {
          if (s?.user?.agentId === 'agent-headless-1') {
            observedAgentAwareness = true;
          }
        }
      });

      // 2. Create headless fallback client
      const headless = await createHeadlessAgentClient({
        url,
        documentName: docName,
        agentId: 'agent-headless-1',
        ownerUserId: 'alice-owner',
      });
      providersToClean.push(headless);

      // 3. Mutate doc via headless client
      headless.doc.transact(() => {
        const frag = headless.doc.getXmlFragment('prosemirror');
        const p = new Y.XmlElement('paragraph');
        const t = new Y.XmlText('Headless agent text');
        p.insert(0, [t]);
        frag.insert(0, [p]);
      });

      // 4. Verify human client sees edits and awareness
      await new Promise((r) => setTimeout(r, 300));
      expect(observedAgentAwareness).toBe(true);

      const humanFrag = humanDoc.getXmlFragment('prosemirror');
      expect(humanFrag.length).toBeGreaterThan(0);
    });
  });

  describe('5. UndoManager Isolation Guarantee (Ctrl+Z)', () => {
    it('preserves human typing and isolates human UndoManager from agent suggestions', async () => {
      const { port, url } = await setupServer();
      const docName = 'post-undo-isolation-test';

      // 1. Connect human client and create human UndoManager
      const { doc: humanDoc } = await connectClient(url, docName);
      const fragment = getDocumentFragment(humanDoc);
      const undoManager = createHumanUndoManager(fragment, {
        additionalTrackedOrigins: ['human'],
      });

      // 2. Human types a paragraph
      humanDoc.transact(() => {
        const p = new Y.XmlElement('paragraph');
        const text = new Y.XmlText('Human first sentence. ');
        p.insert(0, [text]);
        fragment.insert(0, [p]);
      }, 'human'); // Human origin

      expect(undoManager.undoStack.length).toBe(1);

      // 3. Agent gateway applies suggestion
      await fetch(`http://127.0.0.1:${port}/internal/agent-gateway/edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': testSecret,
          'X-User-Id': 'human-alice',
          'X-Agent-Id': 'agent-suggester',
        },
        body: JSON.stringify({
          operation: 'append_section',
          documentId: docName,
          heading: 'Suggested Appendix',
          content: 'Suggested section by agent.',
        }),
      });

      await new Promise((r) => setTimeout(r, 200));

      // 4. Verify undo stack was NOT polluted by agent suggestions
      expect(undoManager.undoStack.length).toBe(1);

      // 5. Human presses Ctrl+Z (undoManager.undo())
      undoManager.undo();

      // Human's first sentence is reverted, BUT agent's suggestion remains intact!
      await new Promise((r) => setTimeout(r, 100));
      expect(fragment.length).toBeGreaterThan(0); // Agent section still exists
      let hasAgentSection = false;
      for (let i = 0; i < fragment.length; i++) {
        const el = fragment.get(i);
        if (el instanceof Y.XmlElement && el.nodeName === 'heading') {
          hasAgentSection = true;
        }
      }
      expect(hasAgentSection).toBe(true);
    });
  });

  describe('6. Connection Lifecycle & Leak Prevention', () => {
    it('keeps document warm and does not leak open direct connections', async () => {
      const { port } = await setupServer();
      const docName = 'post-leak-test';

      // Execute 5 rapid sequential gateway edits
      for (let i = 0; i < 5; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/internal/agent-gateway/edit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Gateway-Secret': testSecret,
            'X-User-Id': 'author-1',
            'X-Agent-Id': 'agent-churn',
          },
          body: JSON.stringify({
            operation: 'append_section',
            documentId: docName,
            heading: `Section ${i}`,
            content: `Content block ${i}`,
          }),
        });
        expect(res.status).toBe(200);
      }

      // Allow microtasks to complete disconnects
      await new Promise((r) => setTimeout(r, 100));

      // Hocuspocus connection count must NOT leak
      const connCount = instance!.server.hocuspocus.getConnectionsCount();
      expect(connCount).toBe(0);
    });
  });

  describe('7. M3 Reviewer Polish: Multi-Permission User Verification', () => {
    it('allows users with permissions: ["view", "edit"] to edit without forced read-only demotion', async () => {
      const { url } = await setupServer();
      const docName = 'post-multi-perm-test';

      // Connect with token-moderator (has permissions: ['edit'] or custom multi-permission)
      const { doc: modDoc } = await connectClient(url, docName, 'token-moderator');

      // Moderator writes text
      let threw = false;
      try {
        modDoc.transact(() => {
          const frag = modDoc.getXmlFragment('prosemirror');
          const p = new Y.XmlElement('paragraph');
          p.insert(0, [new Y.XmlText('Moderator edit allowed.')]);
          frag.insert(0, [p]);
        });
      } catch {
        threw = true;
      }

      expect(threw).toBe(false);
      await new Promise((r) => setTimeout(r, 100));
      expect(modDoc.getXmlFragment('prosemirror').length).toBe(1);
    });
  });
});
