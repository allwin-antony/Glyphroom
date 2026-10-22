/**
 * Enterprise Blogger 2.0 — Deterministic PRNG Operation Generator Harness
 * Generates reproducible concurrent human and agent operations for 10k-op convergence tests.
 */

import { ClientPool, HeadlessClient } from './client-pool.js';
import { NetworkSimulator } from './network-simulator.js';
import { AgentMetadata } from '@enterprise-blogger/shared';

/**
 * Deterministic 32-bit Mulberry32 PRNG.
 */
export class PRNG {
  private state: number;

  constructor(seed = 1337) {
    this.state = seed >>> 0;
  }

  public next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  public nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  public pick<T>(items: readonly T[] | T[]): T {
    if (items.length === 0) throw new Error('Cannot pick from empty array');
    return items[Math.floor(this.next() * items.length)];
  }

  public nextWord(): string {
    const words = [
      'crdt', 'convergence', 'enterprise', 'blogger', 'yjs', 'prosemirror',
      'gateway', 'hocuspocus', 'postgres', 'bytea', 'direct', 'connection',
      'suggestion', 'insert', 'delete', 'keystroke', 'latency', 'resilience',
      'distributed', 'consensus', 'vector', 'state', 'diff', 'patch', 'audit',
    ];
    return this.pick(words);
  }

  public nextSentence(minWords = 3, maxWords = 8): string {
    const count = this.nextInt(minWords, maxWords);
    const words: string[] = [];
    for (let i = 0; i < count; i++) {
      words.push(this.nextWord());
    }
    const sentence = words.join(' ');
    return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
  }
}

export type OperationType =
  | 'HUMAN_INSERT_TEXT'
  | 'HUMAN_DELETE_TEXT'
  | 'HUMAN_INSERT_BLOCK'
  | 'HUMAN_UNDO'
  | 'HUMAN_REDO'
  | 'AGENT_SUGGEST_INSERT'
  | 'AGENT_SUGGEST_DELETE'
  | 'AGENT_APPEND_SECTION'
  | 'AGENT_INSERT_AFTER_SECTION'
  | 'AGENT_AWARENESS_HEARTBEAT'
  | 'NET_DISCONNECT'
  | 'NET_RECONNECT';

export interface PlannedOperation {
  id: number;
  type: OperationType;
  clientId: string;
  details?: Record<string, any>;
}

export interface ConvergenceSessionOptions {
  opsCount: number;
  seed?: number;
  pool?: ClientPool;
  network?: NetworkSimulator;
  enableNetworkChaos?: boolean; // random disconnects / reconnects
  onProgress?: (completed: number, total: number) => void;
}

export interface ConvergenceSessionResult {
  totalOps: number;
  seed: number;
  elapsedMs: number;
  opsBreakdown: Record<OperationType, number>;
  converged: boolean;
  finalCharCount: number;
  blockCount: number;
}

export class OperationGenerator {
  private prng: PRNG;
  private agentMeta: AgentMetadata = {
    agentId: 'agent:researcher:v1',
    tokenId: 'tok-convergence-test-001',
    ownerUserId: 'user:lead-architect',
    timestamp: 1729612800000,
  };

  constructor(seed = 42) {
    this.prng = new PRNG(seed);
  }

  public getPRNG(): PRNG {
    return this.prng;
  }

