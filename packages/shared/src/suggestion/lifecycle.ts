import * as Y from 'yjs';
import type { EditorState, Transaction } from 'prosemirror-state';
import { getDocumentFragment } from './operations.js';
import { MARK_SUGGESTION_INSERT, MARK_SUGGESTION_DELETE, MARK_ATTRIBUTION } from '../schema/marks/constants.js';
import type { ResolveSuggestionPayload } from '../validation/suggestions.js';

interface HunkTarget {
  offset: number;
  len: number;
  isIns: boolean;
  isDel: boolean;
  attrs: any;
  startRel: Y.RelativePosition;
  endRel: Y.RelativePosition;
}

/**
 * Accepts a pending agent suggestion by suggestionId on a Y.Doc.
 *
 * Guarantees:
 * 1. Atomicity: All hunks matching suggestionId are updated in a single transaction.
 * 2. Provenance: Insertions lose suggestion_insert and receive durable attribution marks.
 * 3. Zero index drift: Deletions are executed in reverse offset order using CRDT Relative Positions.
 * 4. Text removal: Deletions are physically deleted from the CRDT.
 */
export function acceptSuggestion(
  doc: Y.Doc,
  suggestionId: string,
  userId: string,
  fragmentName = 'default'
): void {
  const fragment = getDocumentFragment(doc, fragmentName);

  function processYText(ytext: Y.XmlText) {
    const delta = ytext.toDelta();
    const targets: HunkTarget[] = [];
    let offset = 0;

    for (const op of delta) {
      const len = typeof op.insert === 'string' ? op.insert.length : 1;
      const attrs = op.attributes || {};
      const ins = attrs.suggestion_insert;
      const del = attrs.suggestion_delete;

      if ((ins && ins.id === suggestionId) || (del && del.id === suggestionId)) {
        targets.push({
          offset,
          len,
          isIns: Boolean(ins),
          isDel: Boolean(del),
          attrs: ins || del,
          startRel: Y.createRelativePositionFromTypeIndex(ytext, offset),
          endRel: Y.createRelativePositionFromTypeIndex(ytext, offset + len),
        });
      }
      offset += len;
    }

    if (targets.length === 0) return;

    // Phase 1: Process deletions (physically delete text from right-to-left)
    const deletions = targets.filter((t) => t.isDel).sort((a, b) => b.offset - a.offset);
    for (const d of deletions) {
      const startPos = Y.createAbsolutePositionFromRelativePosition(d.startRel, doc);
      const endPos = Y.createAbsolutePositionFromRelativePosition(d.endRel, doc);
      const start = startPos !== null ? startPos.index : d.offset;
      const end = endPos !== null ? endPos.index : d.offset + d.len;
      if (end > start) {
        ytext.delete(start, end - start);
      }
    }

    // Phase 2: Convert insertions to durable attribution marks
    const insertions = targets.filter((t) => t.isIns);
    for (const ins of insertions) {
      const startPos = Y.createAbsolutePositionFromRelativePosition(ins.startRel, doc);
      const endPos = Y.createAbsolutePositionFromRelativePosition(ins.endRel, doc);
      const start = startPos !== null ? startPos.index : ins.offset;
      const end = endPos !== null ? endPos.index : ins.offset + ins.len;
      if (end > start) {
        ytext.format(start, end - start, {
          suggestion_insert: null,
          attribution: {
            authorType: 'agent',
            agentId: ins.attrs.agentId,
            tokenId: ins.attrs.tokenId,
            ownerUserId: ins.attrs.ownerUserId,
            acceptedBy: userId,
            acceptedAt: Date.now(),
          },
        });
      }
    }
  }

  function traverse(item: any) {
    if (item instanceof Y.XmlText) {
      processYText(item);
    } else if (item instanceof Y.XmlElement || item instanceof Y.XmlFragment) {
      for (let i = 0; i < item.length; i++) {
        traverse(item.get(i));
      }
    }
  }

  doc.transact(() => {
    traverse(fragment);
  }, { origin: 'human', userId, action: 'acceptSuggestion', suggestionId });
}

/**
 * Rejects a pending agent suggestion by suggestionId on a Y.Doc.
 *
 * Guarantees:
 * 1. Atomicity: All hunks matching suggestionId are updated in a single transaction.
 * 2. Complete removal: Inserted text is physically eradicated from the CRDT in reverse order.
 * 3. Restoration: Deleted text has suggestion_delete stripped, restoring clean prose.
 */
