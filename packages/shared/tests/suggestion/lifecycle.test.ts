import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { EditorState } from 'prosemirror-state';
import { blogSchema } from '../../src/schema/index.js';
import {
  acceptSuggestion,
  rejectSuggestion,
  resolveSuggestion,
  acceptSuggestionTr,
  rejectSuggestionTr,
} from '../../src/suggestion/lifecycle.js';
import { suggestEditSection, getPlainTextFromXmlText } from '../../src/suggestion/operations.js';
import { exportDerivedMarkdown } from '../../src/export/markdown.js';
import { initProseMirrorDoc } from 'y-prosemirror';
import { MARK_ATTRIBUTION, MARK_SUGGESTION_INSERT, MARK_SUGGESTION_DELETE } from '../../src/schema/marks/constants.js';
import type { AgentMetadata } from '../../src/types/index.js';

describe('Suggestion Lifecycle: Accept & Reject Transitions (lifecycle.ts)', () => {
  const agentMeta: AgentMetadata = {
    agentId: 'agent:editor:v2',
    tokenId: 'tok-xyz-987',
    ownerUserId: 'user-lead-42',
    timestamp: 1729650000000,
  };

  const humanUserId = 'user-reviewer-99';

  function createDocWithParagraph(initialText: string): { doc: Y.Doc; pText: Y.XmlText } {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('default');
    let pText!: Y.XmlText;

    doc.transact(() => {
      const p = new Y.XmlElement('paragraph');
      fragment.push([p]);
      pText = new Y.XmlText();
      p.push([pText]);
      pText.insert(0, initialText);
    });

    return { doc, pText };
  }

  describe('acceptSuggestion', () => {
    it('converts suggestion_insert to durable attribution mark', () => {
      const { doc, pText } = createDocWithParagraph('Prefix ');
      const suggestionId = 'sug-ins-001';

      // Agent suggests insertion
      doc.transact(() => {
        pText.insert(7, 'inserted addition', {
          suggestion_insert: {
            id: suggestionId,
            agentId: agentMeta.agentId,
            tokenId: agentMeta.tokenId,
            ownerUserId: agentMeta.ownerUserId,
            timestamp: agentMeta.timestamp,
            status: 'pending',
          },
          suggestion_delete: null,
        });
      }, { type: 'agent' });

      expect(getPlainTextFromXmlText(pText)).toBe('Prefix inserted addition');

      // Human accepts suggestion
      acceptSuggestion(doc, suggestionId, humanUserId);

      // Plain text remains
      expect(getPlainTextFromXmlText(pText)).toBe('Prefix inserted addition');

      // Delta check: suggestion_insert must be null/gone, attribution mark must be present
      const delta = pText.toDelta();
      const insOp = delta.find((op) => op.insert === 'inserted addition');
      expect(insOp).toBeDefined();
      expect(insOp?.attributes?.suggestion_insert).toBeUndefined();
      expect(insOp?.attributes?.attribution).toMatchObject({
        authorType: 'agent',
        agentId: agentMeta.agentId,
        tokenId: agentMeta.tokenId,
        ownerUserId: agentMeta.ownerUserId,
        acceptedBy: humanUserId,
      });
      expect(insOp?.attributes?.attribution.acceptedAt).toBeGreaterThan(0);
    });

    it('physically deletes text marked with suggestion_delete upon acceptance', () => {
      const { doc, pText } = createDocWithParagraph('Prefix deleted content suffix');
      const suggestionId = 'sug-del-001';

      // Agent marks "deleted content " for deletion (offset 7, length 16)
      doc.transact(() => {
        pText.format(7, 16, {
          suggestion_delete: {
            id: suggestionId,
            agentId: agentMeta.agentId,
            tokenId: agentMeta.tokenId,
            ownerUserId: agentMeta.ownerUserId,
            timestamp: agentMeta.timestamp,
            status: 'pending',
          },
          suggestion_insert: null,
        });
      }, { type: 'agent' });

      // Before acceptance, text still physically exists in CRDT
      expect(getPlainTextFromXmlText(pText)).toBe('Prefix deleted content suffix');

      // Accept deletion
      acceptSuggestion(doc, suggestionId, humanUserId);

      // After acceptance, text is physically removed from the CRDT
      expect(getPlainTextFromXmlText(pText)).toBe('Prefix suffix');
      const delta = pText.toDelta();
      expect(delta.some((op) => op.insert.toString().includes('deleted content'))).toBe(false);
    });

    it('processes multi-hunk modifications with zero index drift in reverse offset order', () => {
      const { doc, pText } = createDocWithParagraph('The quick brown fox jumps over the lazy dog.');
      const suggestionId = 'sug-multi-001';

      // Two replacements in same sentence:
      // 1. "brown" -> "red" (offset 10..15)
      // 2. "lazy" -> "sleepy" (offset 35..39)
      doc.transact(() => {
        // "lazy" -> "sleepy"
        pText.format(35, 4, {
          suggestion_delete: { id: suggestionId, ...agentMeta, status: 'pending' },
        });
        pText.insert(39, 'sleepy', {
          suggestion_insert: { id: suggestionId, ...agentMeta, status: 'pending' },
        });

        // "brown" -> "red"
        pText.format(10, 5, {
          suggestion_delete: { id: suggestionId, ...agentMeta, status: 'pending' },
        });
        pText.insert(15, 'red', {
          suggestion_insert: { id: suggestionId, ...agentMeta, status: 'pending' },
        });
      }, { type: 'agent' });

      // Accept suggestion
      acceptSuggestion(doc, suggestionId, humanUserId);

      // All deletions removed, insertions kept and attributed with 0 index drift
      expect(getPlainTextFromXmlText(pText)).toBe('The quick red fox jumps over the sleepy dog.');

      const delta = pText.toDelta();
      const redOp = delta.find((op) => op.insert === 'red');
      const sleepyOp = delta.find((op) => op.insert === 'sleepy');
      expect(redOp?.attributes?.attribution).toBeDefined();
      expect(sleepyOp?.attributes?.attribution).toBeDefined();
    });

    it('end-to-end: diff proposal accepted converts to clean exported markdown with attribution', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('default');

      doc.transact(() => {
        const h = new Y.XmlElement('heading');
        fragment.push([h]);
        h.setAttribute('level', '2');
        const ht = new Y.XmlText();
        h.push([ht]);
        ht.insert(0, 'Architecture');

        const p = new Y.XmlElement('paragraph');
        fragment.push([p]);
        const pt = new Y.XmlText();
        p.push([pt]);
        pt.insert(0, 'Monolithic architecture without isolation.');
      });

      const diffRes = suggestEditSection(
        doc,
        'Architecture',
        'Microservice architecture with complete tenant isolation.',
        agentMeta
      );

      expect(diffRes.success).toBe(true);
      const sugId = diffRes.suggestionIds[0];

      // Accept all suggestion hunks for this edit
      for (const id of diffRes.suggestionIds) {
        acceptSuggestion(doc, id, humanUserId);
      }

      const pmDoc = initProseMirrorDoc(fragment, blogSchema);
      const exported = exportDerivedMarkdown(pmDoc.doc);

      expect(exported).toContain('## Architecture');
      expect(exported).toContain('Microservice architecture with complete tenant isolation.');
      expect(exported).not.toContain('Monolithic');
    });
  });

  describe('rejectSuggestion', () => {
    it('physically deletes proposed insertion text upon rejection', () => {
      const { doc, pText } = createDocWithParagraph('Stable text. ');
      const suggestionId = 'sug-rej-ins-01';

      doc.transact(() => {
        pText.insert(13, 'Unwanted addition.', {
          suggestion_insert: { id: suggestionId, ...agentMeta, status: 'pending' },
          suggestion_delete: null,
        });
      }, { type: 'agent' });

      expect(getPlainTextFromXmlText(pText)).toBe('Stable text. Unwanted addition.');

      rejectSuggestion(doc, suggestionId, humanUserId);

      // Rejection removes the inserted text completely
      expect(getPlainTextFromXmlText(pText)).toBe('Stable text. ');
      const delta = pText.toDelta();
      expect(delta.some((op) => op.insert.toString().includes('Unwanted'))).toBe(false);
    });

    it('strips suggestion_delete mark and retains original prose upon rejection', () => {
      const { doc, pText } = createDocWithParagraph('Original critical sentence preserved.');
      const suggestionId = 'sug-rej-del-01';

      doc.transact(() => {
        pText.format(9, 8, {
          suggestion_delete: { id: suggestionId, ...agentMeta, status: 'pending' },
          suggestion_insert: null,
        });
      }, { type: 'agent' });

      rejectSuggestion(doc, suggestionId, humanUserId);

      // Rejection strips deletion mark; original text is completely retained
      expect(getPlainTextFromXmlText(pText)).toBe('Original critical sentence preserved.');
      const delta = pText.toDelta();
      // No suggestion marks remain anywhere in delta
      for (const op of delta) {
        expect(op.attributes?.suggestion_delete).toBeUndefined();
        expect(op.attributes?.suggestion_insert).toBeUndefined();
      }
    });

    it('end-to-end: diff proposal rejected leaves document identical to original state', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('default');

      doc.transact(() => {
        const h = new Y.XmlElement('heading');
        fragment.push([h]);
        h.setAttribute('level', '2');
        const ht = new Y.XmlText();
        h.push([ht]);
        ht.insert(0, 'Architecture');

        const p = new Y.XmlElement('paragraph');
        fragment.push([p]);
        const pt = new Y.XmlText();
        p.push([pt]);
        pt.insert(0, 'Original golden text preserved forever.');
      });

      const initialExport = exportDerivedMarkdown(initProseMirrorDoc(fragment, blogSchema).doc);

      const diffRes = suggestEditSection(
        doc,
        'Architecture',
        'Radical disruptive rewrite.',
        agentMeta
      );

      // Reject all hunks
      for (const id of diffRes.suggestionIds) {
        rejectSuggestion(doc, id, humanUserId);
      }

      const postRejectExport = exportDerivedMarkdown(initProseMirrorDoc(fragment, blogSchema).doc);
      expect(postRejectExport).toBe(initialExport);
      expect(postRejectExport).toContain('Original golden text preserved forever.');
    });
  });

  describe('resolveSuggestion Dispatcher', () => {
    it('dispatches accept and reject properly', () => {
      const { doc, pText } = createDocWithParagraph('Prefix ');
      const sug1 = 'sug-disp-1';
      const sug2 = 'sug-disp-2';

      doc.transact(() => {
        pText.insert(7, 'kept addition. ', {
          suggestion_insert: { id: sug1, ...agentMeta, status: 'pending' },
        });
        pText.insert(22, 'discarded addition.', {
          suggestion_insert: { id: sug2, ...agentMeta, status: 'pending' },
        });
      });

      resolveSuggestion(doc, {
        suggestionId: sug1,
        action: 'accept',
        resolvedByUserId: humanUserId,
      });

      resolveSuggestion(doc, {
        suggestionId: sug2,
        action: 'reject',
        resolvedByUserId: humanUserId,
      });

      expect(getPlainTextFromXmlText(pText)).toBe('Prefix kept addition. ');
      const delta = pText.toDelta();
      const kept = delta.find((op) => op.insert === 'kept addition. ');
      expect(kept?.attributes?.attribution).toBeDefined();
    });
  });

  describe('ProseMirror Transaction Helpers (acceptSuggestionTr & rejectSuggestionTr)', () => {
    it('acceptSuggestionTr converts insert to attribution and removes deletion', () => {
      const suggestionId = 'pm-sug-001';
      const insMark = blogSchema.marks[MARK_SUGGESTION_INSERT].create({
        id: suggestionId,
        ...agentMeta,
        status: 'pending',
      });
      const delMark = blogSchema.marks[MARK_SUGGESTION_DELETE].create({
        id: suggestionId,
        ...agentMeta,
        status: 'pending',
      });

      const docNode = blogSchema.nodes.doc.create({}, [
        blogSchema.nodes.paragraph.create({}, [
          blogSchema.text('Prefix '),
          blogSchema.text('old text ', [delMark]),
          blogSchema.text('new text', [insMark]),
          blogSchema.text(' suffix'),
        ]),
      ]);

      const state = EditorState.create({ doc: docNode, schema: blogSchema });
      const tr = acceptSuggestionTr(state, suggestionId, humanUserId);
      const newState = state.apply(tr);

      expect(newState.doc.textContent).toBe('Prefix new text suffix');
      // Verify attribution mark on 'new text'
      let foundAttr = false;
      newState.doc.descendants((node) => {
        if (node.isText && node.text === 'new text') {
          const attr = node.marks.find((m) => m.type.name === MARK_ATTRIBUTION);
          if (attr) {
            foundAttr = true;
            expect(attr.attrs.acceptedBy).toBe(humanUserId);
          }
        }
      });
      expect(foundAttr).toBe(true);
    });

    it('rejectSuggestionTr deletes insertion and clears deletion mark', () => {
      const suggestionId = 'pm-sug-002';
      const insMark = blogSchema.marks[MARK_SUGGESTION_INSERT].create({
        id: suggestionId,
        ...agentMeta,
        status: 'pending',
      });
      const delMark = blogSchema.marks[MARK_SUGGESTION_DELETE].create({
        id: suggestionId,
        ...agentMeta,
        status: 'pending',
      });

      const docNode = blogSchema.nodes.doc.create({}, [
        blogSchema.nodes.paragraph.create({}, [
          blogSchema.text('Prefix '),
          blogSchema.text('original text ', [delMark]),
          blogSchema.text('rejected addition', [insMark]),
          blogSchema.text(' suffix'),
        ]),
      ]);

      const state = EditorState.create({ doc: docNode, schema: blogSchema });
      const tr = rejectSuggestionTr(state, suggestionId, humanUserId);
      const newState = state.apply(tr);

      expect(newState.doc.textContent).toBe('Prefix original text  suffix');
      // Verify no suggestion marks remain
      newState.doc.descendants((node) => {
        if (node.isText) {
          expect(node.marks.some((m) => m.type.name.startsWith('suggestion_'))).toBe(false);
        }
      });
    });
  });
});
