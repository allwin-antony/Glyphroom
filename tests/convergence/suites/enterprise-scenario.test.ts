/**
 * Enterprise Blogger 2.0 — Enterprise Scenario Test Suite (Tier 4)
 * Simulates a production co-authoring session on an enterprise technical blog post
 * between 5 engineering co-authors and 1 AI review agent.
 */

import { describe, it, expect } from 'vitest';
import { ClientPool, NetworkSimulator } from '../harness/index.js';
import {
  exportDerivedMarkdown,
  AgentMetadata,
} from '@enterprise-blogger/shared';

describe('Tier 4: Real-World Application Scenario Suite', () => {
  it('executes full enterprise blog co-authoring session (5 engineers + 1 AI agent)', () => {
    const network = new NetworkSimulator({
      latencyMinTicks: 1,
      latencyMaxTicks: 4,
      dropRate: 0.02,
      reorderRate: 0.05,
    });

    const pool = new ClientPool({
      humanCount: 5,
      agentCount: 1,
      network,
    });

    const [lead, dbEng, feEng, devOps, secEng] = pool.getHumans();
    const agent = pool.getAgent();

    const agentMeta: AgentMetadata = {
      agentId: 'agent:tech-reviewer:v1',
      tokenId: 'tok-prod-scenario-001',
      ownerUserId: 'user:lead-architect',
      timestamp: Date.now(),
    };

    // --- Phase 1: Lead Author sets up initial blog post outline ---
    lead.insertHeading('Scaling Real-Time Collaboration with Yjs and CRDTs', 1);
    lead.insertParagraph('Enterprise Blogger 2.0 provides self-hosted collaborative editing for enterprise teams.');
    lead.insertHeading('1. Architecture Overview', 2);
    lead.insertParagraph('The collaboration engine uses Hocuspocus with standard WebSockets and a PostgreSQL persistence layer.');
    network.flush();

    // Verify initial sync
    pool.syncAllDirectly();
    expect(dbEng.getTextContent()).toContain('Scaling Real-Time Collaboration');
    lead.clearHistory();

    // --- Phase 2: Concurrent Multi-Author Section Writing ---
    // Engineer 2 (Database) adds Persistence section
    dbEng.insertHeading('2. PostgreSQL Bytea Storage', 2);
    dbEng.insertParagraph('Document snapshots are serialized via Y.encodeStateAsUpdate and saved as bytea blobs.');
    dbEng.insertCodeBlock('ALTER TABLE documents ADD COLUMN snapshot BYTEA NOT NULL;', 'sql');

    // Engineer 3 (Frontend) adds Custom ProseMirror Schema section
    feEng.insertHeading('3. Rich Schema and Mathematics', 2);
    feEng.insertParagraph('The editor supports GFM tables, alerts, and inline formulas like:');
    feEng.insertMathDisplay('\\lim_{n \\to \\infty} \\left(1 + \\frac{1}{n}\\right)^n = e');
    feEng.insertTable(3, 3, 'Benchmark');

    // Engineer 5 (Security) adds Security & Mermaid Sandboxing section
    secEng.insertHeading('4. Security and Isolation', 2);
    secEng.insertCallout('All Mermaid diagram blocks strictly enforce securityLevel: strict.', 'WARNING');
    secEng.insertMermaid('graph TD\n  User --> Gateway\n  Gateway --> Engine');

    network.flush();

    // --- Phase 3: AI Agent Review and Live Awareness ---
    // Agent broadcasts awareness status
    agent.awareness.setLocalStateField('user', {
      name: 'AI Technical Reviewer',
      color: '#dc2626',
      role: 'agent',
      status: 'Reviewing Architecture Section',
      cursor: { anchor: 120, head: 120 },
    });

    // Agent appends an Executive Summary section
    agent.appendSection('Executive Summary', 'This post explores zero-divergence collaborative editing across distributed teams.', agentMeta);

    // Agent proposes a diff suggestion on the Introduction (inserting suggestion mark)
    agent.suggestInsert(1, 18, ' high-throughput,', agentMeta);

    // Agent proposes deleting redundant words in Architecture
    agent.suggestDelete(3, 4, 13, agentMeta);

    network.flush();

    // --- Phase 4: DevOps Engineer works offline on train and reconnects ---
    pool.disconnectClient(devOps.id);
    devOps.insertHeading('5. Turnkey Production Deployment', 2);
    devOps.insertParagraph('Deploy via docker compose up -d with zero external host prerequisites.');
    devOps.insertCodeBlock('./scripts/deploy.sh --prod', 'bash');

    // Meanwhile, other engineers continue editing online
    lead.insertTextInBlock(1, 9999, ' Verified for high availability.');
    secEng.insertParagraph('Security audits passed with 100% permissive licenses.');
    network.flush();

    // DevOps reconnects and synchronizes
    pool.reconnectClient(devOps.id);
    network.flush();

    // --- Phase 5: Lead Author triggers an Undo and reviews suggestions ---
    // Lead author accidentally typed a bad sentence and undos it
    lead.insertTextInBlock(1, 9999, ' Temporary draft typo.');
    network.flush();
    pool.syncAllDirectly();
    expect(lead.getTextContent()).toContain('Temporary draft typo.');

    // Lead performs Ctrl+Z: only the typo is undone, agent suggestions are preserved
    lead.undo();
    network.flush();
    pool.syncAllDirectly();
    expect(lead.getTextContent()).not.toContain('Temporary draft typo.');
    expect(lead.getTextContent()).toContain('high-throughput');

    // --- Phase 6: Final Network Quiescence and Convergence Assertion ---
    network.flush(5000);
    pool.syncAllDirectly();

    // Assert 100% document convergence across all 6 clients
    pool.assertConvergence();

    // Assert every section from all 5 engineers and the agent exists in the final doc
    const finalContent = lead.getTextContent();
    expect(finalContent).toContain('Scaling Real-Time Collaboration');
    expect(finalContent).toContain('PostgreSQL Bytea Storage');
    expect(finalContent).toContain('Rich Schema and Mathematics');
    expect(finalContent).toContain('Security and Isolation');
    expect(finalContent).toContain('Turnkey Production Deployment');
    expect(finalContent).toContain('Executive Summary');
    expect(finalContent).toContain('Verified for high availability.');

    // --- Phase 7: Derived Markdown Export Verification ---
    // The derived Markdown export must cleanly strip pending AI insertions
    // while producing a valid, complete published blog post
    const docJson = lead.getDocJson();
    const markdown = exportDerivedMarkdown(docJson);

    expect(markdown).toContain('# Scaling Real-Time Collaboration with Yjs and CRDTs');
    expect(markdown).toContain('## 1. Architecture Overview');
    expect(markdown).toContain('## 2. PostgreSQL Bytea Storage');
    expect(markdown).toContain('## 3. Rich Schema and Mathematics');
    expect(markdown).toContain('## 4. Security and Isolation');
    expect(markdown).toContain('## 5. Turnkey Production Deployment');
    expect(markdown).toContain('## Executive Summary');
    expect(markdown).toContain('```sql');
    expect(markdown).toContain('```mermaid');
    expect(markdown).toContain('> [!WARNING]');
    expect(markdown).not.toContain('high-throughput'); // Pending insertion stripped from reader export!

    pool.destroy();
  });
});