  public generateOperation(
    pool: ClientPool,
    enableNetworkChaos = false
  ): PlannedOperation {
    const humans = pool.getHumans();
    const agent = pool.getAgent();

    // Weight distribution:
    // 60% Human text edits & blocks
    // 25% Agent suggestions & sections
    // 10% Human undo/redo
    // 5% Network chaos (if enabled)
    const roll = this.prng.next();

    if (enableNetworkChaos && roll < 0.05) {
      const allClients = pool.getAllClients();
      const client = this.prng.pick(allClients);
      const isOnline = client.connected;
      return {
        id: 0,
        type: isOnline ? 'NET_DISCONNECT' : 'NET_RECONNECT',
        clientId: client.id,
      };
    }

    if (roll < 0.25) {
      // Agent Operations
      const agentOpRoll = this.prng.next();
      if (agentOpRoll < 0.4) {
        return {
          id: 0,
          type: 'AGENT_SUGGEST_INSERT',
          clientId: agent.id,
          details: { text: ` [Suggested: ${this.prng.nextWord()}] ` },
        };
      } else if (agentOpRoll < 0.7) {
        return {
          id: 0,
          type: 'AGENT_SUGGEST_DELETE',
          clientId: agent.id,
          details: { length: this.prng.nextInt(3, 10) },
        };
      } else if (agentOpRoll < 0.85) {
        return {
          id: 0,
          type: 'AGENT_APPEND_SECTION',
          clientId: agent.id,
          details: {
            title: `Section: ${this.prng.nextWord().toUpperCase()}`,
            content: this.prng.nextSentence(5, 12),
          },
        };
      } else {
        return {
          id: 0,
          type: 'AGENT_AWARENESS_HEARTBEAT',
          clientId: agent.id,
          details: {
            cursor: { anchor: this.prng.nextInt(0, 50), head: this.prng.nextInt(0, 50) },
            activity: 'reviewing',
          },
        };
      }
    }

    if (roll < 0.35) {
      // Undo / Redo
      const human = this.prng.pick(humans);
      return {
        id: 0,
        type: this.prng.next() < 0.8 ? 'HUMAN_UNDO' : 'HUMAN_REDO',
        clientId: human.id,
      };
    }

    // Human Text & Block Operations (65%)
    const human = this.prng.pick(humans);
    const humanOpRoll = this.prng.next();

    if (humanOpRoll < 0.65) {
      return {
        id: 0,
        type: 'HUMAN_INSERT_TEXT',
        clientId: human.id,
        details: { text: ` ${this.prng.nextWord()} ` },
      };
    } else if (humanOpRoll < 0.85) {
      return {
        id: 0,
        type: 'HUMAN_DELETE_TEXT',
        clientId: human.id,
        details: { length: this.prng.nextInt(1, 5) },
      };
    } else {
      const blockType = this.prng.pick(['paragraph', 'heading', 'callout', 'code', 'table']);
      return {
        id: 0,
        type: 'HUMAN_INSERT_BLOCK',
        clientId: human.id,
        details: { blockType },
      };
    }
  }

  public executeOperation(
    op: PlannedOperation,
    pool: ClientPool,
    network?: NetworkSimulator
  ): void {
    const client = pool.getClient(op.clientId);

    switch (op.type) {
      case 'HUMAN_INSERT_TEXT': {
        const text = op.details?.text ?? ' sample ';
        const blockIdx = this.prng.nextInt(0, Math.max(0, client.xmlFragment.length - 1));
        client.insertTextInBlock(blockIdx, 9999, text);
        break;
      }

      case 'HUMAN_DELETE_TEXT': {
        const length = op.details?.length ?? 2;
        const blockIdx = this.prng.nextInt(0, Math.max(0, client.xmlFragment.length - 1));
        client.deleteTextInBlock(blockIdx, 0, length);
        break;
      }

      case 'HUMAN_INSERT_BLOCK': {
        const blockType = op.details?.blockType ?? 'paragraph';
        if (blockType === 'heading') {
          client.insertHeading(this.prng.nextSentence(2, 4), 2);
        } else if (blockType === 'callout') {
          client.insertCallout(this.prng.nextSentence(3, 7), 'NOTE');
        } else if (blockType === 'code') {
          client.insertCodeBlock(`const x = "${this.prng.nextWord()}";`, 'typescript');
        } else if (blockType === 'table') {
          client.insertTable(2, 2, 'Collab');
        } else {
          client.insertParagraph(this.prng.nextSentence(4, 8));
        }
        break;
      }

      case 'HUMAN_UNDO': {
        client.undo();
        break;
      }

      case 'HUMAN_REDO': {
        client.redo();
        break;
      }

      case 'AGENT_SUGGEST_INSERT': {
        const text = op.details?.text ?? ' suggestion ';
        const blockIdx = this.prng.nextInt(0, Math.max(0, client.xmlFragment.length - 1));
        client.suggestInsert(blockIdx, 0, text, this.agentMeta);
        break;
      }

      case 'AGENT_SUGGEST_DELETE': {
        const length = op.details?.length ?? 3;
        const blockIdx = this.prng.nextInt(0, Math.max(0, client.xmlFragment.length - 1));
        client.suggestDelete(blockIdx, 0, length, this.agentMeta);
        break;
      }

      case 'AGENT_APPEND_SECTION': {
        const title = op.details?.title ?? 'Agent Section';
        const content = op.details?.content ?? 'Content';
        client.appendSection(title, content, this.agentMeta);
        break;
      }

      case 'AGENT_INSERT_AFTER_SECTION': {
        client.insertAfterSection('Target', 'New Section', 'Section Body', this.agentMeta);
        break;
      }

      case 'AGENT_AWARENESS_HEARTBEAT': {
        client.awareness.setLocalStateField('cursor', op.details?.cursor);
        client.awareness.setLocalStateField('activity', op.details?.activity);
        break;
      }

      case 'NET_DISCONNECT': {
        pool.disconnectClient(client.id);
        break;
      }

      case 'NET_RECONNECT': {
        pool.reconnectClient(client.id);
        break;
      }
    }

    if (network) {
      network.step(1);
    }
  }

