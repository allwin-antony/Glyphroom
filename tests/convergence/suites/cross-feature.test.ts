/**
 * Enterprise Blogger 2.0 — Cross-Feature Combinations Test Suite (Tier 3)
 * Tests multi-feature interactions: agent suggestions inside tables, KaTeX, Mermaid;
 * typing collision during concurrent agent diffs; undo isolation during interleaved typing.
 */

import { describe, it, expect } from 'vitest';
import { ClientPool, NetworkSimulator } from '../harness/index.js';
import {
  tableFixture,
  exportDerivedMarkdown,
  AgentMetadata,
} from '@enterprise-blogger/shared';
import { complexTableFixture } from '../../schema/fixtures/index.js';

describe('Tier 3: Cross-Feature Combinations Suite', () => {
  const agentMeta: AgentMetadata = {
    agentId: 'agent:specialist:v1',
    tokenId: 'tok-combo-001',
    ownerUserId: 'user:lead-architect',
    timestamp: Date.now(),
  };

  it('1. agent suggestions inside table cells with concurrent human editing of adjacent cells', () => {
    const network = new NetworkSimulator();
    const pool = new ClientPool({
      humanCount: 2,
      agentCount: 1,
      initialDoc: tableFixture,
      network,
    });

    const human1 = pool.getClient('human-1');
    const human2 = pool.getClient('human-2');
    const agent = pool.getAgent();

    // Human 1 edits cell 0,0
    human1.insertTextInBlock(0, 0, '[H1-TABLE-EDIT] ');

    // Agent suggests insert into cell 0,1
    agent.suggestInsert(0, 5, ' [AGENT-TABLE-SUGGESTION] ', agentMeta);

    // Human 2 edits cell 0,2
    human2.insertTextInBlock(0, 9999, ' [H2-TABLE-EDIT]');

    network.flush();
    pool.syncAllDirectly();
    pool.assertConvergence();

    const json = human1.getDocJson();
    expect(JSON.stringify(json)).toContain('AGENT-TABLE-SUGGESTION');
    expect(JSON.stringify(json)).toContain('H1-TABLE-EDIT');
    expect(JSON.stringify(json)).toContain('H2-TABLE-EDIT');

    // Verify derived markdown export strips pending suggestion in table while retaining valid table syntax
    const md = exportDerivedMarkdown(json);
    expect(md).toContain('|');
    expect(md).toContain('Feature');
    expect(md).not.toContain('[AGENT-TABLE-SUGGESTION]');

    pool.destroy();
  });

  it('2. agent suggestions alongside KaTeX math blocks', () => {
    const network = new NetworkSimulator();
    const pool = new ClientPool({ humanCount: 2, agentCount: 1, network });

    const human1 = pool.getClient('human-1');
    const agent = pool.getAgent();

    // Human creates formula
    human1.insertMathDisplay('\\int_{a}^{b} f(x) dx = F(b) - F(a)');
    human1.insertParagraph('The fundamental theorem of calculus.');
    network.flush();

    // Agent suggests an edit to the explanatory text
    agent.suggestInsert(1, 4, ' definite ', agentMeta);

    network.flush();
    pool.syncAllDirectly();
    pool.assertConvergence();

    const docJson = human1.getDocJson();
    expect(JSON.stringify(docJson)).toContain('\\int_{a}^{b}');
    expect(JSON.stringify(docJson)).toContain('definite');

    pool.destroy();
  });

  it('3. agent suggestions inside Mermaid diagram text block', () => {
    const network = new NetworkSimulator();
    const pool = new ClientPool({ humanCount: 2, agentCount: 1, network });

    const human1 = pool.getClient('human-1');
    const agent = pool.getAgent();

    // Human creates mermaid diagram
    human1.insertMermaid('flowchart TD\n  Client --> Gateway\n  Gateway --> Collab');
    network.flush();

    // Agent suggests adding a database node to the diagram
    agent.suggestInsert(0, 9999, '\n  Collab --> DB[(PostgreSQL)]', agentMeta);

    network.flush();
    pool.syncAllDirectly();
    pool.assertConvergence();

    const docJson = human1.getDocJson();
    expect(JSON.stringify(docJson)).toContain('PostgreSQL');
    expect(docJson.content[0].type).toBe('mermaid_block');
    expect(docJson.content[0].attrs.securityLevel).toBe('strict');

    pool.destroy();
  });

  it('4. typing collision during concurrent agent diff replacement (delete + insert pair)', () => {
    const network = new NetworkSimulator();
    const pool = new ClientPool({ humanCount: 2, agentCount: 1, network });

    const human1 = pool.getClient('human-1');
    const agent = pool.getAgent();

    human1.insertParagraph('The old legacy algorithm must be replaced completely.');
    network.flush();

    // Agent performs diff replacement: delete 'old legacy' and insert 'modern CRDT'
    agent.suggestDelete(0, 4, 10, agentMeta); // marks 'old legacy' for deletion
    agent.suggestInsert(0, 14, 'modern CRDT ', agentMeta); // suggests 'modern CRDT'

    // Human concurrently types right at the diff insertion point
    human1.insertTextInBlock(0, 14, '[HUMAN_CONCURRENT_NOTE] ');

    network.flush();
    pool.syncAllDirectly();
    pool.assertConvergence();

    const finalText = human1.getTextContent();
    expect(finalText).toContain('[HUMAN_CONCURRENT_NOTE]');
    expect(finalText).toContain('modern CRDT');

    pool.destroy();
  });

  it('5. undo isolation inside GitHub alert callout with nested items', () => {
    const network = new NetworkSimulator();
    const pool = new ClientPool({ humanCount: 1, agentCount: 1, network });

    const human = pool.getClient('human-1');
    const agent = pool.getAgent();

    // Human creates callout alert
    human.insertCallout('Base alert message.', 'WARNING');
    network.flush();
    human.clearHistory();

    // Human types into alert
    human.insertTextInBlock(0, 9999, ' Additional human warning.');
    network.flush();

    // Agent suggests addition
    agent.suggestInsert(0, 0, '[AI Suggested Note] ', agentMeta);
    network.flush();
    pool.syncAllDirectly();

    expect(human.getTextContent()).toContain('Additional human warning.');
    expect(human.getTextContent()).toContain('[AI Suggested Note]');

    // Human triggers undo
    human.undo();
    network.flush();
    pool.syncAllDirectly();
    pool.assertConvergence();

    const finalText = human.getTextContent();
    expect(finalText).not.toContain('Additional human warning.');
    expect(finalText).toContain('[AI Suggested Note]');
    expect(finalText).toContain('Base alert message.');

    pool.destroy();
  });
});
