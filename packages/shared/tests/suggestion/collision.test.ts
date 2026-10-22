import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { EditorState, Transaction } from 'prosemirror-state';
import { blogSchema } from '../../src/schema/index.js';
import {
  createSuggestionCollisionPlugin,
  suggestionCollisionPluginKey,
  attachYjsCollisionObserver,
} from '../../src/suggestion/collision.js';
import { MARK_SUGGESTION_INSERT, MARK_SUGGESTION_DELETE } from '../../src/schema/marks/constants.js';
import type { AgentMetadata } from '../../src/types/index.js';

describe('Typing Collision Rules & Zero Keystroke Loss (collision.ts)', () => {
  const agentMeta: AgentMetadata = {
    agentId: 'agent:editor:v1',
    tokenId: 'tok-abc',
    ownerUserId: 'user-001',
    timestamp: 1729600000000,
  };

  describe('Boundary Protection (inclusive: false) vs Interior Retention', () => {
    it('typing at start boundary (pos === from) creates clean, un-marked text', () => {
      const insMark = blogSchema.marks[MARK_SUGGESTION_INSERT].create({
        id: 'sug-1',
        ...agentMeta,
        status: 'pending',
      });

      // Doc: "Hello [world] suffix"
      // "world" is from pos 7 to 12
      const doc = blogSchema.nodes.doc.create({}, [
        blogSchema.nodes.paragraph.create({}, [
          blogSchema.text('Hello '),
          blogSchema.text('world', [insMark]),
          blogSchema.text(' suffix'),
        ]),
      ]);

      const state = EditorState.create({ doc, schema: blogSchema });
      // Insert text right at boundary pos 7 (start of 'world')
      const tr = state.tr.insertText('brave ', 7);
      const newState = state.apply(tr);

      // Verify 'brave ' is clean un-marked prose
      let braveNodeMarks: any = null;
      newState.doc.descendants((node) => {
        if (node.isText && node.text?.includes('brave')) {
          braveNodeMarks = node.marks;
        }
      });

      expect(braveNodeMarks).toBeDefined();
      expect(braveNodeMarks.some((m: any) => m.type.name === MARK_SUGGESTION_INSERT)).toBe(false);
    });

    it('typing at end boundary (pos === to) creates clean, un-marked text', () => {
      const insMark = blogSchema.marks[MARK_SUGGESTION_INSERT].create({
        id: 'sug-2',
        ...agentMeta,
        status: 'pending',
      });

      // "Hello " (1..7), "world" (7..12)
      const doc = blogSchema.nodes.doc.create({}, [
        blogSchema.nodes.paragraph.create({}, [
          blogSchema.text('Hello '),
          blogSchema.text('world', [insMark]),
        ]),
      ]);

      const state = EditorState.create({ doc, schema: blogSchema });
      // Insert '!' at pos 12 (end of 'world')
      const tr = state.tr.insertText('!', 12);
      const newState = state.apply(tr);

      let exclamationMarks: any = null;
      newState.doc.descendants((node) => {
        if (node.isText && node.text?.includes('!')) {
          exclamationMarks = node.marks;
        }
      });

      expect(exclamationMarks).toBeDefined();
      expect(exclamationMarks.some((m: any) => m.type.name === MARK_SUGGESTION_INSERT)).toBe(false);
    });

    it('typing strictly inside insertion retains suggestion context', () => {
      const insMark = blogSchema.marks[MARK_SUGGESTION_INSERT].create({
        id: 'sug-3',
        ...agentMeta,
        status: 'pending',
      });

      // "Hello " (1..7), "world" (7..12)
      const doc = blogSchema.nodes.doc.create({}, [
        blogSchema.nodes.paragraph.create({}, [
          blogSchema.text('Hello '),
          blogSchema.text('world', [insMark]),
        ]),
      ]);

      const state = EditorState.create({ doc, schema: blogSchema });
      // Insert 'dly ' inside 'world' at pos 10 ('wor'|'ld')
      const tr = state.tr.insertText('dly', 10);
      const newState = state.apply(tr);

      // Entire modified token 'wordlyld' has suggestion_insert
      let fullTextWithMark = '';
      newState.doc.descendants((node) => {
        if (node.isText && node.marks.some((m) => m.type.name === MARK_SUGGESTION_INSERT)) {
          fullTextWithMark += node.text;
        }
      });

      expect(fullTextWithMark).toBe('wordlyld');
    });
  });

  describe('Deletion Auto-Rejection (suggestionCollisionPlugin)', () => {
    it('typing inside pending deletion automatically drops suggestion_delete and preserves keystrokes with 0 data loss', () => {
      const delMark = blogSchema.marks[MARK_SUGGESTION_DELETE].create({
        id: 'del-sug-001',
        ...agentMeta,
        status: 'pending',
      });

      // Doc: "Keep this [deprecated text] for now."
      // "deprecated text" has suggestion_delete mark
      const doc = blogSchema.nodes.doc.create({}, [
        blogSchema.nodes.paragraph.create({}, [
          blogSchema.text('Keep this '),
          blogSchema.text('deprecated text', [delMark]),
          blogSchema.text(' for now.'),
        ]),
      ]);

      const plugin = createSuggestionCollisionPlugin(blogSchema);
      const state = EditorState.create({
        doc,
        schema: blogSchema,
        plugins: [plugin],
      });

      // Human user clicks inside 'deprecated text' (e.g. pos 15) and types ' still active'
      // Initial pos: "Keep this " is 1..11. "deprecated text" is 11..26.
      const tr = state.tr.insertText(' still active', 21);
      const newState = state.apply(tr);

      // Verify:
      // 1. Zero keystroke loss: 'still active' is present in document
      expect(newState.doc.textContent).toContain('still active');
      expect(newState.doc.textContent).toBe('Keep this deprecated still active text for now.');

      // 2. The suggestion_delete mark on the touched hunk is completely dropped (auto-rejected)
      let foundDeletionMark = false;
      newState.doc.descendants((node) => {
        if (node.isText && node.marks.some((m) => m.type.name === MARK_SUGGESTION_DELETE)) {
          foundDeletionMark = true;
        }
      });
      expect(foundDeletionMark).toBe(false);
    });

    it('does not trigger follow-up transactions when edit does not touch any deletion mark', () => {
      const doc = blogSchema.nodes.doc.create({}, [
        blogSchema.nodes.paragraph.create({}, [
          blogSchema.text('Standard un-marked sentence.'),
        ]),
      ]);

      const plugin = createSuggestionCollisionPlugin(blogSchema);
      const state = EditorState.create({
        doc,
        schema: blogSchema,
        plugins: [plugin],
      });

      const tr = state.tr.insertText(' prefix ', 1);
      const newState = state.apply(tr);

      expect(newState.doc.textContent).toBe(' prefix Standard un-marked sentence.');
    });

    it('handles multiple sequential typing steps without infinite transaction loops', () => {
      const delMark = blogSchema.marks[MARK_SUGGESTION_DELETE].create({
        id: 'del-sug-002',
        ...agentMeta,
        status: 'pending',
      });

      const doc = blogSchema.nodes.doc.create({}, [
        blogSchema.nodes.paragraph.create({}, [
          blogSchema.text('Start '),
          blogSchema.text('targeted text', [delMark]),
          blogSchema.text(' End'),
        ]),
      ]);

      const plugin = createSuggestionCollisionPlugin(blogSchema);
      let state = EditorState.create({
        doc,
        schema: blogSchema,
        plugins: [plugin],
      });

      // Type character by character: 'a', 'b', 'c'
      const chars = ['a', 'b', 'c'];
      let insertPos = 10;
      for (const ch of chars) {
        const tr = state.tr.insertText(ch, insertPos);
        state = state.apply(tr);
        insertPos++;
      }

      expect(state.doc.textContent).toBe('Start tarabcgeted text End');
      // No deletion mark remains
      state.doc.descendants((node) => {
        if (node.isText) {
          expect(node.marks.some((m) => m.type.name === MARK_SUGGESTION_DELETE)).toBe(false);
        }
      });
    });
  });

  describe('Headless Yjs Collision Observer', () => {
    it('clears suggestion_delete on Y.Doc when human edit modifies touched text run', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('default');
      let pText!: Y.XmlText;

      doc.transact(() => {
        const p = new Y.XmlElement('paragraph');
        fragment.push([p]);
        pText = new Y.XmlText();
        p.push([pText]);
        pText.insert(0, 'Original sentence.');
      });

      // Agent marks text for deletion
      doc.transact(() => {
        pText.format(9, 8, {
          suggestion_delete: { id: 'sug-del', ...agentMeta, status: 'pending' },
        });
      }, { type: 'agent' });

      // Attach collision observer
      const detach = attachYjsCollisionObserver(doc);

      // Human edit occurs on doc
      doc.transact(() => {
        pText.insert(9, 'human typed ');
      }, { type: 'human', userId: 'user-writer' });

      // After human edit, suggestion_delete mark on that run is auto-rejected
      const delta = pText.toDelta();
      for (const op of delta) {
        expect(op.attributes?.suggestion_delete).toBeUndefined();
      }

      detach();
    });
  });
});
