/**
 * Enterprise Blogger 2.0 — Concurrent Typing Keystroke Loss & Collision Test Suite
 * Validates that simulated human typing concurrently in a block where an agent suggests edits
 * loses zero keystrokes, and that suggestions and human inputs co-exist losslessly.
 */

import { describe, it, expect } from 'vitest';
import { ClientPool, NetworkSimulator } from '../harness/index.js';
import { AgentMetadata } from '@enterprise-blogger/shared';

describe('Tier 2 & Tier 3: Concurrent Typing Keystroke Loss Suite', () => {
  const agentMeta: AgentMetadata = {
    agentId: 'agent:reviewer:v1',
    tokenId: 'tok-collision-001',
    ownerUserId: 'user:lead-dev',
    timestamp: Date.now(),
  };

  it('1. human typing concurrently during agent suggestion insertion loses zero keystrokes', () => {
    const network = new NetworkSimulator();
    const pool = new ClientPool({ humanCount: 2, agentCount: 1, network });

    const human1 = pool.getClient('human-1');
    const agent = pool.getAgent();

    // Initial base paragraph
    human1.insertParagraph('The quick brown fox jumps over the lazy dog.');
    network.flush();

    // Concurrent burst: Human types 20 distinct keystrokes into the paragraph
    const humanKeystrokes = ' [Human typing concurrent notes]';
    for (let i = 0; i < humanKeystrokes.length; i++) {
      human1.insertTextInBlock(0, 10 + i, humanKeystrokes[i]);
    }

    // Agent concurrently suggests an edit in the same paragraph
    agent.suggestInsert(0, 5, ' [Agent Suggested Text] ', agentMeta);

    // Network flushes and clients sync
    network.flush();
    pool.syncAllDirectly();
    pool.assertConvergence();

    // Verify all human characters are present in the converged doc
    const finalText = human1.getTextContent();
    for (const char of humanKeystrokes.trim().split('')) {
      expect(finalText).toContain(char);
    }
    expect(finalText).toContain('[Human typing concurrent notes]');
    expect(finalText).toContain('[Agent Suggested Text]');

    pool.destroy();
  });

  it('2. multiple humans typing at opposite ends of a paragraph while agent suggests edits in the middle lose zero keystrokes', () => {
    const network = new NetworkSimulator();
    const pool = new ClientPool({ humanCount: 3, agentCount: 1, network });

    const human1 = pool.getClient('human-1');
    const human2 = pool.getClient('human-2');
    const agent = pool.getAgent();

    human1.insertParagraph('Start---Middle---End');
    network.flush();

    const h1Input = '<H1-PREFIX>';
    const h2Input = '<H2-SUFFIX>';
    const agentInput = '<AGENT-DIFF>';

    // Interleaved concurrent edits
    for (let i = 0; i < h1Input.length; i++) {
      human1.insertTextInBlock(0, i, h1Input[i]);
    }
    for (let i = 0; i < h2Input.length; i++) {
      human2.insertTextInBlock(0, 9999, h2Input[i]);
    }
    agent.suggestInsert(0, 8, agentInput, agentMeta);

    network.flush();
    pool.syncAllDirectly();
    pool.assertConvergence();

    const finalText = human1.getTextContent();
    expect(finalText).toContain(h1Input);
    expect(finalText).toContain(h2Input);
    expect(finalText).toContain(agentInput);

    pool.destroy();
  });

  it('3. human typing inside pending deletion range preserves human keystrokes', () => {
    const network = new NetworkSimulator();
    const pool = new ClientPool({ humanCount: 2, agentCount: 1, network });

    const human1 = pool.getClient('human-1');
    const agent = pool.getAgent();

    human1.insertParagraph('Section text to be reviewed and replaced.');
    network.flush();

    // Agent proposes deleting 'reviewed' (index 16, length 8)
    agent.suggestDelete(0, 16, 8, agentMeta);

    // Human concurrently types inside the deletion target
    const humanKeystrokes = 'EMERGENCY_OVERRIDE';
    human1.insertTextInBlock(0, 20, humanKeystrokes);

    network.flush();
    pool.syncAllDirectly();
    pool.assertConvergence();

    const finalText = human1.getTextContent();
    expect(finalText).toContain(humanKeystrokes);

    pool.destroy();
  });

  it('4. human and agent concurrent edits at exact identical offset 0', () => {
    const network = new NetworkSimulator();
    const pool = new ClientPool({ humanCount: 2, agentCount: 1, network });

    const human1 = pool.getClient('human-1');
    const agent = pool.getAgent();

    human1.insertParagraph('Anchor text.');
    network.flush();

    // Both insert at offset 0 simultaneously
    human1.insertTextInBlock(0, 0, '[HUMAN_AT_ZERO] ');
    agent.suggestInsert(0, 0, '[AGENT_AT_ZERO] ', agentMeta);

    network.flush();
    pool.syncAllDirectly();
    pool.assertConvergence();

    const finalText = human1.getTextContent();
    expect(finalText).toContain('[HUMAN_AT_ZERO]');
    expect(finalText).toContain('[AGENT_AT_ZERO]');

    pool.destroy();
  });

  it('5. 5 humans typing simultaneously while agent streams suggestions across 5 distinct paragraphs', () => {
    const network = new NetworkSimulator();
    const pool = new ClientPool({ humanCount: 5, agentCount: 1, network });

    const humans = pool.getHumans();
    const agent = pool.getAgent();

    // Seed 5 paragraphs
    for (let i = 0; i < 5; i++) {
      humans[0].insertParagraph(`Paragraph ${i} initial text.`);
    }
    network.flush();

    const expectedTokens: string[] = [];

    // Each human types in their assigned paragraph
    for (let i = 0; i < 5; i++) {
      const token = `[H${i + 1}-EDIT]`;
      expectedTokens.push(token);
      humans[i].insertTextInBlock(i, 5, token);
    }

    // Agent suggests edits in all 5 paragraphs
    for (let i = 0; i < 5; i++) {
      const agentToken = `[AGENT-SUGGESTION-${i}]`;
      expectedTokens.push(agentToken);
      agent.suggestInsert(i, 0, agentToken, agentMeta);
    }

    network.flush();
    pool.syncAllDirectly();
    pool.assertConvergence();

    const finalText = humans[0].getTextContent();
    for (const token of expectedTokens) {
      expect(finalText).toContain(token);
    }

    pool.destroy();
  });
});