export function rejectSuggestion(
  doc: Y.Doc,
  suggestionId: string,
  userId: string,
  fragmentName = 'default'
): void {
  const fragment = getDocumentFragment(doc, fragmentName);

  function processYText(ytext: Y.XmlText) {
    const delta = ytext.toDelta();
    const targets: HunkTarget[] = [];
    let offset = 0;

    for (const op of delta) {
      const len = typeof op.insert === 'string' ? op.insert.length : 1;
      const attrs = op.attributes || {};
      const ins = attrs.suggestion_insert;
      const del = attrs.suggestion_delete;

      if ((ins && ins.id === suggestionId) || (del && del.id === suggestionId)) {
        targets.push({
          offset,
          len,
          isIns: Boolean(ins),
          isDel: Boolean(del),
          attrs: ins || del,
          startRel: Y.createRelativePositionFromTypeIndex(ytext, offset),
          endRel: Y.createRelativePositionFromTypeIndex(ytext, offset + len),
        });
      }
      offset += len;
    }

    if (targets.length === 0) return;

    // Phase 1: Physically delete proposed insertions (right-to-left)
    const insertions = targets.filter((t) => t.isIns).sort((a, b) => b.offset - a.offset);
    for (const ins of insertions) {
      const startPos = Y.createAbsolutePositionFromRelativePosition(ins.startRel, doc);
      const endPos = Y.createAbsolutePositionFromRelativePosition(ins.endRel, doc);
      const start = startPos !== null ? startPos.index : ins.offset;
      const end = endPos !== null ? endPos.index : ins.offset + ins.len;
      if (end > start) {
        ytext.delete(start, end - start);
      }
    }

    // Phase 2: Strip suggestion_delete mark from original text, restoring standard prose
    const deletions = targets.filter((t) => t.isDel);
    for (const del of deletions) {
      const startPos = Y.createAbsolutePositionFromRelativePosition(del.startRel, doc);
      const endPos = Y.createAbsolutePositionFromRelativePosition(del.endRel, doc);
      const start = startPos !== null ? startPos.index : del.offset;
      const end = endPos !== null ? endPos.index : del.offset + del.len;
      if (end > start) {
        ytext.format(start, end - start, {
          suggestion_delete: null,
        });
      }
    }
  }

  function traverse(item: any) {
    if (item instanceof Y.XmlText) {
      processYText(item);
    } else if (item instanceof Y.XmlElement || item instanceof Y.XmlFragment) {
      for (let i = 0; i < item.length; i++) {
        traverse(item.get(i));
      }
    }
  }

  doc.transact(() => {
    traverse(fragment);
  }, { origin: 'human', userId, action: 'rejectSuggestion', suggestionId });
}

/**
 * Resolves a suggestion using either accept or reject action.
 */
export function resolveSuggestion(
  doc: Y.Doc,
  payload: ResolveSuggestionPayload | { suggestionId: string; action: 'accept' | 'reject'; resolvedByUserId: string },
  fragmentName = 'default'
): void {
  if (payload.action === 'accept') {
    acceptSuggestion(doc, payload.suggestionId, payload.resolvedByUserId, fragmentName);
  } else {
    rejectSuggestion(doc, payload.suggestionId, payload.resolvedByUserId, fragmentName);
  }
}

/**
 * Creates a ProseMirror transaction to accept a suggestion in an EditorState.
 */
export function acceptSuggestionTr(
  state: EditorState,
  suggestionId: string,
  userId: string
): Transaction {
  const tr = state.tr;
  const insertions: { from: number; to: number; attrs: any }[] = [];
  const deletions: { from: number; to: number }[] = [];

  state.doc.descendants((node, pos) => {
    if (node.isText) {
      const insMark = node.marks.find(
        (m) => (m.type.name === MARK_SUGGESTION_INSERT || m.type === state.schema.marks[MARK_SUGGESTION_INSERT]) &&
               m.attrs.id === suggestionId
      );
      if (insMark) {
        insertions.push({ from: pos, to: pos + node.nodeSize, attrs: insMark.attrs });
      }
      const delMark = node.marks.find(
        (m) => (m.type.name === MARK_SUGGESTION_DELETE || m.type === state.schema.marks[MARK_SUGGESTION_DELETE]) &&
               m.attrs.id === suggestionId
      );
      if (delMark) {
        deletions.push({ from: pos, to: pos + node.nodeSize });
      }
    }
  });

  // 1. Delete deletions in reverse order
  deletions.sort((a, b) => b.from - a.from).forEach((d) => {
    tr.delete(d.from, d.to);
  });

  // 2. Format insertions (mapping positions through tr.mapping)
  insertions.forEach((ins) => {
    const from = tr.mapping.map(ins.from);
    const to = tr.mapping.map(ins.to);
    if (to > from) {
      tr.removeMark(from, to, state.schema.marks[MARK_SUGGESTION_INSERT]);
      if (state.schema.marks[MARK_ATTRIBUTION]) {
        tr.addMark(
          from,
          to,
          state.schema.marks[MARK_ATTRIBUTION].create({
            authorType: 'agent',
            agentId: ins.attrs.agentId,
            tokenId: ins.attrs.tokenId,
            ownerUserId: ins.attrs.ownerUserId,
            acceptedBy: userId,
            acceptedAt: Date.now(),
          })
        );
      }
    }
  });

  return tr;
}

/**
 * Creates a ProseMirror transaction to reject a suggestion in an EditorState.
 */
export function rejectSuggestionTr(
  state: EditorState,
  suggestionId: string,
  _userId: string
): Transaction {
  const tr = state.tr;
  const insertions: { from: number; to: number }[] = [];
  const deletions: { from: number; to: number }[] = [];

  state.doc.descendants((node, pos) => {
    if (node.isText) {
      const insMark = node.marks.find(
        (m) => (m.type.name === MARK_SUGGESTION_INSERT || m.type === state.schema.marks[MARK_SUGGESTION_INSERT]) &&
               m.attrs.id === suggestionId
      );
      if (insMark) {
        insertions.push({ from: pos, to: pos + node.nodeSize });
      }
      const delMark = node.marks.find(
        (m) => (m.type.name === MARK_SUGGESTION_DELETE || m.type === state.schema.marks[MARK_SUGGESTION_DELETE]) &&
               m.attrs.id === suggestionId
      );
      if (delMark) {
        deletions.push({ from: pos, to: pos + node.nodeSize });
      }
    }
  });

  // 1. Delete insertions in reverse order
  insertions.sort((a, b) => b.from - a.from).forEach((ins) => {
    tr.delete(ins.from, ins.to);
  });

  // 2. Clear deletion mark (mapping positions through tr.mapping)
  deletions.forEach((d) => {
    const from = tr.mapping.map(d.from);
    const to = tr.mapping.map(d.to);
    if (to > from) {
      tr.removeMark(from, to, state.schema.marks[MARK_SUGGESTION_DELETE]);
    }
  });

  return tr;
}
