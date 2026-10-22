import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { EditorState } from 'prosemirror-state';
import { ReplaceStep } from 'prosemirror-transform';
import { Slice } from 'prosemirror-model';
import { ySyncPluginKey } from 'y-prosemirror';
import { blogSchema } from '../../src/schema/index.js';
import {
  createSuggestionCollisionPlugin,
  attachYjsCollisionObserver,
} from '../../src/suggestion/collision.js';
import {
  createHumanUndoManager,
  createHumanUndoPlugin,
  createAgentOrigin,
  isAgentOrigin,
  runAgentTransaction,
} from '../../src/suggestion/undo.js';
import {
  appendSection,
  suggestEditSection,
  getPlainTextFromXmlText,
} from '../../src/suggestion/operations.js';
import {
  MARK_SUGGESTION_INSERT,
  MARK_SUGGESTION_DELETE,
} from '../../src/schema/marks/constants.js';
import type { AgentMetadata } from '../../src/types/index.js';

describe('Adversarial Stress Verification: Collision Resolution & UndoManager Isolation', () => {
  const agentMeta: AgentMetadata = {
    agentId: 'agent:researcher:v1',
    tokenId: 'tok-adv-999',
    ownerUserId: 'user-adversary',
    timestamp: 1729600000000,
  };

  describe('Adversarial Task 1: Typing Collision Mechanics', () => {
    describe('1.1 High-Frequency Human Typing Inside suggestion_delete Range', () => {
      it('simulates 500 consecutive rapid keystrokes directly inside a deletion range: 0 keystrokes lost and deletion is auto-rejected', () => {
        const delMark = blogSchema.marks[MARK_SUGGESTION_DELETE].create({
          id: 'del-sug-stress-1',
          ...agentMeta,
          status: 'pending',
        });

        // Initial doc: "Prefix [obsolete phrase] Suffix"
        // "Prefix " is 1..8
        // "obsolete phrase" is 8..23
        // " Suffix" is 23..30
        const initialText = 'Prefix obsolete phrase Suffix';
        const doc = blogSchema.nodes.doc.create({}, [
          blogSchema.nodes.paragraph.create({}, [
            blogSchema.text('Prefix '),
            blogSchema.text('obsolete phrase', [delMark]),
            blogSchema.text(' Suffix'),
          ]),
        ]);

        const plugin = createSuggestionCollisionPlugin(blogSchema);
        let state = EditorState.create({
          doc,
          schema: blogSchema,
          plugins: [plugin],
        });

        // Human cursor placed inside 'obsolete phrase' at pos 16 (after 'obsolete ')
        let currentPos = 16;
        const keystrokeStream: string[] = [];

        // Generate 500 distinct keystrokes (alphanumeric pattern)
        for (let i = 0; i < 500; i++) {
          const char = String.fromCharCode(97 + (i % 26)); // 'a'..'z'
          keystrokeStream.push(char);
          const tr = state.tr.insertText(char, currentPos);
          state = state.apply(tr);
          currentPos += 1;
        }

        const expectedInsertedText = keystrokeStream.join('');
        const finalContent = state.doc.textContent;

        // 1. Assert exactly 0 keystrokes lost
        expect(finalContent).toContain(expectedInsertedText);
        expect(finalContent).toBe(
          `Prefix obsolete${expectedInsertedText} phrase Suffix`
        );
        expect(finalContent.length).toBe(initialText.length + 500);

        // 2. Assert suggestion_delete mark was completely auto-rejected (0 deletion marks remain)
        let foundDeletionMark = false;
        state.doc.descendants((node) => {
          if (
            node.isText &&
            node.marks.some((m) => m.type.name === MARK_SUGGESTION_DELETE)
          ) {
            foundDeletionMark = true;
          }
        });
        expect(foundDeletionMark).toBe(false);
      });

      it('handles multi-step transaction bursts inside deletion range without range or mapping errors', () => {
        const delMark = blogSchema.marks[MARK_SUGGESTION_DELETE].create({
          id: 'del-sug-burst-1',
          ...agentMeta,
          status: 'pending',
        });

        const doc = blogSchema.nodes.doc.create({}, [
          blogSchema.nodes.paragraph.create({}, [
            blogSchema.text('Start '),
            blogSchema.text('doomed text block', [delMark]),
            blogSchema.text(' End'),
          ]),
        ]);

        const plugin = createSuggestionCollisionPlugin(blogSchema);
        let state = EditorState.create({
          doc,
          schema: blogSchema,
          plugins: [plugin],
        });

        // Apply a multi-step transaction with 5 disjoint steps inside and adjacent
        // "Start " is 1..7
        // "doomed text block" is 7..24
        // " End" is 24..28
        const tr = state.tr;
        tr.insertText('[1]', 10); // step 1 inside
        tr.insertText('[2]', 16); // step 2 inside (shifted)
        tr.insertText('[3]', 22); // step 3 inside (shifted)

        state = state.apply(tr);

        expect(state.doc.textContent).toContain('[1]');
        expect(state.doc.textContent).toContain('[2]');
        expect(state.doc.textContent).toContain('[3]');

        // Deletion mark must be stripped
        let hasDel = false;
        state.doc.descendants((node) => {
          if (node.isText && node.marks.some((m) => m.type.name === MARK_SUGGESTION_DELETE)) {
            hasDel = true;
          }
        });
        expect(hasDel).toBe(false);
      });

      it('typing in one deletion hunk auto-rejects ONLY that hunk, leaving other deletion hunks pending', () => {
        const delMarkA = blogSchema.marks[MARK_SUGGESTION_DELETE].create({
          id: 'del-hunk-A',
          ...agentMeta,
          status: 'pending',
        });

        const delMarkB = blogSchema.marks[MARK_SUGGESTION_DELETE].create({
          id: 'del-hunk-B',
          ...agentMeta,
          status: 'pending',
        });

        // Doc: "Alpha [deleted A] middle [deleted B] omega"
        const doc = blogSchema.nodes.doc.create({}, [
          blogSchema.nodes.paragraph.create({}, [
            blogSchema.text('Alpha '),
            blogSchema.text('deleted A', [delMarkA]),
            blogSchema.text(' middle '),
            blogSchema.text('deleted B', [delMarkB]),
            blogSchema.text(' omega'),
          ]),
        ]);

        const plugin = createSuggestionCollisionPlugin(blogSchema);
        let state = EditorState.create({
          doc,
          schema: blogSchema,
          plugins: [plugin],
        });

        // Human types inside hunk A: pos 10
        const tr = state.tr.insertText('EDITED ', 10);
        state = state.apply(tr);

        // Verify Hunk A lost its mark
        let hunkAHadMark = false;
        let hunkBHasMark = false;

        state.doc.descendants((node) => {
          if (node.isText) {
            if (node.text?.includes('deleted A') || node.text?.includes('EDITED')) {
              if (node.marks.some((m) => m.attrs.id === 'del-hunk-A')) {
                hunkAHadMark = true;
              }
            }
            if (node.text?.includes('deleted B')) {
              if (node.marks.some((m) => m.attrs.id === 'del-hunk-B')) {
                hunkBHasMark = true;
              }
            }
          }
        });

        expect(hunkAHadMark).toBe(false); // Auto-rejected
        expect(hunkBHasMark).toBe(true);  // Untouched, STILL PENDING
      });

      it('verifies whether attachYjsCollisionObserver isolates touched vs untouched deletion hunks', () => {
        const doc = new Y.Doc();
        const fragment = doc.getXmlFragment('default');
        let pText!: Y.XmlText;

        doc.transact(() => {
          const p = new Y.XmlElement('paragraph');
          fragment.push([p]);
          pText = new Y.XmlText();
          p.push([pText]);
          pText.insert(0, 'Start clean text. Obsolete hunk downstream.');
        });

        // Agent marks 'Obsolete hunk' for deletion
        doc.transact(() => {
          pText.format(18, 13, {
            suggestion_delete: { id: 'del-downstream', ...agentMeta, status: 'pending' },
          });
        }, { origin: 'agent', type: 'agent' });

        // Verify initial delta has suggestion_delete on 'Obsolete hunk'
        let initialDelta = pText.toDelta();
        expect(
          initialDelta.some((op) => op.attributes?.suggestion_delete?.id === 'del-downstream')
        ).toBe(true);

        // Attach collision observer
        const detach = attachYjsCollisionObserver(doc);

        // Human edits at the VERY BEGINNING of the paragraph (offset 0), far away from offset 18
        doc.transact(() => {
          pText.insert(0, 'Prefix ');
        }, ySyncPluginKey);

        // Check if the untouched downstream suggestion_delete mark was preserved or incorrectly cleared
        const deltaAfterEdit = pText.toDelta();
        const downstreamOp = deltaAfterEdit.find(
          (op) => typeof op.insert === 'string' && op.insert.includes('Obsolete hunk')
        );

        // If attachYjsCollisionObserver indiscriminately cleared the mark, this will be undefined
        // NOTE: In attachYjsCollisionObserver, delta loop indiscriminately clears all deletion marks across ytext.
        // We capture this finding empirically.
        const markStillPresent = downstreamOp?.attributes?.suggestion_delete !== undefined;
        // Document empirical result
        expect(markStillPresent).toBe(false); // Confirms the defect: attachYjsCollisionObserver falsely clears untouched hunks!
      });

      it('analyzes boundary sensitivity of ProseMirror collision plugin (pos === from vs 1 char prior)', () => {
        const delMark = blogSchema.marks[MARK_SUGGESTION_DELETE].create({
          id: 'del-boundary-test',
          ...agentMeta,
          status: 'pending',
        });

        // Doc: "Before [target] After"
        // "Before " is 1..8
        // "target" is 8..14
        // " After" is 14..20
        const doc = blogSchema.nodes.doc.create({}, [
          blogSchema.nodes.paragraph.create({}, [
            blogSchema.text('Before '),
            blogSchema.text('target', [delMark]),
            blogSchema.text(' After'),
          ]),
        ]);

        const plugin = createSuggestionCollisionPlugin(blogSchema);

        // Test A: Type 2 characters away: inside "Before" at pos 5
        let stateA = EditorState.create({ doc, schema: blogSchema, plugins: [plugin] });
        const trA = stateA.tr.insertText('X', 5);
        stateA = stateA.apply(trA);
        let markPreservedA = false;
        stateA.doc.descendants((node) => {
          if (node.isText && node.marks.some((m) => m.attrs.id === 'del-boundary-test')) {
            markPreservedA = true;
          }
        });
        expect(markPreservedA).toBe(true); // Pos 5 does NOT reject target

        // Test B: Type 1 character away: at pos 7 (between 'e' and ' ' of "Before ")
        let stateB = EditorState.create({ doc, schema: blogSchema, plugins: [plugin] });
        const trB = stateB.tr.insertText('Y', 7);
        stateB = stateB.apply(trB);
        let markPreservedB = false;
        stateB.doc.descendants((node) => {
          if (node.isText && node.marks.some((m) => m.attrs.id === 'del-boundary-test')) {
            markPreservedB = true;
          }
        });
        // In collision.ts: queryStart = oldStart - 1 (6), queryEnd = oldEnd + 1 (8).
        // nodesBetween(6, 8): pos 8 is the start of "target".
        // In ProseMirror, nodesBetween(6, 8) does NOT intersect [8, 14), so pos 7 preserves mark!
        expect(markPreservedB).toBe(true);

        // Test C: Type directly at pos 8 (start boundary of target)
        let stateC = EditorState.create({ doc, schema: blogSchema, plugins: [plugin] });
        const trC = stateC.tr.insertText('Z', 8);
        stateC = stateC.apply(trC);
        let markPreservedC = false;
        stateC.doc.descendants((node) => {
          if (node.isText && node.marks.some((m) => m.attrs.id === 'del-boundary-test')) {
            markPreservedC = true;
          }
        });
        // At pos 8, queryEnd = 9, which intersects [8, 14), so pos 8 auto-rejects!
        expect(markPreservedC).toBe(false);
      });
    });

    describe('1.2 Boundary Typing and Mark Isolation on suggestion_insert', () => {
      it('typing strictly adjacent to start boundary (pos === from) creates un-marked text and keeps suggestion intact', () => {
        const insMark = blogSchema.marks[MARK_SUGGESTION_INSERT].create({
          id: 'sug-boundary-start',
          ...agentMeta,
          status: 'pending',
        });

        // Doc: "Before [AGENT PROPOSAL] After"
        // "Before " is 1..8
        // "AGENT PROPOSAL" is 8..22
        // " After" is 22..28
        const doc = blogSchema.nodes.doc.create({}, [
          blogSchema.nodes.paragraph.create({}, [
            blogSchema.text('Before '),
            blogSchema.text('AGENT PROPOSAL', [insMark]),
            blogSchema.text(' After'),
          ]),
        ]);

        const state = EditorState.create({ doc, schema: blogSchema });

        // Type at exact start boundary pos 8 (before 'A')
        const tr = state.tr.insertText('HUMAN_TYPED_START ', 8);
        const newState = state.apply(tr);

        let typedTextMarks: any = null;
        let agentProposalMarks: any = null;

        newState.doc.descendants((node) => {
          if (node.isText) {
            if (node.text?.includes('HUMAN_TYPED_START')) {
              typedTextMarks = node.marks;
            }
            if (node.text?.includes('AGENT PROPOSAL')) {
              agentProposalMarks = node.marks;
            }
          }
        });

        // Typed text must NOT leak suggestion_insert mark
        expect(typedTextMarks).toBeDefined();
        expect(
          typedTextMarks.some((m: any) => m.type.name === MARK_SUGGESTION_INSERT)
        ).toBe(false);

        // Agent proposal must remain intact with its suggestion_insert mark
        expect(agentProposalMarks).toBeDefined();
        expect(
          agentProposalMarks.some(
            (m: any) =>
              m.type.name === MARK_SUGGESTION_INSERT &&
              m.attrs.id === 'sug-boundary-start'
          )
        ).toBe(true);
      });

      it('typing strictly adjacent to end boundary (pos === to) creates un-marked text and keeps suggestion intact', () => {
        const insMark = blogSchema.marks[MARK_SUGGESTION_INSERT].create({
          id: 'sug-boundary-end',
          ...agentMeta,
          status: 'pending',
        });

        // Doc: "Before [AGENT PROPOSAL] After"
        // "AGENT PROPOSAL" is 8..22
        const doc = blogSchema.nodes.doc.create({}, [
          blogSchema.nodes.paragraph.create({}, [
            blogSchema.text('Before '),
            blogSchema.text('AGENT PROPOSAL', [insMark]),
            blogSchema.text(' After'),
          ]),
        ]);

        const state = EditorState.create({ doc, schema: blogSchema });

        // Type at exact end boundary pos 22 (after 'L')
        const tr = state.tr.insertText(' HUMAN_TYPED_END', 22);
        const newState = state.apply(tr);

        let typedTextMarks: any = null;
        let agentProposalMarks: any = null;

        newState.doc.descendants((node) => {
          if (node.isText) {
            if (node.text?.includes('HUMAN_TYPED_END')) {
              typedTextMarks = node.marks;
            }
            if (node.text?.includes('AGENT PROPOSAL')) {
              agentProposalMarks = node.marks;
            }
          }
        });

        // Typed text must NOT leak suggestion_insert mark
        expect(typedTextMarks).toBeDefined();
        expect(
          typedTextMarks.some((m: any) => m.type.name === MARK_SUGGESTION_INSERT)
        ).toBe(false);

        // Agent proposal must remain intact
        expect(agentProposalMarks).toBeDefined();
        expect(
          agentProposalMarks.some(
            (m: any) =>
              m.type.name === MARK_SUGGESTION_INSERT &&
              m.attrs.id === 'sug-boundary-end'
          )
        ).toBe(true);
      });

      it('typing inside suggestion_insert retains suggestion mark and provenance', () => {
        const insMark = blogSchema.marks[MARK_SUGGESTION_INSERT].create({
          id: 'sug-inside-test',
          ...agentMeta,
          status: 'pending',
        });

        // Doc: "Before [AGENT PROPOSAL] After"
        // pos 8..22 is "AGENT PROPOSAL"
        const doc = blogSchema.nodes.doc.create({}, [
          blogSchema.nodes.paragraph.create({}, [
            blogSchema.text('Before '),
            blogSchema.text('AGENT PROPOSAL', [insMark]),
            blogSchema.text(' After'),
          ]),
        ]);

        const state = EditorState.create({ doc, schema: blogSchema });

        // Type inside at pos 13 ("AGENT" | " PROPOSAL")
        const tr = state.tr.insertText(' REVISED', 13);
        const newState = state.apply(tr);

        let fullInsertedHunk = '';
        let markAttrs: any = null;

        newState.doc.descendants((node) => {
          if (node.isText) {
            const m = node.marks.find(
              (mark) => mark.type.name === MARK_SUGGESTION_INSERT
            );
            if (m) {
              fullInsertedHunk += node.text;
              markAttrs = m.attrs;
            }
          }
        });

        expect(fullInsertedHunk).toBe('AGENT REVISED PROPOSAL');
        expect(markAttrs.id).toBe('sug-inside-test');
        expect(markAttrs.agentId).toBe(agentMeta.agentId);
        expect(markAttrs.status).toBe('pending');
      });
    });
  });

  describe('Adversarial Task 2: UndoManager Isolation Under 100 Consecutive Operations', () => {
    it('executes 100 interleaved human keystrokes and agent suggestions; 100 consecutive Ctrl+Z operations roll back ALL human edits and ZERO agent suggestions', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('default');
      let pText!: Y.XmlText;

      doc.transact(() => {
        const p = new Y.XmlElement('paragraph');
        fragment.push([p]);
        pText = new Y.XmlText();
        p.push([pText]);
      });

      // Human-only UndoManager tracking ySyncPluginKey
      const undoManager = createHumanUndoManager(fragment, {
        captureTimeout: 0, // Every transaction gets its own undo stack item
      });

      const totalCycles = 100;
      const expectedAgentTokens: string[] = [];
      const expectedHumanTokens: string[] = [];

      // Interleave 100 human edits and 100 agent suggestions
      for (let i = 1; i <= totalCycles; i++) {
        const humanWord = `H${i} `;
        const agentWord = `A${i} `;
        expectedHumanTokens.push(humanWord);
        expectedAgentTokens.push(agentWord);

        // 1. Human types humanWord
        doc.transact(() => {
          pText.insert(pText.length, humanWord);
        }, ySyncPluginKey);

        // 2. Agent gateway performs suggestion edit
        const agentOrigin = createAgentOrigin(
          {
            agentId: `agent:bot:${i}`,
            tokenId: `tok-${i}`,
            ownerUserId: `user-001`,
            timestamp: Date.now() + i,
          },
          'suggest_edit'
        );

        runAgentTransaction(doc, agentOrigin, () => {
          pText.insert(pText.length, agentWord, {
            suggestion_insert: {
              id: `sug-hunk-${i}`,
              agentId: `agent:bot:${i}`,
              tokenId: `tok-${i}`,
              ownerUserId: `user-001`,
              timestamp: Date.now() + i,
              status: 'pending',
            },
          });
        });
      }

      // Assert UndoManager stack captured exactly the 100 human transactions (and 0 agent transactions)
      expect(undoManager.undoStack.length).toBe(totalCycles);
      expect(undoManager.redoStack.length).toBe(0);

      // Verify full document before undo
      const textBeforeUndo = getPlainTextFromXmlText(pText);
      for (let i = 1; i <= totalCycles; i++) {
        expect(textBeforeUndo).toContain(`H${i} `);
        expect(textBeforeUndo).toContain(`A${i} `);
      }

      // Execute 100 consecutive Ctrl+Z operations on the human client
      for (let k = 1; k <= totalCycles; k++) {
        expect(undoManager.undoStack.length).toBe(totalCycles - k + 1);
        undoManager.undo();
      }

      // Assert human undo stack is completely drained
      expect(undoManager.undoStack.length).toBe(0);
      expect(undoManager.redoStack.length).toBe(totalCycles);

      // Inspect document state after 100 undos
      const textAfter100Undos = getPlainTextFromXmlText(pText);

      // CRITICAL ASSERTION 1: ALL human edits are cleanly rolled back
      for (let i = 1; i <= totalCycles; i++) {
        expect(textAfter100Undos).not.toContain(`H${i} `);
      }

      // CRITICAL ASSERTION 2: ZERO agent suggestions are reversed or corrupted
      for (let i = 1; i <= totalCycles; i++) {
        expect(textAfter100Undos).toContain(`A${i} `);
      }

      // Assert the remaining text consists exclusively of the 100 agent suggestions in exact sequence
      const expectedRemainingText = expectedAgentTokens.join('');
      expect(textAfter100Undos).toBe(expectedRemainingText);

      // Verify the Yjs formatting attributes on the remaining 100 agent hunks
      const delta = pText.toDelta();
      let agentHunkCount = 0;
      for (const op of delta) {
        if (typeof op.insert === 'string' && op.insert.startsWith('A')) {
          const sugIns = op.attributes?.suggestion_insert;
          expect(sugIns).toBeDefined();
          expect(sugIns.status).toBe('pending');
          agentHunkCount++;
        }
      }
      expect(agentHunkCount).toBe(totalCycles);

      // Execute 100 consecutive Ctrl+Y operations to test redo stability
      for (let k = 1; k <= totalCycles; k++) {
        undoManager.redo();
      }

      expect(undoManager.undoStack.length).toBe(totalCycles);
      expect(undoManager.redoStack.length).toBe(0);

      // Document should now contain both all human edits and all agent suggestions
      const textAfter100Redos = getPlainTextFromXmlText(pText);
      for (let i = 1; i <= totalCycles; i++) {
        expect(textAfter100Redos).toContain(`H${i} `);
        expect(textAfter100Redos).toContain(`A${i} `);
      }

      // Extra 50 Ctrl+Z calls past stack boundary: must be stable no-ops
      for (let k = 1; k <= totalCycles; k++) {
        undoManager.undo();
      }
      for (let extra = 0; extra < 50; extra++) {
        undoManager.undo(); // Excess undos
      }
      expect(getPlainTextFromXmlText(pText)).toBe(expectedRemainingText);
    });

    it('interleaves human typing with section-level agent operations (appendSection, suggestEditSection) and cleanly undos human typing without corrupting agent sections', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('default');

      // Seed initial section
      doc.transact(() => {
        const h1 = new Y.XmlElement('heading');
        h1.setAttribute('level', 1);
        const h1Text = new Y.XmlText();
        h1Text.insert(0, 'Architecture');
        h1.push([h1Text]);

        const p1 = new Y.XmlElement('paragraph');
        const p1Text = new Y.XmlText();
        p1Text.insert(0, 'Initial architecture overview.');
        p1.push([p1Text]);

        fragment.push([h1, p1]);
      });

      const undoManager = createHumanUndoManager(fragment, {
        captureTimeout: 0,
      });

      // 1. Human edits paragraph 1
      const p1 = fragment.get(1) as Y.XmlElement;
      const p1Text = p1.get(0) as Y.XmlText;
      doc.transact(() => {
        p1Text.insert(p1Text.length, ' Human note A.');
      }, ySyncPluginKey);

      // 2. Agent appends a new section
      const agentOrigin = createAgentOrigin(agentMeta, 'append_section');
      runAgentTransaction(doc, agentOrigin, () => {
        appendSection(
          doc,
          'Security',
          'Zero trust architecture is enforced.',
          agentMeta,
          { headingLevel: 2, fragmentName: 'default' }
        );
      });

      // 3. Human edits the newly appended section
      const pSec = fragment.get(3) as Y.XmlElement;
      const pSecText = pSec.get(0) as Y.XmlText;
      doc.transact(() => {
        pSecText.insert(pSecText.length, ' Human note B.');
      }, ySyncPluginKey);

      // 4. Agent performs suggestEditSection on the Security section
      const agentSuggestOrigin = createAgentOrigin(agentMeta, 'suggest_edit');
      runAgentTransaction(doc, agentSuggestOrigin, () => {
        suggestEditSection(
          doc,
          'Security',
          'Zero trust architecture and mTLS are enforced.',
          agentMeta,
          { diffMode: 'word', fragmentName: 'default' }
        );
      });

      // 5. Human adds human note C
      doc.transact(() => {
        pSecText.insert(pSecText.length, ' Human note C.');
      }, ySyncPluginKey);

      // Human has performed 3 distinct transactions: A, B, C
      expect(undoManager.undoStack.length).toBe(3);

      // Undo 3 times
      undoManager.undo(); // undos note C
      undoManager.undo(); // undos note B
      undoManager.undo(); // undos note A

      expect(undoManager.undoStack.length).toBe(0);

      // Verify document:
      // Note A, B, C must not exist
      const p1Final = getPlainTextFromXmlText(p1Text);
      expect(p1Final).not.toContain('Human note A.');

      const pSecFinal = getPlainTextFromXmlText(pSecText);
      expect(pSecFinal).not.toContain('Human note B.');
      expect(pSecFinal).not.toContain('Human note C.');

      // Agent appended section 'Security' MUST REMAIN INTACT!
      const h2 = fragment.get(2) as Y.XmlElement;
      const h2Text = h2.get(0) as Y.XmlText;
      expect(getPlainTextFromXmlText(h2Text)).toBe('Security');

      // Agent suggestion hunks MUST REMAIN INTACT
      expect(pSecFinal).toContain('Zero trust architecture');
      expect(pSecFinal).toContain('mTLS');
    });
  });
});
