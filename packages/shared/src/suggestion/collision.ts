import { Plugin, PluginKey, Transaction, EditorState } from 'prosemirror-state';
import type { Schema } from 'prosemirror-model';
import * as Y from 'yjs';
import { MARK_SUGGESTION_DELETE } from '../schema/marks/constants.js';
import { isAgentOrigin } from './undo.js';
import { getDocumentFragment } from './operations.js';

export const suggestionCollisionPluginKey = new PluginKey('suggestionCollision');

/**
 * ProseMirror plugin that detects human typing inside a pending deletion
 * and automatically dismisses/rejects that deletion mark so keystrokes are preserved.
 */
export function createSuggestionCollisionPlugin(schema?: Schema): Plugin {
  return new Plugin({
    key: suggestionCollisionPluginKey,
    appendTransaction(
      transactions: readonly Transaction[],
      oldState: EditorState,
      newState: EditorState
    ) {
      if (!transactions.some((tr) => tr.docChanged)) {
        return null;
      }

      // Ignore if this transaction was already produced by the collision plugin to prevent loops
      if (transactions.some((tr) => tr.getMeta(suggestionCollisionPluginKey))) {
        return null;
      }

      const humanTrs = transactions.filter(
        (tr) => tr.docChanged && tr.getMeta('addToHistory') !== false
      );
      if (humanTrs.length === 0) return null;

      const touchedSuggestionIds = new Set<string>();

      for (const tr of humanTrs) {
        for (const step of tr.steps) {
          step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
            // Check if characters were inserted or changed within or touching a deletion hunk
            const queryStart = Math.max(0, oldStart - 1);
            const queryEnd = Math.min(oldState.doc.content.size, oldEnd + 1);

            oldState.doc.nodesBetween(queryStart, queryEnd, (node) => {
              if (node.isText) {
                const delMark = node.marks.find(
                  (m) =>
                    m.type.name === MARK_SUGGESTION_DELETE ||
                    (schema && m.type === schema.marks[MARK_SUGGESTION_DELETE])
                );
                if (delMark && delMark.attrs.id) {
                  touchedSuggestionIds.add(delMark.attrs.id);
                }
              }
            });
          });
        }
      }

      if (touchedSuggestionIds.size === 0) {
        return null;
      }

      let followUpTr: Transaction | null = null;

      newState.doc.descendants((node, pos) => {
        if (node.isText) {
          const delMark = node.marks.find(
            (m) =>
              (m.type.name === MARK_SUGGESTION_DELETE ||
                (schema && m.type === schema.marks[MARK_SUGGESTION_DELETE])) &&
              touchedSuggestionIds.has(m.attrs.id)
          );
          if (delMark) {
            if (!followUpTr) {
              followUpTr = newState.tr;
            }
            followUpTr.removeMark(pos, pos + node.nodeSize, delMark.type);
          }
        }
      });

      if (followUpTr) {
        (followUpTr as Transaction).setMeta(suggestionCollisionPluginKey, true);
        return followUpTr;
      }

      return null;
    },
  });
}

/**
 * Headless Yjs collision observer.
 * Listens to Y.XmlFragment events and automatically drops suggestion_delete marks
 * on hunks touched by human edits.
 */
export function attachYjsCollisionObserver(doc: Y.Doc, fragmentName = 'default'): () => void {
  const fragment = getDocumentFragment(doc, fragmentName);

  const observer = (events: Y.YEvent<any>[], transaction: Y.Transaction) => {
    // Only monitor human edits, ignore agent transactions
    if (isAgentOrigin(transaction.origin)) {
      return;
    }

    for (const event of events) {
      if (event.target instanceof Y.XmlText) {
        const ytext = event.target;
        const delta = ytext.toDelta();
        let offset = 0;

        for (const op of delta) {
          const len = typeof op.insert === 'string' ? op.insert.length : 1;
          const del = op.attributes?.suggestion_delete;
          // If human edit touched this text run, clear the suggestion_delete mark
          if (del && transaction.origin && transaction.origin !== 'agent') {
            // Auto-reject deletion to preserve human keystrokes
            ytext.format(offset, len, { suggestion_delete: null });
          }
          offset += len;
        }
      }
    }
  };

  fragment.observeDeep(observer);
  return () => fragment.unobserveDeep(observer);
}
