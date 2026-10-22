/**
 * Enterprise Blogger 2.0 — Boundary & Corner Cases Test Suite (Tier 2)
 * Tests boundary conditions: empty documents, maximum section sizes, rapid concurrent
 * edits at identical offsets, and network disconnects during active agent transactions.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { ClientPool, NetworkSimulator } from '../harness/index.js';
import { emptyDocFixture, largeSectionFixture } from '../../schema/fixtures/index.js';
import { AgentMetadata } from '@enterprise-blogger/shared';

describe('Tier 2: Boundary & Corner Cases Suite', () => {
  const agentMeta: AgentMetadata = {
    agentId: 'agent:boundary-tester',
    tokenId: 'tok-boundary-001',
    ownerUserId: 'user:qa-lead',
    timestamp: Date.now(),
  };

  it('1. handles collaboration on completely empty document without null-pointer errors', () => {
    const network = new NetworkSimulator();
    const pool = new ClientPool({
      humanCount: 3,
      agentCount: 1,
      initialDoc: emptyDocFixture,
      network,
    });

    const human1 = pool.getClient('human-1');
    const human2 = pool.getClient('human-2');
    const agent = pool.getAgent();

    // Human 1 inserts first paragraph into empty doc
    human1.insertParagraph('First paragraph.');
    network.flush();

    // Agent suggests insert into the newly created paragraph
    agent.suggestInsert(0, 5, ' [Agent Suggested] ', agentMeta);

    // Human 2 deletes text in the paragraph
    human2.deleteTextInBlock(0, 0, 3);

    network.flush();
    pool.syncAllDirectly();
    pool.assertConvergence();

    expect(human1.getTextContent().length).toBeGreaterThan(0);
    pool.destroy();
  });

  it('2. stress tests maximum section sizes (100KB+ text block) across all 6 clients', () => {
    const network = new NetworkSimulator({ latencyMinTicks: 1, latencyMaxTicks: 2 });
    const pool = new ClientPool({
      humanCount: 5,
      agentCount: 1,
      initialDoc: largeSectionFixture,
      network,
    });

    const humans = pool.getHumans();
    const agent = pool.getAgent();

    // Verify initial size is large (>90KB)
    const initialText = humans[0].getTextContent();
    expect(initialText.length).toBeGreaterThan(90000);

    // Humans make edits at various offsets
    humans[0].insertTextInBlock(1, 0, '[START-OF-LARGE-SECTION] ');
    humans[2].insertTextInBlock(1, 50000, ' [MID-LARGE-SECTION] ');
    humans[4].insertTextInBlock(1, 90000, ' [END-OF-LARGE-SECTION]');

    // Agent suggests edits in large section
    agent.suggestInsert(1, 25000, ' [AGENT-LARGE-SUGGESTION] ', agentMeta);

    network.flush();
    pool.syncAllDirectly();
    pool.assertConvergence();

    const finalText = humans[0].getTextContent();
    expect(finalText).toContain('[START-OF-LARGE-SECTION]');
    expect(finalText).toContain('[MID-LARGE-SECTION]');
    expect(finalText).toContain('[END-OF-LARGE-SECTION]');
    expect(finalText).toContain('[AGENT-LARGE-SUGGESTION]');

    pool.destroy();
  });

  it('3. rapid concurrent edits at exact identical offset 0 across 5 humans and 1 agent', () => {
    const network = new NetworkSimulator();
    const pool = new ClientPool({ humanCount: 5, agentCount: 1, network });

    const humans = pool.getHumans();
    const agent = pool.getAgent();

    humans[0].insertParagraph('Base target text.');
    network.flush();

    // All 6 clients concurrently insert text at offset 0
    for (let i = 0; i < 5; i++) {
      humans[i].insertTextInBlock(0, 0, `[H${i + 1}-OFFSET-0] `);
    }
    agent.suggestInsert(0, 0, '[AGENT-OFFSET-0] ', agentMeta);

    network.flush();
    pool.syncAllDirectly();
    pool.assertConvergence();

    const finalText = humans[0].getTextContent();
    for (let i = 1; i <= 5; i++) {
      expect(finalText).toContain(`[H${i}-OFFSET-0]`);
    }
    expect(finalText).toContain('[AGENT-OFFSET-0]');

    pool.destroy();
  });

  it('4. network disconnects during active agent multi-section edit session', () => {
    const network = new NetworkSimulator();
    const pool = new ClientPool({ humanCount: 3, agentCount: 1, network });

    const humans = pool.getHumans();
    const agent = pool.getAgent();

    humans[0].insertParagraph('Core section.');
    network.flush();

    // Agent begins edits, then network abruptly disconnects agent
    agent.appendSection('Section Alpha', 'Alpha content', agentMeta);
    pool.disconnectClient(agent.id);

    // Agent attempts further offline edits
    agent.appendSection('Section Beta', 'Beta offline content', agentMeta);
    agent.appendSection('Section Gamma', 'Gamma offline content', agentMeta);

    // Humans continue editing while agent is offline
    humans[1].insertParagraph('Human 2 edit while agent offline.');
    humans[2].insertHeading('New Human Section', 2);
    network.flush();

    // Agent reconnects and heals
    pool.reconnectClient(agent.id);
    network.flush();
    pool.syncAllDirectly();
    pool.assertConvergence();

    const finalText = humans[0].getTextContent();
    expect(finalText).toContain('Section Alpha');
    expect(finalText).toContain('Section Beta');
    expect(finalText).toContain('Section Gamma');
    expect(finalText).toContain('Human 2 edit while agent offline.');

    pool.destroy();
  });

  it('5. network partition split-brain resolution (3 humans in Group A vs 2 humans + agent in Group B)', () => {
    const network = new NetworkSimulator();
    const pool = new ClientPool({ humanCount: 5, agentCount: 1, network });

    const humans = pool.getHumans();
    const agent = pool.getAgent();

    humans[0].insertParagraph('Pre-partition document baseline.');
    network.flush();

    // Partition network:
    // Group A: human-1, human-2, human-3
    // Group B: human-4, human-5, agent-gateway-1
    network.partition(
      ['human-1', 'human-2', 'human-3'],
      ['human-4', 'human-5', 'agent-gateway-1']
    );

    // Group A edits concurrently
    humans[0].insertParagraph('Group A note 1.');
    humans[1].insertParagraph('Group A note 2.');
    network.step(5); // Deliver only within Group A

    // Group B edits concurrently
    humans[3].insertParagraph('Group B note 1.');
    agent.appendSection('Group B AI Section', 'Group B AI Content', agentMeta);
    network.step(5); // Deliver only within Group B

    // Heal partition
    network.healPartition();
    network.flush();
    pool.syncAllDirectly();
    pool.assertConvergence();

    const finalText = humans[0].getTextContent();
    expect(finalText).toContain('Group A note 1.');
    expect(finalText).toContain('Group A note 2.');
    expect(finalText).toContain('Group B note 1.');
    expect(finalText).toContain('Group B AI Section');

    pool.destroy();
  });
});
