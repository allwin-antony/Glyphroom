import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { pino } from 'pino';
import { HocuspocusProvider } from '@hocuspocus/provider';
import {
  createHumanUndoManager,
  getDocumentFragment,
} from '@enterprise-blogger/shared';
import { createCollabServer, type CollabServerInstance } from '@enterprise-blogger/collab';
import {
  createMcpServer,
  CollabGatewayClient,
} from '@enterprise-blogger/mcp-server';

describe('Milestone M4 End-to-End: MCP Tool -> Agent Gateway -> Collab Server -> Live Human Client', () => {
  let collabInstance: CollabServerInstance | null = null;
  const providersToClean: HocuspocusProvider[] = [];
  const gatewaySecret = 'm4-e2e-gateway-secret-32bytes-123';
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

  it('coordinates end-to-end MCP tool calls with live WebSocket co-editing and undo isolation', async () => {
    // 1. Start Collab server with Agent Gateway on ephemeral port
    collabInstance = await createCollabServer({
      port: 0,
      gatewaySecret,
      quiet: true,
    });
    const { port, url } = await collabInstance.listen();

    const docName = 'post-mcp-e2e-demo';

    // 2. Connect human editor over standard WebSockets
    const { doc: humanDoc, provider: humanProvider } = await connectClient(url, docName);
    const fragment = getDocumentFragment(humanDoc);
    const undoManager = createHumanUndoManager(fragment, {
      additionalTrackedOrigins: ['human'],
    });

    // Human writes initial draft
    humanDoc.transact(() => {
      const h = new Y.XmlElement('heading');
      h.setAttribute('level', '1');
      const ht = new Y.XmlText('Enterprise Cloud Architecture');
      h.push([ht]);

      const p = new Y.XmlElement('paragraph');
      const pt = new Y.XmlText('Overview of cloud native migration strategies.');
      p.push([pt]);

      fragment.push([h, p]);
    }, 'human');

    expect(undoManager.undoStack.length).toBe(1);

    // 3. Initialize MCP server and client pointing to the Collab Agent Gateway
    const gatewayClient = new CollabGatewayClient({
      gatewayUrl: `http://127.0.0.1:${port}/internal/agent-gateway/edit`,
      gatewaySecret,
      defaultUserId: 'user-cloud-architect',
      defaultAgentId: 'agent-devops-copilot',
      defaultTokenId: 'tok-pat-12345',
    });

    const mcpServer = createMcpServer({
      gatewayClient,
      logger,
    });
    const tools = (mcpServer as any)._registeredTools;

    // Track live awareness state on the human editor side
    let observedAgentAwareness = false;
    humanProvider.awareness?.on('update', () => {
      const states = Array.from(humanProvider.awareness?.getStates().values() || []);
      for (const s of states) {
        if (s?.user?.name === '[Agent: agent-devops-copilot]') {
          observedAgentAwareness = true;
        }
      }
    });

    // 4. MCP Agent invokes append_section
    const appendResult = await tools['append_section'].handler({
      postId: docName,
      heading: 'Security & Compliance',
      content: 'All workloads must enforce mutual TLS and zero-trust authentication.',
    });
    expect(appendResult.isError).toBeUndefined();
    const appendOutput = JSON.parse(appendResult.content[0].text);
    expect(appendOutput.success).toBe(true);
    expect(appendOutput.operation).toBe('append_section');

    // 5. MCP Agent invokes insert_after_section
    const insertResult = await tools['insert_after_section'].handler({
      postId: docName,
      targetHeading: 'Enterprise Cloud Architecture',
      heading: 'Executive Summary',
      content: 'This document defines the roadmap for 2027.',
    });
    expect(insertResult.isError).toBeUndefined();
    const insertOutput = JSON.parse(insertResult.content[0].text);
    expect(insertOutput.success).toBe(true);
    expect(insertOutput.operation).toBe('insert_after_section');

    // 6. MCP Agent invokes suggest_edit_section
    const suggestResult = await tools['suggest_edit_section'].handler({
      postId: docName,
      targetHeading: 'Security & Compliance',
      newContent: 'All enterprise workloads must enforce strict mutual TLS and zero-trust IAM policies.',
      instruction: 'Refine policy terminology',
    });
    expect(suggestResult.isError).toBeUndefined();
    const suggestOutput = JSON.parse(suggestResult.content[0].text);
    expect(suggestOutput.success).toBe(true);
    expect(suggestOutput.operation).toBe('suggest_edit_section');
    expect(suggestOutput.suggestionsCount).toBeGreaterThan(0);

    // 7. Allow sync to complete over WebSockets
    await new Promise((r) => setTimeout(r, 400));

    // Verify human editor observed live awareness
    expect(observedAgentAwareness).toBe(true);

    // Verify UndoManager isolation: human undo stack still contains only human edit
    expect(undoManager.undoStack.length).toBe(1);

    // Human performs Ctrl+Z: reverts only human edits, leaving all agent suggestions intact
    undoManager.undo();

    // Verify agent's appended and inserted sections are still present
    let hasExecutiveSummary = false;
    let hasSecurity = false;
    for (let i = 0; i < fragment.length; i++) {
      const el = fragment.get(i);
      if (el instanceof Y.XmlElement && el.nodeName === 'heading') {
        const text = el.get(0) instanceof Y.XmlText ? el.get(0).toString() : '';
        if (text.includes('Executive Summary')) hasExecutiveSummary = true;
        if (text.includes('Security & Compliance')) hasSecurity = true;
      }
    }

    expect(hasExecutiveSummary).toBe(true);
    expect(hasSecurity).toBe(true);
  });
});