  public runConvergenceSession(
    options: ConvergenceSessionOptions
  ): ConvergenceSessionResult {
    const seed = options.seed ?? 42;
    this.prng = new PRNG(seed);
    this.agentMeta = {
      agentId: 'agent:researcher:v1',
      tokenId: `tok-convergence-${seed}`,
      ownerUserId: 'user:lead-architect',
      timestamp: 1729612800000,
    };

    const network = options.network ?? new NetworkSimulator({
      latencyMinTicks: 1,
      latencyMaxTicks: 3,
      prng: () => this.prng.next(),
    });

    const pool = options.pool ?? new ClientPool({
      humanCount: 5,
      agentCount: 1,
      network,
    });

    // Seed initial document with one paragraph so clients have a baseline target
    pool.getHumans()[0].insertParagraph('Enterprise Blogger 2.0 Collaborative Canvas Baseline.');
    if (network) {
      network.flush();
    }

    const opsBreakdown: Record<OperationType, number> = {
      HUMAN_INSERT_TEXT: 0,
      HUMAN_DELETE_TEXT: 0,
      HUMAN_INSERT_BLOCK: 0,
      HUMAN_UNDO: 0,
      HUMAN_REDO: 0,
      AGENT_SUGGEST_INSERT: 0,
      AGENT_SUGGEST_DELETE: 0,
      AGENT_APPEND_SECTION: 0,
      AGENT_INSERT_AFTER_SECTION: 0,
      AGENT_AWARENESS_HEARTBEAT: 0,
      NET_DISCONNECT: 0,
      NET_RECONNECT: 0,
    };

    const startTime = Date.now();

    for (let i = 1; i <= options.opsCount; i++) {
      const op = this.generateOperation(pool, options.enableNetworkChaos ?? false);
      op.id = i;
      opsBreakdown[op.type]++;
      this.executeOperation(op, pool, network);

      if (options.onProgress && i % 1000 === 0) {
        options.onProgress(i, options.opsCount);
      }
    }

    // Reconnect any disconnected clients before final synchronization
    for (const client of pool.getAllClients()) {
      if (!client.connected) {
        pool.reconnectClient(client.id);
      }
    }

    // Drain all in-flight network packets
    if (network) {
      network.flush(10000);
    }

    // Run final state vector exchange across all clients
    pool.syncAllDirectly();

    // Assert 100% convergence across all clients
    pool.assertConvergence();

    const elapsedMs = Date.now() - startTime;
    const baseClient = pool.getAllClients()[0];
    const textContent = baseClient.getTextContent();

    return {
      totalOps: options.opsCount,
      seed,
      elapsedMs,
      opsBreakdown,
      converged: true,
      finalCharCount: textContent.length,
      blockCount: baseClient.xmlFragment.length,
    };
  }
}
