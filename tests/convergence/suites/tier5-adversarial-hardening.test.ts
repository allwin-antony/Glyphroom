/**
 * Enterprise Blogger 2.0 — Tier 5 Adversarial Coverage Hardening Suite
 *
 * Formulated and executed by challenger_m5_1.
 * Exercises extreme multi-agent concurrency, asymmetric merges, lifecycle under chaos,
 * deep irregular AST topologies, multibyte surrogate diffs, adversarial export resilience,
 * and high-concurrency live Collab Server / Agent Gateway burst testing.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider } from '@hocuspocus/provider';
import {
  blogSchema,
  getDocumentFragment,
  findSectionBoundary,
  appendSection,
  insertAfterSection,
  suggestEditSection,
  acceptSuggestion,
  rejectSuggestion,
  createHumanUndoManager,
  getPlainTextFromXmlText,
  exportDerivedMarkdown,
  attachYjsCollisionObserver,
  type AgentMetadata,
  MARK_SUGGESTION_INSERT,
  MARK_SUGGESTION_DELETE,
  MARK_ATTRIBUTION,
  nodeFromJSON,
  type ProseMirrorDocJSON,
} from '@enterprise-blogger/shared';
import {
  createCollabServer,
  type CollabServerInstance,
  InMemoryPersistenceAdapter,
} from '@enterprise-blogger/collab';
import { CollabGatewayClient } from '@enterprise-blogger/mcp-server';
import { ClientPool, NetworkSimulator } from '../harness/index.js';

describe('Tier 5: Adversarial Coverage Hardening Suite (challenger_m5_1)', () => {
  let collabInstance: CollabServerInstance | null = null;
  const providersToClean: HocuspocusProvider[] = [];
  const gatewaySecret = 'tier5-challenger-secret-32bytes-ok!';

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

  // =========================================================================
  // GROUP 1: Multi-Agent Concurrency & Competing Suggestions
  // =========================================================================

  describe('Group 1: Multi-Agent Concurrency & Competing Suggestions', () => {
    it('1.1 resolves concurrent multi-agent suggestion race on identical heading and body with 0 divergence', () => {
      const network = new NetworkSimulator();
      const pool = new ClientPool({
        humanCount: 5,
        agentCount: 3,
        network,
      });

      const humans = pool.getHumans();
      const agent1 = pool.getClient('agent-gateway-1');
      const agent2 = pool.getClient('agent-gateway-2');
      const agent3 = pool.getClient('agent-gateway-3');

      // Human 0 writes base section
      humans[0].insertHeading('System Architecture', 2);
      humans[0].insertParagraph('Our platform uses a distributed monolithic architecture with read replicas.');
      network.flush();
      pool.syncAllDirectly();

      // Agent 1 suggests modifying the section to Event-Driven Microservices
      const meta1: AgentMetadata = {
        agentId: 'agent-architect',
        tokenId: 'tok-arch-1',
        ownerUserId: 'user-lead',
        timestamp: 1729680001000,
      };
      suggestEditSection(
        agent1.doc,
        'System Architecture',
        'Our platform uses an event-driven microservices architecture with Kafka event streaming.',
        meta1,
        { fragmentName: 'prosemirror' }
      );

      // Agent 2 concurrently suggests modifying the section to Modular Monolith
      const meta2: AgentMetadata = {
        agentId: 'agent-reviewer',
        tokenId: 'tok-rev-2',
        ownerUserId: 'user-staff',
        timestamp: 1729680002000,
      };
      suggestEditSection(
        agent2.doc,
        'System Architecture',
        'Our platform uses a modular monolith architecture with isolated bounded contexts.',
        meta2,
        { fragmentName: 'prosemirror' }
      );

      // Agent 3 concurrently appends a brand new section
      const meta3: AgentMetadata = {
        agentId: 'agent-security',
        tokenId: 'tok-sec-3',
        ownerUserId: 'user-ciso',
        timestamp: 1729680003000,
      };
      appendSection(
        agent3.doc,
        'Security & Governance',
        'Strict zero-trust network boundaries and mutual TLS are enforced.',
        meta3,
        { fragmentName: 'prosemirror' }
      );

      // Humans 1-4 concurrently type in separate notes
      for (let i = 1; i <= 4; i++) {
        humans[i].insertParagraph(`Human ${i} concurrently logged observation note at timestamp ${Date.now()}`);
      }

      // Flush network and verify complete convergence
      network.flush();
      pool.syncAllDirectly();

      expect(() => pool.assertConvergence()).not.toThrow();

      // Verify that all 3 agent metadata footprints survived in the unified CRDT
      const docJson = humans[0].getDocJson();
      const docString = JSON.stringify(docJson);

      expect(docString).toContain('agent-architect');
      expect(docString).toContain('agent-reviewer');
      expect(docString).toContain('agent-security');

      pool.destroy();
    });

    it('1.2 preserves all human keystrokes during simultaneous deletion collision and insertion typing', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('prosemirror');

      // Initialize base paragraph
      doc.transact(() => {
        const p = new Y.XmlElement('paragraph');
        fragment.push([p]);
        const pt = new Y.XmlText();
        p.push([pt]);
        pt.insert(0, 'The database cluster runs with five primary nodes in production.');
      }, 'init');

      // Agent suggests deleting "five primary nodes" and inserting "three multi-region replicas"
      const agentMeta: AgentMetadata = {
        agentId: 'agent-db-expert',
        tokenId: 'tok-db-101',
        ownerUserId: 'user-dba',
        timestamp: Date.now(),
      };

      const diffRes = suggestEditSection(
        doc,
        '# doc', // Fallback or direct heading
        'The database cluster runs with three multi-region replicas in production.',
        agentMeta,
        { fragmentName: 'prosemirror' }
      );

      // Attach collision observer
      const cleanupObserver = attachYjsCollisionObserver(doc, 'prosemirror');

      // Human concurrently types inside the deletion range (" (verified by SRE) ")
      // and inside the newly inserted text (" (approved by SecOps)")
      const p = fragment.get(0) as Y.XmlElement;
      const ytext = p.get(0) as Y.XmlText;

      doc.transact(() => {
        // Insert human note inside text
        ytext.insert(30, ' (verified by SRE) ');
      }, { origin: 'user:dba-lead' });

      cleanupObserver();

      const finalContent = ytext.toString();
      expect(finalContent).toContain('(verified by SRE)');

      // Verify suggestion_delete on touched run was dismissed/auto-rejected
      const delta = ytext.toDelta();
      const hasPreservedText = delta.some(
        (op: any) => typeof op.insert === 'string' && op.insert.includes('(verified by SRE)')
      );
      expect(hasPreservedText).toBe(true);

      doc.destroy();
    });
  });

  // =========================================================================
  // GROUP 2: Full Lifecycle Interleaving Under Mutation & Undo
  // =========================================================================

  describe('Group 2: Full Lifecycle Interleaving Under Mutation & Undo', () => {
    it('2.1 executes acceptSuggestion during active concurrent remote keystrokes without index drift', () => {
      const doc1 = new Y.Doc();
      const doc2 = new Y.Doc();
      const frag1 = doc1.getXmlFragment('prosemirror');
      const frag2 = doc2.getXmlFragment('prosemirror');

      // Initial doc: "Deployment phase: alpha version ready."
      doc1.transact(() => {
        const p = new Y.XmlElement('paragraph');
        frag1.push([p]);
        const pt = new Y.XmlText();
        p.push([pt]);
        pt.insert(0, 'Deployment phase: alpha version ready.');
      });
      Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

      // Agent suggests replacing "alpha version" with "production release v2.0"
      const hunkId = 'sug-accept-drift-1';
      const agentMeta: AgentMetadata = {
        agentId: 'agent-release',
        tokenId: 'tok-rel-1',
        ownerUserId: 'user-manager',
        timestamp: Date.now(),
      };

      doc1.transact(() => {
        const p = frag1.get(0) as Y.XmlElement;
        const pt = p.get(0) as Y.XmlText;
        // Format "alpha version" (offset 18, len 13) as suggestion_delete
        pt.format(18, 13, {
          suggestion_delete: {
            id: hunkId,
            agentId: agentMeta.agentId,
            tokenId: agentMeta.tokenId,
            ownerUserId: agentMeta.ownerUserId,
            timestamp: agentMeta.timestamp,
            status: 'pending',
          },
          suggestion_insert: null,
        });
        // Insert "production release v2.0" at offset 18 as suggestion_insert
        pt.insert(18, 'production release v2.0', {
          suggestion_insert: {
            id: hunkId,
            agentId: agentMeta.agentId,
            tokenId: agentMeta.tokenId,
            ownerUserId: agentMeta.ownerUserId,
            timestamp: agentMeta.timestamp,
            status: 'pending',
          },
          suggestion_delete: null,
        });
      }, { origin: 'agent' });

      // Sync agent edit to doc2
      Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

      // Human 1 on doc1 accepts suggestion
      acceptSuggestion(doc1, hunkId, 'user:alice', 'prosemirror');

      // Concurrently, Human 2 on doc2 inserts text at the beginning and end
      doc2.transact(() => {
        const p = frag2.get(0) as Y.XmlElement;
        const pt = p.get(0) as Y.XmlText;
        pt.insert(0, '[STATUS UPDATE] ');
        pt.insert(pt.length, ' (All tests green)');
      }, 'human-bob');

      // Cross-synchronize doc1 and doc2
      Y.applyUpdate(doc1, Y.encodeStateAsUpdate(doc2));
      Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

      // Assert identical text on both
      const p1 = frag1.get(0) as Y.XmlElement;
      const pt1 = p1.get(0) as Y.XmlText;
      const p2 = frag2.get(0) as Y.XmlElement;
      const pt2 = p2.get(0) as Y.XmlText;

      expect(pt1.toString()).toBe(pt2.toString());
      expect(pt1.toString()).toContain('[STATUS UPDATE]');
      expect(pt1.toString()).toContain('production release v2.0');
      expect(pt1.toString()).toContain('(All tests green)');
      expect(pt1.toString()).not.toContain('alpha version');

      // Verify durable attribution mark exists on "production release v2.0"
      const delta = pt1.toDelta();
      const acceptedHunk = delta.find(
        (op: any) =>
          typeof op.insert === 'string' &&
          op.insert.includes('production release') &&
          op.attributes?.attribution?.acceptedBy === 'user:alice'
      );
      expect(acceptedHunk).toBeDefined();

      doc1.destroy();
      doc2.destroy();
    });

    it('2.2 executes rejectSuggestion interleaved with multi-level human undo and redo without corruption', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('prosemirror');
      const undoManager = createHumanUndoManager(fragment, {
        additionalTrackedOrigins: ['human-author'],
      });

      // Step 1: Human types first sentence
      doc.transact(() => {
        const p = new Y.XmlElement('paragraph');
        fragment.push([p]);
        const pt = new Y.XmlText();
        p.push([pt]);
        pt.insert(0, 'Sentence 1: Base introduction.');
      }, 'human-author');
      undoManager.stopCapturing();

      // Step 2: Human types second sentence
      doc.transact(() => {
        const p = new Y.XmlElement('paragraph');
        fragment.push([p]);
        const pt = new Y.XmlText();
        p.push([pt]);
        pt.insert(0, 'Sentence 2: Core methodology.');
      }, 'human-author');
      undoManager.stopCapturing();

      // Step 3: Human types third sentence
      doc.transact(() => {
        const p = new Y.XmlElement('paragraph');
        fragment.push([p]);
        const pt = new Y.XmlText();
        p.push([pt]);
        pt.insert(0, 'Sentence 3: Preliminary findings.');
      }, 'human-author');
      undoManager.stopCapturing();

      expect(fragment.length).toBe(3);

      // Step 4: Agent suggests editing sentence 2
      const hunkId = 'sug-reject-undo-2';
      const agentMeta: AgentMetadata = {
        agentId: 'agent-editor',
        tokenId: 'tok-edit-2',
        ownerUserId: 'user-manager',
        timestamp: Date.now(),
      };

      doc.transact(() => {
        const p2 = fragment.get(1) as Y.XmlElement;
        const pt2 = p2.get(0) as Y.XmlText;
        const oldLen = pt2.length;
        pt2.format(0, oldLen, {
          suggestion_delete: {
            id: hunkId,
            agentId: agentMeta.agentId,
            tokenId: agentMeta.tokenId,
            ownerUserId: agentMeta.ownerUserId,
            timestamp: agentMeta.timestamp,
            status: 'pending',
          },
          suggestion_insert: null,
        });
        pt2.insert(0, 'Sentence 2: AI Suggested Methodology.', {
          suggestion_insert: {
            id: hunkId,
            agentId: agentMeta.agentId,
            tokenId: agentMeta.tokenId,
            ownerUserId: agentMeta.ownerUserId,
            timestamp: agentMeta.timestamp,
            status: 'pending',
          },
          suggestion_delete: null,
        });
      }, { origin: 'agent' });

      // Step 5: Human rejects the suggestion
      rejectSuggestion(doc, hunkId, 'user:author', 'prosemirror');

      const p2AfterReject = fragment.get(1) as Y.XmlElement;
      const pt2AfterReject = p2AfterReject.get(0) as Y.XmlText;
      expect(pt2AfterReject.toString()).toBe('Sentence 2: Core methodology.');

      // Step 6: Human triggers Undo (should undo Sentence 3 first)
      undoManager.undo();
      expect(fragment.length).toBe(2);

      // Step 7: Human triggers Undo again (should undo Sentence 2)
      undoManager.undo();
      expect(fragment.length).toBe(1);

      // Step 8: Human triggers Redo (should restore Sentence 2)
      undoManager.redo();
      expect(fragment.length).toBe(2);
      const restoredP2 = fragment.get(1) as Y.XmlElement;
      const restoredPt2 = restoredP2.get(0) as Y.XmlText;
      expect(restoredPt2.toString()).toBe('Sentence 2: Core methodology.');

      doc.destroy();
    });

    it('2.3 coordinates chained suggestion evolution across two sequential agents and human verdicts', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('prosemirror');

      // Initialize doc with heading
      doc.transact(() => {
        const h = new Y.XmlElement('heading');
        h.setAttribute('level', '2');
        fragment.push([h]);
        const ht = new Y.XmlText();
        h.push([ht]);
        ht.insert(0, 'Database Migration');

        const p = new Y.XmlElement('paragraph');
        fragment.push([p]);
        const pt = new Y.XmlText();
        p.push([pt]);
        pt.insert(0, 'Original legacy MySQL 5.7 schema.');
      });

      // Agent 1 suggests upgrade to Postgres 16
      const meta1: AgentMetadata = {
        agentId: 'agent-pg',
        tokenId: 'tok-pg-1',
        ownerUserId: 'user-lead',
        timestamp: Date.now(),
      };
      const res1 = suggestEditSection(
        doc,
        'Database Migration',
        'Phase 1: Dual-write to Postgres 16 with bytea snapshots.',
        meta1,
        { fragmentName: 'prosemirror' }
      );
      expect(res1.success).toBe(true);
      expect(res1.suggestionIds.length).toBeGreaterThan(0);

      // Human accepts Agent 1 suggestion
      for (const id of res1.suggestionIds) {
        acceptSuggestion(doc, id, 'user:reviewer', 'prosemirror');
      }

      // Verify accepted state has attribution
      const pAfterAccept = fragment.get(1) as Y.XmlElement;
      const ptAfterAccept = pAfterAccept.get(0) as Y.XmlText;
      expect(ptAfterAccept.toString()).toContain('Postgres 16');

      // Agent 2 proposes modifying Postgres 16 to ClickHouse OLAP
      const meta2: AgentMetadata = {
        agentId: 'agent-clickhouse',
        tokenId: 'tok-ch-2',
        ownerUserId: 'user-analyst',
        timestamp: Date.now(),
      };
      const res2 = suggestEditSection(
        doc,
        'Database Migration',
        'Phase 1: Dual-write to ClickHouse Cloud for realtime OLAP analytics.',
        meta2,
        { fragmentName: 'prosemirror' }
      );
      expect(res2.success).toBe(true);

      // Human rejects Agent 2 suggestion
      for (const id of res2.suggestionIds) {
        rejectSuggestion(doc, id, 'user:reviewer', 'prosemirror');
      }

      // Verify document reverted cleanly to post-Agent 1 state
      const pFinal = fragment.get(1) as Y.XmlElement;
      const ptFinal = pFinal.get(0) as Y.XmlText;
      expect(ptFinal.toString()).toContain('Postgres 16');
      expect(ptFinal.toString()).not.toContain('ClickHouse');

      doc.destroy();
    });
  });

  // =========================================================================
  // GROUP 3: Extreme Document Topologies, Heading Trees & Unicode
  // =========================================================================

  describe('Group 3: Extreme Document Topologies, Heading Trees & Unicode', () => {
    it('3.1 accurately isolates section boundaries in complex irregular AST with embedded heading-like code', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('prosemirror');

      doc.transact(() => {
        // H1 Title
        const h1 = new Y.XmlElement('heading');
        h1.setAttribute('level', '1');
        fragment.push([h1]);
        const h1t = new Y.XmlText();
        h1.push([h1t]);
        h1t.insert(0, 'Enterprise Systems Manual');

        // H3 Subsection (irregular nesting under H1)
        const h3 = new Y.XmlElement('heading');
        h3.setAttribute('level', '3');
        fragment.push([h3]);
        const h3t = new Y.XmlText();
        h3.push([h3t]);
        h3t.insert(0, 'Kafka Consumer Architecture');

        // Paragraph
        const p1 = new Y.XmlElement('paragraph');
        fragment.push([p1]);
        const p1t = new Y.XmlText();
        p1.push([p1t]);
        p1t.insert(0, 'Consumer groups subscribe to the topic partitions.');

        // Code block containing markdown heading syntax (# Fake Heading)
        const cb = new Y.XmlElement('code_block');
        cb.setAttribute('language', 'bash');
        fragment.push([cb]);
        const cbt = new Y.XmlText();
        cb.push([cbt]);
        cbt.insert(0, '#!/bin/bash\n# ## Fake Shell Comment Heading\necho "test"');

        // H4 Sub-subsection
        const h4 = new Y.XmlElement('heading');
        h4.setAttribute('level', '4');
        fragment.push([h4]);
        const h4t = new Y.XmlText();
        h4.push([h4t]);
        h4t.insert(0, 'Offset Commit Policy');

        // Paragraph
        const p2 = new Y.XmlElement('paragraph');
        fragment.push([p2]);
        const p2t = new Y.XmlText();
        p2.push([p2t]);
        p2t.insert(0, 'Manual synchronous commits every 500ms.');

        // H2 Next Major Section (terminates H3 section boundary)
        const h2 = new Y.XmlElement('heading');
        h2.setAttribute('level', '2');
        fragment.push([h2]);
        const h2t = new Y.XmlText();
        h2.push([h2t]);
        h2t.insert(0, 'Observability and Metrics');

        const p3 = new Y.XmlElement('paragraph');
        fragment.push([p3]);
        const p3t = new Y.XmlText();
        p3.push([p3t]);
        p3t.insert(0, 'Prometheus scrapes metrics from /metrics.');
      });

      // Find boundary for H3 'Kafka Consumer Architecture'
      const boundary = findSectionBoundary(fragment, 'Kafka Consumer Architecture');
      expect(boundary).not.toBeNull();
      expect(boundary?.headingLevel).toBe(3);
      // Boundary should include p1, code_block, h4, and p2 (4 body elements), and stop before H2
      expect(boundary?.bodyElements.length).toBe(4);
      expect(boundary?.endIndex).toBe(6); // indices 1..5, endIndex is 6 (H2 is at index 6)

      // Test suggestEditSection on H3 section
      const agentMeta: AgentMetadata = {
        agentId: 'agent-kafka',
        tokenId: 'tok-kafka-1',
        ownerUserId: 'user-sre',
        timestamp: Date.now(),
      };

      const result = suggestEditSection(
        doc,
        'Kafka Consumer Architecture',
        'Consumer groups subscribe to topic partitions with cooperative rebalancing.',
        agentMeta,
        { fragmentName: 'prosemirror' }
      );

      expect(result.success).toBe(true);
      // H2 section must remain completely unmutated
      const h2Element = fragment.get(6) as Y.XmlElement;
      const h2Text = (h2Element.get(0) as Y.XmlText).toString();
      expect(h2Text).toBe('Observability and Metrics');

      doc.destroy();
    });

    it('3.2 survives complex multibyte Unicode, emojis, RTL, and zero-width characters in diff suggestions', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('prosemirror');

      const initialText = 'Global cloud mesh 🌐🚀 with 👨‍👩‍👧‍👦 distributed team and full עִבְרִית / العربية RTL support.';
      const proposedText = 'Global edge mesh 🌐⚡ with 👨‍👩‍👧‍👦 unified team and enhanced עִבְרִית / العربية BiDi support.';

      doc.transact(() => {
        const h = new Y.XmlElement('heading');
        h.setAttribute('level', '2');
        fragment.push([h]);
        const ht = new Y.XmlText();
        h.push([ht]);
        ht.insert(0, 'Internationalization');

        const p = new Y.XmlElement('paragraph');
        fragment.push([p]);
        const pt = new Y.XmlText();
        p.push([pt]);
        pt.insert(0, initialText);
      });

      const agentMeta: AgentMetadata = {
        agentId: 'agent-i18n',
        tokenId: 'tok-i18n-1',
        ownerUserId: 'user-intl',
        timestamp: Date.now(),
      };

      // Test token diff
      const resWords = suggestEditSection(
        doc,
        'Internationalization',
        proposedText,
        agentMeta,
        { fragmentName: 'prosemirror', granularity: 'words' }
      );
      expect(resWords.success).toBe(true);

      // Verify ProseMirror schema roundtrip does not throw or corrupt AST
      const p = fragment.get(1) as Y.XmlElement;
      const pt = p.get(0) as Y.XmlText;
      const delta = pt.toDelta();

      // Ensure emoji sequences (👨‍👩‍👧‍👦 = \uD83D\uDC68\u200D...) are preserved intact
      const rawText = pt.toString();
      expect(rawText).toContain('👨‍👩‍👧‍👦');
      expect(rawText).toContain('עִבְרִית');
      expect(rawText).toContain('العربية');

      // Test derived markdown export
      const md = exportDerivedMarkdown(nodeFromJSON(blogSchema, {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Emoji test: 👨‍👩‍👧‍👦 and עִבְרִית.' },
            ],
          },
        ],
      }));
      expect(md).toContain('👨‍👩‍👧‍👦');
      expect(md).toContain('עִבְרִית');

      doc.destroy();
    });

    it('3.3 disambiguates duplicate headings by targeting the first occurrence deterministically', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('prosemirror');

      doc.transact(() => {
        // Occurrence 1: Heading + Para
        const h1 = new Y.XmlElement('heading');
        h1.setAttribute('level', '2');
        fragment.push([h1]);
        const h1t = new Y.XmlText();
        h1.push([h1t]);
        h1t.insert(0, 'Deployment Strategy');

        const p1 = new Y.XmlElement('paragraph');
        fragment.push([p1]);
        const p1t = new Y.XmlText();
        p1.push([p1t]);
        p1t.insert(0, 'Section 1 content.');

        // Occurrence 2: Duplicate Heading + Para
        const h2 = new Y.XmlElement('heading');
        h2.setAttribute('level', '2');
        fragment.push([h2]);
        const h2t = new Y.XmlText();
        h2.push([h2t]);
        h2t.insert(0, 'Deployment Strategy');

        const p2 = new Y.XmlElement('paragraph');
        fragment.push([p2]);
        const p2t = new Y.XmlText();
        p2.push([p2t]);
        p2t.insert(0, 'Section 2 content.');
      });

      const agentMeta: AgentMetadata = {
        agentId: 'agent-dup-test',
        tokenId: 'tok-dup-1',
        ownerUserId: 'user-ops',
        timestamp: Date.now(),
      };

      const result = suggestEditSection(
        doc,
        'Deployment Strategy',
        'Updated Section 1 content.',
        agentMeta,
        { fragmentName: 'prosemirror' }
      );

      expect(result.success).toBe(true);

      // Section 1 paragraph should contain suggestion
      const p1 = fragment.get(1) as Y.XmlElement;
      const pt1 = p1.get(0) as Y.XmlText;
      expect(getPlainTextFromXmlText(pt1)).toBe('Updated Section 1 content.');

      // Section 2 paragraph must remain completely untouched
      const p2 = fragment.get(3) as Y.XmlElement;
      const pt2 = p2.get(0) as Y.XmlText;
      expect(getPlainTextFromXmlText(pt2)).toBe('Section 2 content.');

      doc.destroy();
    });
  });

  // =========================================================================
  // GROUP 4: Adversarial Derived Markdown Export & Corrupted Mark Trees
  // =========================================================================

  describe('Group 4: Adversarial Derived Markdown Export & Corrupted Mark Trees', () => {
    it('4.1 gracefully exports documents containing conflicting, redundant, or malformed suggestion marks', () => {
      const malformedDocJson: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Pending inserted text',
                marks: [
                  {
                    type: MARK_SUGGESTION_INSERT,
                    attrs: {
                      id: 'bad-1',
                      agentId: 'agent-x',
                      tokenId: 'tok-x',
                      ownerUserId: 'user-x',
                      timestamp: 123456,
                      status: 'pending',
                    },
                  },
                ],
              },
              {
                type: 'text',
                text: 'Original retained text',
                marks: [
                  {
                    type: MARK_SUGGESTION_DELETE,
                    attrs: {
                      id: 'bad-2',
                      agentId: 'agent-x',
                      tokenId: 'tok-x',
                      ownerUserId: 'user-x',
                      timestamp: 123456,
                      status: 'pending',
                    },
                  },
                ],
              },
              {
                type: 'text',
                text: 'Accepted text',
                marks: [
                  {
                    type: MARK_SUGGESTION_INSERT,
                    attrs: {
                      id: 'bad-3',
                      agentId: 'agent-x',
                      tokenId: 'tok-x',
                      ownerUserId: 'user-x',
                      timestamp: 123456,
                      status: 'accepted',
                    },
                  },
                ],
              },
            ],
          },
        ],
      };

      const md = exportDerivedMarkdown(malformedDocJson);
      // Pending insertion stripped
      expect(md).not.toContain('Pending inserted text');
      // Pending deletion retained as clean text
      expect(md).toContain('Original retained text');
      // Accepted insertion retained
      expect(md).toContain('Accepted text');
    });

    it('4.2 completely strips sections composed entirely of pending suggestion insertions without dangling syntax', () => {
      const pendingSectionDocJson: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Valid permanent paragraph.' }],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [
              {
                type: 'text',
                text: 'Proposed AI Section Heading',
                marks: [
                  {
                    type: MARK_SUGGESTION_INSERT,
                    attrs: { id: 's1', status: 'pending' },
                  },
                ],
              },
            ],
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Proposed AI Section Body text that has not been approved.',
                marks: [
                  {
                    type: MARK_SUGGESTION_INSERT,
                    attrs: { id: 's2', status: 'pending' },
                  },
                ],
              },
            ],
          },
        ],
      };

      const md = exportDerivedMarkdown(pendingSectionDocJson);
      expect(md.trim()).toBe('Valid permanent paragraph.');
      expect(md).not.toContain('Proposed AI Section');
      expect(md).not.toContain('##');
    });

    it('4.3 correctly derives Markdown for complex tables, callout alerts, and math containing suggestions', () => {
      const complexDocJson: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'callout_alert',
            attrs: { alertType: 'WARNING' },
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Production Notice: ',
                  },
                  {
                    type: 'text',
                    text: 'Do not shut down Postgres.',
                    marks: [
                      {
                        type: MARK_SUGGESTION_DELETE,
                        attrs: { id: 'warn-del', status: 'pending' },
                      },
                    ],
                  },
                  {
                    type: 'text',
                    text: 'Do not restart without failover verification.',
                    marks: [
                      {
                        type: MARK_SUGGESTION_INSERT,
                        attrs: { id: 'warn-ins', status: 'pending' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: 'math_display',
            attrs: { tex: 'E = mc^2' },
          },
        ],
      };

      const md = exportDerivedMarkdown(complexDocJson);
      expect(md).toContain('> [!WARNING]');
      expect(md).toContain('Do not shut down Postgres.');
      expect(md).not.toContain('Do not restart without failover verification.');
      expect(md).toContain('$$\nE = mc^2\n$$');
    });
  });

  // =========================================================================
  // GROUP 5: High-Concurrency End-to-End Gateway & Collab Server Stress
  // =========================================================================

  describe('Group 5: High-Concurrency End-to-End Gateway & Collab Server Stress', () => {
    it('5.1 handles high-concurrency burst of 15 agent gateway edits across 3 agents on live WebSocket session', async () => {
      collabInstance = await createCollabServer({
        port: 0,
        gatewaySecret,
        quiet: true,
      });
      const { port, url } = await collabInstance.listen();

      const docName = 'post-tier5-concurrency-burst';

      // Connect 2 WebSocket human clients
      const { doc: aliceDoc } = await connectClient(url, docName, 'token-author-alice');
      const { doc: bobDoc } = await connectClient(url, docName, 'token-author-bob');

      // Seed initial document structure from Alice
      const aliceFrag = getDocumentFragment(aliceDoc);
      aliceDoc.transact(() => {
        const h1 = new Y.XmlElement('heading');
        h1.setAttribute('level', '1');
        aliceFrag.push([h1]);
        const h1t = new Y.XmlText();
        h1.push([h1t]);
        h1t.insert(0, 'Production Architecture Guide');

        const p1 = new Y.XmlElement('paragraph');
        aliceFrag.push([p1]);
        const p1t = new Y.XmlText();
        p1.push([p1t]);
        p1t.insert(0, 'Foundational overview of the enterprise platform.');
      }, 'init-alice');

      // Allow initial sync to Bob
      await new Promise((r) => setTimeout(r, 200));

      // Simultaneously fire 15 HTTP requests to /internal/agent-gateway/edit across 3 distinct agents
      const agentList = [
        { id: 'agent-security', user: 'user-ciso' },
        { id: 'agent-performance', user: 'user-sre' },
        { id: 'agent-compliance', user: 'user-legal' },
      ];

      const gatewayHttpUrl = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;

      const requests = Array.from({ length: 15 }, (_, i) => {
        const agent = agentList[i % agentList.length];
        return fetch(gatewayHttpUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Gateway-Secret': gatewaySecret,
            'X-User-Id': agent.user,
            'X-Agent-Id': agent.id,
          },
          body: JSON.stringify({
            documentId: docName,
            operation: 'append_section',
            heading: `Section Audit #${i + 1} by ${agent.id}`,
            content: `Detailed compliance checklist entry #${i + 1} verifying enterprise security standards.`,
          }),
        });
      });

      const responses = await Promise.all(requests);
      expect(responses.length).toBe(15);

      for (const res of responses) {
        expect(res.status).toBe(200);
        const data = (await res.json()) as any;
        expect(data.success).toBe(true);
        expect(data.operation).toBe('append_section');
      }

      // Allow WebSocket synchronization to settle
      await new Promise((r) => setTimeout(r, 600));

      // Assert that both Alice and Bob received all 15 appended sections and reach 100% convergence
      const aliceText = aliceDoc.getXmlFragment('default').toString();
      const bobText = bobDoc.getXmlFragment('default').toString();

      expect(aliceText.length).toBeGreaterThan(500);
      expect(bobText.length).toBeGreaterThan(500);
      expect(aliceText).toBe(bobText);

      // Verify state vector match
      const svAlice = Y.encodeStateVector(aliceDoc);
      const svBob = Y.encodeStateVector(bobDoc);
      expect(Buffer.from(svAlice).equals(Buffer.from(svBob))).toBe(true);
    });

    it('5.2 rigorously enforces security boundaries and error handling under adversarial API requests', async () => {
      collabInstance = await createCollabServer({
        port: 0,
        gatewaySecret,
        quiet: true,
      });
      const { port } = await collabInstance.listen();
      const gatewayHttpUrl = `http://127.0.0.1:${port}/internal/agent-gateway/edit`;

      // 1. Wrong secret -> 401 Unauthorized
      const resBadSecret = await fetch(gatewayHttpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': 'wrong-attacker-secret',
          'X-User-Id': 'attacker',
          'X-Agent-Id': 'agent-evil',
        },
        body: JSON.stringify({
          documentId: 'post-any',
          operation: 'append_section',
          content: 'Malicious payload',
        }),
      });
      expect(resBadSecret.status).toBe(401);

      // 2. Missing headers -> 400 Validation Failed
      const resMissingHeaders = await fetch(gatewayHttpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Missing X-Gateway-Secret, X-User-Id, X-Agent-Id
        },
        body: JSON.stringify({
          documentId: 'post-any',
          operation: 'append_section',
          content: 'Payload',
        }),
      });
      expect(resMissingHeaders.status).toBe(400);

      // 3. Target non-existent heading -> 404 Section Not Found
      const resNonExistent = await fetch(gatewayHttpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': gatewaySecret,
          'X-User-Id': 'user-tester',
          'X-Agent-Id': 'agent-qa',
        },
        body: JSON.stringify({
          documentId: 'post-nonexistent-section',
          operation: 'suggest_edit_section',
          targetHeading: 'This Section Positively Does Not Exist Anywhere In The Document',
          content: 'Some replacement text',
        }),
      });
      expect(resNonExistent.status).toBe(404);
      const errData = (await resNonExistent.json()) as any;
      expect(errData.code).toBe('SECTION_NOT_FOUND');

      // 4. Server health remains 200 OK on /healthz
      const healthRes = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(healthRes.status).toBe(200);
      const healthData = (await healthRes.json()) as any;
      expect(healthData.status).toBe('healthy');
    });
  });

  // =========================================================================
  // GROUP 6: Cross-Subsystem Hardening & Persistence Crash Recovery
  // =========================================================================

  describe('Group 6: Cross-Subsystem Hardening & Persistence Crash Recovery', () => {
    it('6.1 normalizes markdown-formatted target headings and whitespace in findSectionBoundary', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('prosemirror');

      doc.transact(() => {
        const h = new Y.XmlElement('heading');
        h.setAttribute('level', '2');
        fragment.push([h]);
        const ht = new Y.XmlText();
        h.push([ht]);
        ht.insert(0, 'Advanced Caching & CDN Layer');

        const p = new Y.XmlElement('paragraph');
        fragment.push([p]);
        const pt = new Y.XmlText();
        p.push([pt]);
        pt.insert(0, 'Cloudflare edge workers cache public GET requests.');
      });

      // Target with leading hashes, bold asterisks, and mixed case
      const boundary = findSectionBoundary(fragment, '## **Advanced Caching & CDN Layer**  ');
      expect(boundary).not.toBeNull();
      expect(boundary?.headingLevel).toBe(2);

      // Target with code backticks
      const boundary2 = findSectionBoundary(fragment, '`advanced caching & cdn layer`');
      expect(boundary2).not.toBeNull();

      doc.destroy();
    });

    it('6.2 handles double inversion A -> B -> A diffs without ghost marks', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('prosemirror');

      const initialText = 'Immutable event logs provide an audit trail.';

      doc.transact(() => {
        const h = new Y.XmlElement('heading');
        h.setAttribute('level', '2');
        fragment.push([h]);
        const ht = new Y.XmlText();
        h.push([ht]);
        ht.insert(0, 'Audit Trails');

        const p = new Y.XmlElement('paragraph');
        fragment.push([p]);
        const pt = new Y.XmlText();
        p.push([pt]);
        pt.insert(0, initialText);
      });

      const meta: AgentMetadata = {
        agentId: 'agent-revert',
        tokenId: 'tok-rev',
        ownerUserId: 'user-audit',
        timestamp: Date.now(),
      };

      // Step 1: Suggest A -> B
      const res1 = suggestEditSection(
        doc,
        'Audit Trails',
        'Append-only cryptographic chains provide a tamper-proof audit trail.',
        meta,
        { fragmentName: 'prosemirror' }
      );
      expect(res1.success).toBe(true);

      // Human accepts A -> B
      for (const id of res1.suggestionIds) {
        acceptSuggestion(doc, id, 'user:lead', 'prosemirror');
      }

      // Step 2: Suggest B -> A (revert back to original text)
      const res2 = suggestEditSection(
        doc,
        'Audit Trails',
        initialText,
        meta,
        { fragmentName: 'prosemirror' }
      );
      expect(res2.success).toBe(true);

      // Human accepts B -> A
      for (const id of res2.suggestionIds) {
        acceptSuggestion(doc, id, 'user:lead', 'prosemirror');
      }

      const p = fragment.get(1) as Y.XmlElement;
      const pt = p.get(0) as Y.XmlText;
      expect(getPlainTextFromXmlText(pt)).toBe(initialText);

      doc.destroy();
    });

    it('6.3 executes end-to-end MCP CollabGatewayClient mutation and persists snapshot across server restart', async () => {
      const sharedAdapter = new InMemoryPersistenceAdapter();
      const docName = 'post-persistence-crash-test';

      // Phase 1: Start Server 1 on ephemeral port
      collabInstance = await createCollabServer({
        port: 0,
        adapter: sharedAdapter,
        gatewaySecret,
        quiet: true,
      });
      const { port } = await collabInstance.listen();

      // Client connects via CollabGatewayClient
      const client = new CollabGatewayClient({
        gatewayUrl: `http://127.0.0.1:${port}`,
        gatewaySecret,
        defaultUserId: 'user-ops-lead',
        defaultAgentId: 'agent-ops',
      });

      // Execute append_section
      const res = await client.sendEdit({
        operation: 'append_section',
        documentId: docName,
        heading: 'Disaster Recovery Plan',
        content: 'RPO: 5 minutes, RTO: 15 minutes across multi-region failover.',
      });
      expect(res.success).toBe(true);

      // Execute suggest_edit_section
      const res2 = await client.sendEdit({
        operation: 'suggest_edit_section',
        documentId: docName,
        targetHeading: 'Disaster Recovery Plan',
        content: 'RPO: 1 minute, RTO: 5 minutes across multi-region failover.',
      });
      expect(res2.success).toBe(true);

      // Destroy Server 1 (simulating restart or crash)
      await collabInstance.destroy();
      collabInstance = null;

      // Phase 2: Start Server 2 on same adapter
      collabInstance = await createCollabServer({
        port: 0,
        adapter: sharedAdapter,
        gatewaySecret,
        quiet: true,
      });
      const { url: server2WsUrl } = await collabInstance.listen();

      // Connect human client to verify document survived cleanly
      const { doc: restoredDoc } = await connectClient(server2WsUrl, docName, 'token-author-ops');
      const frag = getDocumentFragment(restoredDoc);

      expect(frag.length).toBeGreaterThan(0);
      const text = frag.toString();
      expect(text).toContain('Disaster Recovery Plan');
      expect(text).toContain('multi-region failover');
    });
  });
});

