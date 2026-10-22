import type { Document } from '@hocuspocus/server';
import { HocuspocusProvider } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import type { AgentMetadata } from '@enterprise-blogger/shared';

export interface AgentAwarenessState {
  user: {
    name: string;
    color: string;
    role: 'agent';
    status: string;
    agentId: string;
    tokenId: string;
    ownerUserId: string;
  };
  cursor: {
    anchor: number;
    head: number;
  };
  timestamp: number;
}

/**
 * Injects agent presence and cursor awareness directly into the in-memory Document.
 */
export function injectAgentAwareness(
  document: Document,
  agentMeta: AgentMetadata,
  details?: {
    targetHeading?: string;
    status?: string;
    cursor?: { anchor: number; head: number };
    color?: string;
  }
): void {
  const status =
    details?.status ||
    (details?.targetHeading ? `Editing: ${details.targetHeading}` : 'Applying suggestions');

  const state: AgentAwarenessState = {
    user: {
      name: `[Agent: ${agentMeta.agentId}]`,
      color: details?.color || '#6366f1',
      role: 'agent',
      status,
      agentId: agentMeta.agentId,
      tokenId: agentMeta.tokenId,
      ownerUserId: agentMeta.ownerUserId,
    },
    cursor: details?.cursor || { anchor: 0, head: 0 },
    timestamp: Date.now(),
  };

  document.awareness.setLocalState(state as any);
}

/**
 * Clears agent presence awareness from the in-memory Document.
 */
export function clearAgentAwareness(document: Document): void {
  document.awareness.setLocalState(null);
}

/**
 * Headless HocuspocusProvider client fallback for WebSocket-based agent co-editing.
 */
export interface HeadlessAgentClientOptions {
  url: string;
  documentName: string;
  agentId: string;
  ownerUserId: string;
  tokenId?: string;
  token?: string;
  color?: string;
  timeoutMs?: number;
}

export interface HeadlessAgentClient {
  provider: HocuspocusProvider;
  doc: Y.Doc;
  destroy(): Promise<void>;
  setAwareness(status?: string, cursor?: { anchor: number; head: number }): void;
}

export async function createHeadlessAgentClient(
  options: HeadlessAgentClientOptions
): Promise<HeadlessAgentClient> {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: options.url,
    name: options.documentName,
    document: doc,
    token: options.token || `token-author-${options.ownerUserId}`,
    WebSocketPolyfill: WebSocket as any,
  } as any);

  const timeoutMs = options.timeoutMs ?? 10000;

  await new Promise<void>((resolve, reject) => {
    let timer: NodeJS.Timeout;
    const cleanup = () => {
      clearTimeout(timer);
    };

    timer = setTimeout(() => {
      reject(new Error(`Headless client sync timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    provider.on('synced', () => {
      cleanup();
      resolve();
    });

    provider.on('close', (e: any) => {
      cleanup();
      reject(new Error(`WebSocket closed: ${e?.code || 'unknown'}`));
    });
  });

  const setAwareness = (status?: string, cursor?: { anchor: number; head: number }) => {
    provider.setAwarenessField('user', {
      name: `[Agent: ${options.agentId}]`,
      color: options.color || '#6366f1',
      role: 'agent',
      status: status || 'Active',
      agentId: options.agentId,
      tokenId: options.tokenId || 'default-token',
      ownerUserId: options.ownerUserId,
    });
    provider.setAwarenessField('cursor', cursor || { anchor: 0, head: 0 });
  };

  setAwareness();

  return {
    provider,
    doc,
    async destroy() {
      provider.destroy();
    },
    setAwareness,
  };
}
