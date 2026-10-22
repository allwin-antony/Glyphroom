/**
 * Enterprise Blogger 2.0 — 10,000-Operation CRDT Convergence Test Suite
 * Validates zero document divergence across 5 headless human clients + 1 headless agent client.
 * Includes network latency, packet reordering, packet drops, and disconnect/reconnect cycles.
 */

import { describe, it, expect } from 'vitest';
import {
  ClientPool,
  NetworkSimulator,
  OperationGenerator,
} from '../harness/index.js';

describe('Tier 1 & Tier 2: 10,000-Op Randomized Convergence Suite', () => {
  it(
    '1. executes 10,000-operation randomized concurrent edit session with 5 humans and 1 agent (zero divergence)',
    () => {
      const generator = new OperationGenerator(20261022);
      const result = generator.runConvergenceSession({
        opsCount: 10000,
        seed: 20261022,
        enableNetworkChaos: true,
      });

      expect(result.converged).toBe(true);
      expect(result.totalOps).toBe(10000);
      expect(result.blockCount).toBeGreaterThan(0);
      expect(result.finalCharCount).toBeGreaterThan(0);
      expect(result.elapsedMs).toBeLessThan(30000); // Must complete within 30s
    },
    45000
  );

  it('2. guarantees 100% deterministic reproducibility across identical PRNG seeds', () => {
    const seed = 987654321;

    // Run 1
    const gen1 = new OperationGenerator(seed);
    const res1 = gen1.runConvergenceSession({ opsCount: 1000, seed });

    // Run 2
    const gen2 = new OperationGenerator(seed);
    const res2 = gen2.runConvergenceSession({ opsCount: 1000, seed });

    expect(res1.converged).toBe(true);
    expect(res2.converged).toBe(true);
    expect(res1.finalCharCount).toBe(res2.finalCharCount);
    expect(res1.blockCount).toBe(res2.blockCount);
    expect(res1.opsBreakdown).toEqual(res2.opsBreakdown);
  });

  it('3. converges under extreme network degradation (15% drop rate, 20% reorder rate)', () => {
    const network = new NetworkSimulator({
      latencyMinTicks: 2,
      latencyMaxTicks: 10,
      dropRate: 0.15,
      reorderRate: 0.2,
      prng: () => Math.random(),
    });

    const pool = new ClientPool({
      humanCount: 5,
      agentCount: 1,
      network,
    });

    const generator = new OperationGenerator(55555);
    const res = generator.runConvergenceSession({
      opsCount: 2000,
      pool,
      network,
      enableNetworkChaos: true,
    });

    expect(res.converged).toBe(true);
    const metrics = network.getMetrics();
    expect(metrics.droppedCount).toBeGreaterThan(0);
    expect(metrics.reorderedCount).toBeGreaterThan(0);
  });

  it('4. converges after prolonged offline partition burst editing', () => {
    const network = new NetworkSimulator();
    const pool = new ClientPool({ humanCount: 5, agentCount: 1, network });

    // Initial paragraph
    pool.getHumans()[0].insertParagraph('Collab canvas initial text.');
    network.flush();

    // Disconnect human-2 and human-4
    pool.disconnectClient('human-2');
    pool.disconnectClient('human-4');

    // Offline burst edits on human-2 and human-4
    const h2 = pool.getClient('human-2');
    const h4 = pool.getClient('human-4');
    for (let i = 0; i < 50; i++) {
      h2.insertParagraph(`Human 2 offline note #${i}`);
      h4.insertHeading(`Human 4 offline section #${i}`, 2);
    }

    // Online edits from human-1 and agent
    const h1 = pool.getClient('human-1');
    const agent = pool.getAgent();
    for (let i = 0; i < 50; i++) {
      h1.insertParagraph(`Human 1 online note #${i}`);
      agent.appendSection(`Agent Section #${i}`, `Agent Body #${i}`);
    }
    network.flush();

    // Reconnect human-2 and human-4
    pool.reconnectClient('human-2');
    pool.reconnectClient('human-4');

    // Sync all
    network.flush();
    pool.syncAllDirectly();

    // Assert full convergence
    expect(() => pool.assertConvergence()).not.toThrow();

    pool.destroy();
  });

  it('5. converges across 5 distinct PRNG seeds (fuzz testing variety)', () => {
    const seeds = [101, 202, 303, 404, 505];
    for (const seed of seeds) {
      const gen = new OperationGenerator(seed);
      const res = gen.runConvergenceSession({
        opsCount: 1000,
        seed,
        enableNetworkChaos: true,
      });
      expect(res.converged).toBe(true);
    }
  });
});
