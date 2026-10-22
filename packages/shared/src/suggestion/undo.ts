import * as Y from 'yjs';
import { ySyncPluginKey, yUndoPlugin } from 'y-prosemirror';
import { Plugin } from 'prosemirror-state';
import type { AgentMetadata } from '../types/index.js';
import type { AgentTransactionOrigin } from './types.js';

export interface HumanUndoManagerOptions {
  trackedOrigins?: Set<any>;
  additionalTrackedOrigins?: any[];
  captureTimeout?: number;
  deleteFilter?: (item: Y.Item) => boolean;
}

/**
 * Creates an immutable AgentTransactionOrigin token for transaction tagging.
 */
export function createAgentOrigin(
  meta: AgentMetadata,
  action?: 'suggest_edit' | 'append_section' | 'insert_after_section' | string
): AgentTransactionOrigin {
  return {
    origin: 'agent',
    agentId: meta.agentId,
    tokenId: meta.tokenId,
    ownerUserId: meta.ownerUserId,
    timestamp: meta.timestamp || Date.now(),
    action,
  };
}

/**
 * Determines whether a transaction origin is an agent origin.
 */
export function isAgentOrigin(origin: any): boolean {
  if (!origin || typeof origin !== 'object') {
    return false;
  }
  return origin.origin === 'agent' || origin.type === 'agent';
}

/**
 * Constructs a Y.UndoManager explicitly filtered to isolate human edits.
 *
 * Guarantees:
 * 1. Only transactions originating from ySyncPluginKey (or specified human origins) are captured.
 * 2. Remote edits and Agent Gateway edits ({ origin: 'agent', ... }) are completely ignored.
 * 3. Ctrl+Z undoes only local human typing and NEVER undoes or corrupts agent suggestions.
 */
export function createHumanUndoManager(
  scope: Y.AbstractType<any> | Array<Y.AbstractType<any>>,
  options?: HumanUndoManagerOptions
): Y.UndoManager {
  const trackedOrigins =
    options?.trackedOrigins ??
    new Set<any>([ySyncPluginKey, ...(options?.additionalTrackedOrigins || [])]);

  return new Y.UndoManager(scope, {
    trackedOrigins,
    captureTimeout: options?.captureTimeout ?? 500,
    deleteFilter: options?.deleteFilter,
    captureTransaction: (tr: Y.Transaction) => {
      const origin = tr.origin;
      // Filter out agent-originated transactions
      if (isAgentOrigin(origin)) {
        return false;
      }
      // Filter out remote sync transactions if present
      if (origin && typeof origin === 'object' && origin.type === 'remote') {
        return false;
      }
      // If trackedOrigins was explicitly provided, check membership
      if (trackedOrigins.size > 0 && !trackedOrigins.has(origin)) {
        return false;
      }
      return true;
    },
  });
}

/**
 * Returns the configured yUndoPlugin with human-only tracking.
 */
export function createHumanUndoPlugin(options?: {
  undoManager?: Y.UndoManager | null;
  trackedOrigins?: any[];
}): Plugin {
  return yUndoPlugin({
    undoManager: options?.undoManager || null,
    trackedOrigins: options?.trackedOrigins || [ySyncPluginKey],
  });
}

/**
 * Executes a mutation on Y.Doc tagged with an agent origin.
 * Guarantees UndoManager will ignore the transaction.
 */
export function runAgentTransaction<T>(
  doc: Y.Doc,
  agentOrigin: AgentTransactionOrigin | AgentMetadata,
  mutation: (tr: Y.Transaction) => T
): T {
  const origin: AgentTransactionOrigin =
    'origin' in agentOrigin && agentOrigin.origin === 'agent'
      ? agentOrigin
      : createAgentOrigin(agentOrigin);

  let result: T;
  doc.transact((tr) => {
    result = mutation(tr);
  }, origin);
  return result!;
}
