import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { pino } from 'pino';
import { HocuspocusProvider } from '@hocuspocus/provider';
import {
  createHumanUndoManager,
  getDocumentFragment,
  extractTextFromElement,
} from '@enterprise-blogger/shared';
import { createCollabServer, type CollabServerInstance } from '@enterprise-blogger/collab';
import {
  createMcpServer,
  CollabGatewayClient,
} from '@enterprise-blogger/mcp-server';

describe('Milestone M4 Adversarial End-to-End Suite: MCP -> Gateway -> DirectConnection -> Yjs Suggestion -> WebSocket Broadcast', () => {
  let collabInstance: CollabServerInstance | null = null;
  const providersToClean: HocuspocusProvider[] = [];
  const gatewaySecret = 'adversarial-e2e-secret-key-32bytes';
  const logger = pino({ level: 'silent' });

  afterEach(async () => {
    while (providersToClean.length > 0) {
      const p = providersToClean.pop();
      try {
        p?.destroy();
      } catch {
        // ignore
      }
    }
    if (collabInstance) {
      await collabInstance.destroy();
      collabInstance = null;
    }
  });

  async function connectClient(url: string, documentName: string, token: string) {
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

  it('coordinates multi-client live co-editing, awareness propagation, concurrent typing preservation, and undo isolation', async () => {
    // 1. Start Collab server with Agent Gateway on ephemeral port
    collabInstance = await createCollabServer({
      port: 0,
      gatewaySecret,
      quiet: true,
    });
    const { port, url } = await collabInstance.listen();

    const docName = 'post-adversarial-m4-e2e';

    // 2. Connect two human editors: Alice and Bob
    const { doc: aliceDoc, provider: aliceProvider } = await connectClient(
      url,
      docName,
      'token-author-alice'
    );
    const { doc: bobDoc, provider: bobProvider } = await connectClient(
      url,
      docName,
      'token-author-bob'
    );

    const aliceFragment = getDocumentFragment(aliceDoc);
    const bobFragment = getDocumentFragment(bobDoc);

    const bobUndoManager = createHumanUndoManager(bobFragment, {
      additionalTrackedOrigins: ['bob-typing'],
    });

    // 3. Alice writes initial document structure
    aliceDoc.transact(() => {
      const h1 = new Y.XmlElement('heading');
      aliceFragment.push([h1]);
      h1.setAttribute('level', '1');
      const h1Text = new Y.XmlText();
      h1.push([h1Text]);
      h1Text.insert(0, 'Enterprise Architecture Overview');

      const p1 = new Y.XmlElement('paragraph');
      aliceFragment.push([p1]);
      const p1Text = new Y.XmlText();
      p1.push([p1Text]);
      p1Text.insert(0, 'This section outlines our migration to microservices.');

      const h2 = new Y.XmlElement('heading');
      aliceFragment.push([h2]);
      h2.setAttribute('level', '2');
      const h2Text = new Y.XmlText();
      h2.push([h2Text]);
      h2Text.insert(0, 'Current Infrastructure');

      const p2 = new Y.XmlElement('paragraph');
      aliceFragment.push([p2]);
      const p2Text = new Y.XmlText();
      p2.push([p2Text]);
      p2Text.insert(0, 'Legacy monolithic servers hosted on on-premise hardware.');
    }, 'alice-init');

    // Wait for WebSocket sync to Bob
    await new Promise((r) => setTimeout(r, 300));
    expect(bobFragment.length).toBe(4);

    // 4. Initialize MCP Server pointing to the running Collab Agent Gateway
    const gatewayClient = new CollabGatewayClient({
      gatewayUrl: `http://127.0.0.1:${port}/internal/agent-gateway/edit`,
      gatewaySecret,
      defaultUserId: 'user-architect-alice',
      defaultAgentId: 'agent-ai-assistant',
      defaultTokenId: 'token-e2e-1',
    });

    const mcpServer = createMcpServer({
      gatewayClient,
      logger,
    });
    const tools = (mcpServer as any)._registeredTools;

    // Track awareness state on Bob's client
    let bobObservedAgentAwareness = false;
    let agentAwarenessDetails: any = null;
    bobProvider.awareness?.on('update', () => {
      const states = Array.from(bobProvider.awareness?.getStates().values() || []);
      for (const s of states) {
        if (s?.user?.name === '[Agent: agent-ai-assistant]') {
          bobObservedAgentAwareness = true;
          agentAwarenessDetails = s.user;
        }
      }
    });

    // 5. MCP Tool: append_section
    const appendResult = await tools['append_section'].handler({
      postId: docName,
      heading: 'Security Standards',
      content: 'All API communication must enforce mutual TLS 1.3.',
    });
    expect(appendResult.isError).toBeUndefined();
    const appendOutput = JSON.parse(appendResult.content[0].text);
    expect(appendOutput.success).toBe(true);
    expect(appendOutput.operation).toBe('append_section');

    // Wait for WebSocket broadcast
    await new Promise((r) => setTimeout(r, 300));

    // Verify Bob received the appended section
    let bobFoundSecurityHeading = false;
    for (let i = 0; i < bobFragment.length; i++) {
      const el = bobFragment.get(i);
      if (el instanceof Y.XmlElement && el.nodeName === 'heading') {
        const text = extractTextFromElement(el);
        if (text.includes('Security Standards')) {
          bobFoundSecurityHeading = true;
        }
      }
    }
    expect(bobFoundSecurityHeading).toBe(true);

    // 6. MCP Tool: insert_after_section
    const insertResult = await tools['insert_after_section'].handler({
      postId: docName,
      targetHeading: 'Enterprise Architecture Overview',
      heading: 'Executive Summary',
      content: 'Target completion date is Q4 2027.',
    });
    expect(insertResult.isError).toBeUndefined();
    const insertOutput = JSON.parse(insertResult.content[0].text);
    expect(insertOutput.success).toBe(true);
    expect(insertOutput.operation).toBe('insert_after_section');

    await new Promise((r) => setTimeout(r, 300));

    // Verify Bob received the inserted section
    let bobFoundExecSummary = false;
    for (let i = 0; i < bobFragment.length; i++) {
      const el = bobFragment.get(i);
      if (el instanceof Y.XmlElement && el.nodeName === 'heading') {
        const text = extractTextFromElement(el);
        if (text.includes('Executive Summary')) {
          bobFoundExecSummary = true;
        }
      }
    }
    expect(bobFoundExecSummary).toBe(true);

    // 7. Concurrent Typing Keystroke Loss Test:
    // Bob types concurrently in "Current Infrastructure" while MCP agent suggests edits
    const bobTypingPromise = (async () => {
      for (let i = 0; i < 5; i++) {
        bobDoc.transact(() => {
          const p = new Y.XmlElement('paragraph');
          bobFragment.push([p]);
          const pt = new Y.XmlText();
          p.push([pt]);
          pt.insert(0, `Bob note #${i}: Verified load test metrics.`);
        }, 'bob-typing');
        await new Promise((r) => setTimeout(r, 20));
      }
    })();

    // MCP Tool: suggest_edit_section (applied concurrently with Bob's keystrokes)
    const suggestPromise = tools['suggest_edit_section'].handler({
      postId: docName,
      targetHeading: 'Security Standards',
      newContent: 'All API communication must enforce strict mutual TLS 1.3 and zero-trust certificates.',
      instruction: 'Refine zero-trust wording',
    });

    const [, suggestResult] = await Promise.all([bobTypingPromise, suggestPromise]);
    expect(suggestResult.isError).toBeUndefined();
    const suggestOutput = JSON.parse(suggestResult.content[0].text);
    expect(suggestOutput.success).toBe(true);
    expect(suggestOutput.changesSummary.insertions).toBeGreaterThan(0);

    // Allow sync to complete
    await new Promise((r) => setTimeout(r, 400));

    // Verify awareness was broadcast to Bob
    expect(bobObservedAgentAwareness).toBe(true);
    expect(agentAwarenessDetails.role).toBe('agent');
    expect(agentAwarenessDetails.color).toBe('#6366f1');

    // Verify Bob's 5 notes are all present (zero keystroke loss)
    let bobNotesCount = 0;
    for (let i = 0; i < bobFragment.length; i++) {
      const el = bobFragment.get(i);
      if (el instanceof Y.XmlElement && el.nodeName === 'paragraph') {
        const text = extractTextFromElement(el);
        if (text.includes('Bob note #')) {
          bobNotesCount++;
        }
      }
    }
    expect(bobNotesCount).toBe(5);

    // Verify Alice also received all 5 notes from Bob
    let aliceNotesCount = 0;
    for (let i = 0; i < aliceFragment.length; i++) {
      const el = aliceFragment.get(i);
      if (el instanceof Y.XmlElement && el.nodeName === 'paragraph') {
        const text = extractTextFromElement(el);
        if (text.includes('Bob note #')) {
          aliceNotesCount++;
        }
      }
    }
    expect(aliceNotesCount).toBe(5);

    // 8. Human Undo Isolation (Ctrl+Z):
    // Bob undos all his typing
    while (bobUndoManager.undoStack.length > 0) {
      bobUndoManager.undo();
    }

    // Verify Bob's notes are gone
    let bobNotesAfterUndo = 0;
    for (let i = 0; i < bobFragment.length; i++) {
      const el = bobFragment.get(i);
      if (el instanceof Y.XmlElement && el.nodeName === 'paragraph') {
        const text = extractTextFromElement(el);
        if (text.includes('Bob note #')) {
          bobNotesAfterUndo++;
        }
      }
    }
    expect(bobNotesAfterUndo).toBe(0);

    // CRITICAL: Verify that agent's suggestions, appends, and inserts were NOT reverted by Ctrl+Z!
    let foundExecSummaryAfterUndo = false;
    let foundSecurityAfterUndo = false;
    for (let i = 0; i < bobFragment.length; i++) {
      const el = bobFragment.get(i);
      if (el instanceof Y.XmlElement && el.nodeName === 'heading') {
        const text = extractTextFromElement(el);
        if (text.includes('Executive Summary')) foundExecSummaryAfterUndo = true;
        if (text.includes('Security Standards')) foundSecurityAfterUndo = true;
      }
    }
    expect(foundExecSummaryAfterUndo).toBe(true);
    expect(foundSecurityAfterUndo).toBe(true);

    // 9. Error handling over boundary: non-existent targetHeading
    const nonExistentResult = await tools['insert_after_section'].handler({
      postId: docName,
      targetHeading: 'Ghost Section That Does Not Exist',
      heading: 'Should Fail',
      content: 'Should not be inserted',
    });
    expect(nonExistentResult.isError).toBe(true);
    expect(nonExistentResult.content[0].text).toContain('[SECTION_NOT_FOUND]');

    // Confirm that the failed edit did not corrupt the document
    expect(bobFragment.length).toBeGreaterThan(0);
  });
});
