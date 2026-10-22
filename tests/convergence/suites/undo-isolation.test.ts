/**
 * Enterprise Blogger 2.0 — Undo Isolation Integration Test Suite
 * Validates that Ctrl+Z (UndoManager) reverses only human transactions and NEVER reverts agent suggestions.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { ClientPool, NetworkSimulator } from '../harness/index.js';
import { AgentMetadata } from '@enterprise-blogger/shared';

describe('Tier 3: Undo Isolation Test Suite', () => {
  const agentMeta: AgentMetadata = {
    agentId: 'agent:writer:v1',
    tokenId: 'tok-undo-001',
    ownerUserId: 'user:lead',
    timestamp: Date.now(),
  };

  it('1. Ctrl+Z undoes only human transactions and does not revert agent suggestions', () => {
    const network = new NetworkSimulator();
    const pool = new ClientPool({ humanCount: 1, agentCount: 1, network });

    const human = pool.getClient('human-1');
    const agent = pool.getAgent();

    // 1. Initial base text
    human.insertParagraph('Base paragraph.');
    network.flush();
    human.clearHistory();

    // 2. Human types additional text
    human.insertTextInBlock(0, 15, ' [Human Edit 1]');
    network.flush();

    // 3. Agent suggests an edit
    agent.suggestInsert(0, 5, ' [Agent Suggestion] ', agentMeta);
    network.flush();

    let textBeforeUndo = human.getTextContent();
    expect(textBeforeUndo).toContain('[Human Edit 1]');
    expect(textBeforeUndo).toContain('[Agent Suggestion]');

    // 4. Human performs Undo (Ctrl+Z)
    const undoSuccess = human.undo();
    expect(undoSuccess).toBe(true);
    network.flush();

    // 5. Verify human edit was reverted, but agent suggestion remains completely intact
    const textAfterUndo = human.getTextContent();
    expect(textAfterUndo).not.toContain('[Human Edit 1]');
    expect(textAfterUndo).toContain('[Agent Suggestion]');

    pool.destroy();
  });

  it('2. interleaved human typing and agent suggestions: human undo reverses only human edits', () => {
    const network = new NetworkSimulator();
    const pool = new ClientPool({ humanCount: 1, agentCount: 1, network });

    const human = pool.getClient('human-1');
    const agent = pool.getAgent();

    human.insertParagraph('Initial.');
    network.flush();
    human.clearHistory();

    // Human Edit A
    human.insertTextInBlock(0, 8, ' Human-A');
    network.flush();

    // Agent Suggestion X
    agent.suggestInsert(0, 0, 'Agent-X ', agentMeta);
    network.flush();

    // Human Edit B
    human.insertTextInBlock(0, 9999, ' Human-B');
    network.flush();

    // Agent Suggestion Y
    agent.suggestInsert(0, 9999, ' Agent-Y', agentMeta);
    network.flush();

    pool.syncAllDirectly();
    let currentText = human.getTextContent();
    expect(currentText).toContain('Human-A');
    expect(currentText).toContain('Human-B');
    expect(currentText).toContain('Agent-X');
    expect(currentText).toContain('Agent-Y');

    // First undo: reverses Human-B
    human.undo();
    network.flush();
    pool.syncAllDirectly();
    currentText = human.getTextContent();
    expect(currentText).not.toContain('Human-B');
    expect(currentText).toContain('Human-A');
    expect(currentText).toContain('Agent-X');
    expect(currentText).toContain('Agent-Y');

    // Second undo: reverses Human-A
    human.undo();
    network.flush();
    pool.syncAllDirectly();
    currentText = human.getTextContent();
    expect(currentText).not.toContain('Human-A');
    expect(currentText).toContain('Agent-X');
    expect(currentText).toContain('Agent-Y');

    pool.destroy();
  });

  it('3. human redo restores human edits without duplicating or corrupting agent suggestions', () => {
    const network = new NetworkSimulator();
    const pool = new ClientPool({ humanCount: 1, agentCount: 1, network });

    const human = pool.getClient('human-1');
    const agent = pool.getAgent();

    human.insertParagraph('Content:');
    network.flush();
    human.clearHistory();

    human.insertTextInBlock(0, 8, ' [Redo Test]');
    agent.suggestInsert(0, 0, 'Agent Prefix: ', agentMeta);
    network.flush();
    pool.syncAllDirectly();

    // Undo human edit
    human.undo();
    network.flush();
    pool.syncAllDirectly();
    expect(human.getTextContent()).not.toContain('[Redo Test]');
    expect(human.getTextContent()).toContain('Agent Prefix:');

    // Redo human edit
    const redoSuccess = human.redo();
    expect(redoSuccess).toBe(true);
    network.flush();
    pool.syncAllDirectly();

    expect(human.getTextContent()).toContain('[Redo Test]');
    expect(human.getTextContent()).toContain('Agent Prefix:');

    pool.destroy();
  });

  it('4. multi-human undo isolation: Human 1 undoing does not revert Human 2 edits or Agent suggestions', () => {
    const network = new NetworkSimulator();
    const pool = new ClientPool({ humanCount: 2, agentCount: 1, network });

    const human1 = pool.getClient('human-1');
    const human2 = pool.getClient('human-2');
    const agent = pool.getAgent();

    human1.insertParagraph('Document Canvas:');
    network.flush();
    human1.clearHistory();
    human2.clearHistory();

    // Human 1 edits
    human1.insertTextInBlock(0, 9999, ' [H1 Data]');
    network.flush();

    // Human 2 edits
    human2.insertTextInBlock(0, 9999, ' [H2 Data]');
    network.flush();

    // Agent suggests
    agent.suggestInsert(0, 9999, ' [Agent Data]', agentMeta);
    network.flush();
    pool.syncAllDirectly();

    // Human 1 undos
    human1.undo();
    network.flush();
    pool.syncAllDirectly();
    pool.assertConvergence();

    const finalText = human1.getTextContent();
    expect(finalText).not.toContain('[H1 Data]');
    expect(finalText).toContain('[H2 Data]');
    expect(finalText).toContain('[Agent Data]');

    pool.destroy();
  });

  it('5. human undo does not revert agent-appended sections', () => {
    const network = new NetworkSimulator();
    const pool = new ClientPool({ humanCount: 1, agentCount: 1, network });

    const human = pool.getClient('human-1');
    const agent = pool.getAgent();

    human.insertParagraph('Section 1 content.');
    network.flush();

    // Human edits section 1
    human.insertTextInBlock(0, 9999, ' Added by human.');
    network.flush();

    // Agent appends section 2
    agent.appendSection('Architecture Review', 'Agent detailed analysis block.', agentMeta);
    network.flush();
    pool.syncAllDirectly();

    expect(human.getTextContent()).toContain('Architecture Review');
    expect(human.getTextContent()).toContain('Added by human.');

    // Human triggers undo
    human.undo();
    network.flush();
    pool.syncAllDirectly();

    expect(human.getTextContent()).not.toContain('Added by human.');
    expect(human.getTextContent()).toContain('Architecture Review');
    expect(human.getTextContent()).toContain('Agent detailed analysis block.');

    pool.destroy();
  });
});
