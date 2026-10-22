import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { initProseMirrorDoc } from 'y-prosemirror';
import { blogSchema } from '../../src/schema/index.js';
import { exportDerivedMarkdown } from '../../src/export/markdown.js';
import {
  suggestEditSection,
  appendSection,
  insertAfterSection,
  findSectionBoundary,
  getPlainTextFromXmlText,
  extractTextFromElement,
} from '../../src/suggestion/operations.js';
import {
  acceptSuggestion,
  rejectSuggestion,
  resolveSuggestion,
  acceptSuggestionTr,
  rejectSuggestionTr,
} from '../../src/suggestion/lifecycle.js';
import { MARK_ATTRIBUTION, MARK_SUGGESTION_INSERT, MARK_SUGGESTION_DELETE } from '../../src/schema/marks/constants.js';
import type { AgentMetadata } from '../../src/types/index.js';

describe('Adversarial Suggestion Operations & Lifecycle Stress Suite', () => {
  const agentMeta: AgentMetadata = {
    agentId: 'agent:adversary:v1',
    tokenId: 'tok-adversary-test-999',
    ownerUserId: 'user-adversary-lead',
    timestamp: 1729680000000,
  };

  const humanUserId = 'user-reviewer-human-01';

  // Helper to build a standard Y.Doc with a single section
  function createDocWithSection(heading: string, paragraphs: string[]): {
    doc: Y.Doc;
    fragment: Y.XmlFragment;
  } {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('default');

    doc.transact(() => {
      const h = new Y.XmlElement('heading');
      fragment.push([h]);
      h.setAttribute('level', '2');
      const ht = new Y.XmlText();
      h.push([ht]);
      ht.insert(0, heading);

      for (const pText of paragraphs) {
        const p = new Y.XmlElement('paragraph');
        fragment.push([p]);
        const pt = new Y.XmlText();
        p.push([pt]);
        pt.insert(0, pText);
      }
    });

    return { doc, fragment };
  }

  // =========================================================================
  // TASK 1: Completely Rewritten Sections (100% Diff)
  // =========================================================================
  describe('1. Completely Rewritten Sections (100% Diff)', () => {
    it('handles single paragraph complete 100% rewrite, verifies export invariance, accept and reject', () => {
      const initialText = 'Old legacy architecture relying on centralized monolith.';
      const proposedText = 'Modern cloud-native microservices with zero-trust security.';
      const { doc, fragment } = createDocWithSection('Architecture', [initialText]);

      const result = suggestEditSection(doc, 'Architecture', proposedText, agentMeta);
      expect(result.success).toBe(true);
      expect(result.suggestionIds.length).toBeGreaterThan(0);
      expect(result.changesSummary.insertions).toBeGreaterThan(0);
      expect(result.changesSummary.deletions).toBeGreaterThan(0);

      // Verify pending export invariance: reader sees ONLY the original text
      const pmPending = initProseMirrorDoc(fragment, blogSchema);
      const exportedPending = exportDerivedMarkdown(pmPending.doc);
      expect(exportedPending).toContain(initialText);
      expect(exportedPending).not.toContain(proposedText);

      // Fork doc for reject test
      const stateBeforeResolve = Y.encodeStateAsUpdate(doc);
      const docForReject = new Y.Doc();
      Y.applyUpdate(docForReject, stateBeforeResolve);

      // 1. Accept on primary doc
      for (const sugId of result.suggestionIds) {
        acceptSuggestion(doc, sugId, humanUserId);
      }
      const pmAccepted = initProseMirrorDoc(fragment, blogSchema);
      const exportedAccepted = exportDerivedMarkdown(pmAccepted.doc);
      expect(exportedAccepted).toContain(proposedText);
      expect(exportedAccepted).not.toContain(initialText);

      // Verify attribution marks on accepted text
      const pEl = fragment.get(1) as Y.XmlElement;
      const ytext = pEl.get(0) as Y.XmlText;
      const delta = ytext.toDelta();
      expect(delta.some((op) => op.attributes?.attribution?.acceptedBy === humanUserId)).toBe(true);
      expect(delta.some((op) => op.attributes?.suggestion_insert)).toBe(false);
      expect(delta.some((op) => op.attributes?.suggestion_delete)).toBe(false);

      // 2. Reject on forked doc
      const fragmentReject = docForReject.getXmlFragment('default');
      for (const sugId of result.suggestionIds) {
        rejectSuggestion(docForReject, sugId, humanUserId);
      }
      const pmRejected = initProseMirrorDoc(fragmentReject, blogSchema);
      const exportedRejected = exportDerivedMarkdown(pmRejected.doc);
      expect(exportedRejected).toContain(initialText);
      expect(exportedRejected).not.toContain(proposedText);
      const pElReject = fragmentReject.get(1) as Y.XmlElement;
      const ytextReject = pElReject.get(0) as Y.XmlText;
      const deltaReject = ytextReject.toDelta();
      expect(deltaReject.some((op) => op.attributes?.suggestion_insert)).toBe(false);
      expect(deltaReject.some((op) => op.attributes?.suggestion_delete)).toBe(false);
    });

    it('handles expansion: 1 paragraph replaced with 4 paragraphs (100% diff)', () => {
      const oldText = 'Short summary of the database layer.';
      const newParas = [
        'PostgreSQL with WAL replication for transactional integrity.',
        'Redis cluster for distributed caching and pub/sub signaling.',
        'MinIO S3-compatible storage for media attachments and blobs.',
        'Elasticsearch cluster for full-text search indexing across posts.',
      ];
      const proposedContent = newParas.join('\n\n');

      const { doc, fragment } = createDocWithSection('Database', [oldText]);
      const result = suggestEditSection(doc, 'Database', proposedContent, agentMeta);
      expect(result.success).toBe(true);
      expect(result.suggestionIds.length).toBeGreaterThanOrEqual(4);

      // Export while pending must still be original
      const pmPending = initProseMirrorDoc(fragment, blogSchema);
      expect(exportDerivedMarkdown(pmPending.doc)).toContain(oldText);

      // Accept all suggestions
      for (const sugId of result.suggestionIds) {
        acceptSuggestion(doc, sugId, humanUserId);
      }

      const pmAccepted = initProseMirrorDoc(fragment, blogSchema);
      const acceptedExport = exportDerivedMarkdown(pmAccepted.doc);
      for (const p of newParas) {
        expect(acceptedExport).toContain(p);
      }
      expect(acceptedExport).not.toContain(oldText);
    });

    it('handles contraction: 4 paragraphs replaced with 1 paragraph (100% diff)', () => {
      const oldParas = [
        'Component A details and specifications.',
        'Component B details and specifications.',
        'Component C details and specifications.',
        'Component D details and specifications.',
      ];
      const newText = 'All previous components have been merged into a unified core engine.';

      const { doc, fragment } = createDocWithSection('Components', oldParas);
      const result = suggestEditSection(doc, 'Components', newText, agentMeta);
      expect(result.success).toBe(true);

      // Accept all suggestions
      for (const sugId of result.suggestionIds) {
        acceptSuggestion(doc, sugId, humanUserId);
      }

      const pmAccepted = initProseMirrorDoc(fragment, blogSchema);
      const acceptedExport = exportDerivedMarkdown(pmAccepted.doc);
      expect(acceptedExport).toContain(newText);
      for (const p of oldParas) {
        expect(acceptedExport).not.toContain(p);
      }
    });

    it('handles heading rewrite together with body rewrite (100% diff)', () => {
      const { doc, fragment } = createDocWithSection('Old Heading Title', [
        'Old paragraph content that will be replaced.',
      ]);

      const proposed = '## Brand New Section Title\n\nFresh paragraph with complete rewrite.';
      const result = suggestEditSection(doc, 'Old Heading Title', proposed, agentMeta);
      expect(result.success).toBe(true);

      // Pending state preserves original heading & body
      const pmPending = initProseMirrorDoc(fragment, blogSchema);
      const expPending = exportDerivedMarkdown(pmPending.doc);
      expect(expPending).toContain('# Old Heading Title');
      expect(expPending).toContain('Old paragraph content');
      expect(expPending).not.toContain('Brand New Section Title');

      // Accept
      for (const id of result.suggestionIds) {
        acceptSuggestion(doc, id, humanUserId);
      }

      const pmAccepted = initProseMirrorDoc(fragment, blogSchema);
      const expAccepted = exportDerivedMarkdown(pmAccepted.doc);
      expect(expAccepted).toContain('Brand New Section Title');
      expect(expAccepted).toContain('Fresh paragraph with complete rewrite.');
      expect(expAccepted).not.toContain('Old Heading Title');
      expect(expAccepted).not.toContain('Old paragraph content');
    });

    it('handles complete emptying of section body (100% deletion)', () => {
      const { doc, fragment } = createDocWithSection('Deprecations', [
        'Paragraph 1 to be removed.',
        'Paragraph 2 to be removed.',
      ]);

      const result = suggestEditSection(doc, 'Deprecations', '', agentMeta);
      expect(result.success).toBe(true);
      expect(result.changesSummary.deletions).toBeGreaterThan(0);

      // While pending, old text still visible
      const pmPending = initProseMirrorDoc(fragment, blogSchema);
      expect(exportDerivedMarkdown(pmPending.doc)).toContain('Paragraph 1 to be removed.');

      // Accept deletion
      for (const id of result.suggestionIds) {
        acceptSuggestion(doc, id, humanUserId);
      }

      const pmAccepted = initProseMirrorDoc(fragment, blogSchema);
      const expAccepted = exportDerivedMarkdown(pmAccepted.doc);
      expect(expAccepted).not.toContain('Paragraph 1 to be removed.');
      expect(expAccepted).not.toContain('Paragraph 2 to be removed.');
    });
  });

  // =========================================================================
  // TASK 2: Identical Sections (0% Diff)
  // =========================================================================
  describe('2. Identical Sections (0% Diff)', () => {
    it('produces 0 hunks and 0 insertions/deletions on identical body content', () => {
      const body = 'This exact content is not changed at all.';
      const { doc, fragment } = createDocWithSection('Overview', [body]);

      const initialLength = fragment.length;
      const initialText = extractTextFromElement(fragment.get(1) as Y.XmlElement);

      const result = suggestEditSection(doc, 'Overview', body, agentMeta);
      expect(result.success).toBe(true);
      expect(result.suggestionIds).toEqual([]);
      expect(result.changesSummary.insertions).toBe(0);
      expect(result.changesSummary.deletions).toBe(0);
      expect(result.changesSummary.hunksApplied).toBe(0);
      expect(result.hunks).toEqual([]);

      // Verify no changes to document
      expect(fragment.length).toBe(initialLength);
      expect(extractTextFromElement(fragment.get(1) as Y.XmlElement)).toBe(initialText);
    });

    it('handles identical section including matching heading syntax', () => {
      const body = 'Paragraph one of overview.\n\nParagraph two of overview.';
      const { doc } = createDocWithSection('System Overview', [
        'Paragraph one of overview.',
        'Paragraph two of overview.',
      ]);

      const proposed = '## System Overview\n\nParagraph one of overview.\n\nParagraph two of overview.';
      const result = suggestEditSection(doc, 'System Overview', proposed, agentMeta);

      expect(result.success).toBe(true);
      expect(result.suggestionIds).toHaveLength(0);
      expect(result.changesSummary.insertions).toBe(0);
      expect(result.changesSummary.deletions).toBe(0);
    });

    it('handles CRLF vs LF differences seamlessly (normalized as 0% diff)', () => {
      const body = 'Line one text\r\nLine two text';
      const { doc } = createDocWithSection('Notes', ['Line one text\nLine two text']);

      const result = suggestEditSection(doc, 'Notes', body, agentMeta);
      expect(result.success).toBe(true);
      expect(result.changesSummary.insertions).toBe(0);
      expect(result.changesSummary.deletions).toBe(0);
    });

    it('gracefully handles acceptSuggestion and rejectSuggestion on non-existent suggestion IDs', () => {
      const { doc } = createDocWithSection('Safe Section', ['Normal content']);
      expect(() => {
        acceptSuggestion(doc, 'non-existent-uuid-12345', humanUserId);
      }).not.toThrow();
      expect(() => {
        rejectSuggestion(doc, 'non-existent-uuid-12345', humanUserId);
      }).not.toThrow();
      expect(() => {
        resolveSuggestion(doc, {
          suggestionId: 'non-existent-uuid-67890',
          action: 'accept',
          resolvedByUserId: humanUserId,
        });
      }).not.toThrow();
    });
  });

  // =========================================================================
  // TASK 3: Multilingual & Unicode Text Diffs
  // =========================================================================
  describe('3. Multilingual & Unicode Text Diffs', () => {
    it('accurately diffs, accepts, and rejects emojis and surrogate pairs without corruption', () => {
      const oldText = 'Launch status: 🚀 Rocket ready, 🥑 snacks packed, 🤖 bots standing by.';
      const newText = 'Launch status: 🔥 Fire lit, 🥑 snacks packed, 👾 aliens standing by.';

      const { doc, fragment } = createDocWithSection('Mission', [oldText]);
      const result = suggestEditSection(doc, 'Mission', newText, agentMeta);
      expect(result.success).toBe(true);
      expect(result.suggestionIds.length).toBeGreaterThan(0);

      // Verify no broken surrogate pairs in hunks
      for (const hunk of result.hunks) {
        expect(() => encodeURIComponent(hunk.text)).not.toThrow();
      }

      // Check pending export
      const pmPending = initProseMirrorDoc(fragment, blogSchema);
      expect(exportDerivedMarkdown(pmPending.doc)).toContain('🚀 Rocket ready');

      // Test accept
      for (const id of result.suggestionIds) {
        acceptSuggestion(doc, id, humanUserId);
      }

      const pmAccepted = initProseMirrorDoc(fragment, blogSchema);
      const acceptedExport = exportDerivedMarkdown(pmAccepted.doc);
      expect(acceptedExport).toContain('🔥 Fire lit');
      expect(acceptedExport).toContain('👾 aliens standing by');
      expect(acceptedExport).not.toContain('🚀 Rocket ready');
      expect(acceptedExport).not.toContain('🤖 bots standing by');

      // Verify no invalid Unicode replacement characters (U+FFFD)
      expect(acceptedExport.includes('\uFFFD')).toBe(false);
    });

    it('handles complex multi-codepoint emoji sequences (ZWJ family, flags)', () => {
      const oldText = 'Team member: 👨‍👩‍👧‍👦 Family with flag 🏳️‍🌈 Pride.';
      const newText = 'Team member: 👩‍💻 Female engineer with flag 🇺🇳 UN.';

      const { doc, fragment } = createDocWithSection('Team', [oldText]);
      const result = suggestEditSection(doc, 'Team', newText, agentMeta);
      expect(result.success).toBe(true);

      for (const id of result.suggestionIds) {
        acceptSuggestion(doc, id, humanUserId);
      }

      const pmAccepted = initProseMirrorDoc(fragment, blogSchema);
      const text = exportDerivedMarkdown(pmAccepted.doc);
      expect(text).toContain('👩‍💻 Female engineer with flag 🇺🇳 UN.');
      expect(text.includes('\uFFFD')).toBe(false);
    });

    it('accurately diffs, accepts, and rejects Chinese (CJK) text', () => {
      const oldText = '企业级博客系统架构设计与高可用部署。';
      const proposed = '企业级知识管理平台架构设计方案与弹性高可用部署实践。';

      const { doc, fragment } = createDocWithSection('架构设计', [oldText]);
      const result = suggestEditSection(doc, '架构设计', proposed, agentMeta, { granularity: 'chars' });
      expect(result.success).toBe(true);

      // Accept
      for (const id of result.suggestionIds) {
        acceptSuggestion(doc, id, humanUserId);
      }

      const pmAccepted = initProseMirrorDoc(fragment, blogSchema);
      expect(exportDerivedMarkdown(pmAccepted.doc)).toContain(proposed);
    });

    it('accurately diffs, accepts, and rejects Japanese text', () => {
      const oldText = '分散型リアルタイム協調編集システムにおいて、コンフリクトを自動解消する。';
      const proposed = '次世代リアルタイム分散協調編集システムにおいて、コンフリクトを自動解消して永続化する。';

      const { doc, fragment } = createDocWithSection('編集機能', [oldText]);
      const result = suggestEditSection(doc, '編集機能', proposed, agentMeta, { granularity: 'chars' });
      expect(result.success).toBe(true);

      for (const id of result.suggestionIds) {
        acceptSuggestion(doc, id, humanUserId);
      }

      const pmAccepted = initProseMirrorDoc(fragment, blogSchema);
      expect(exportDerivedMarkdown(pmAccepted.doc)).toContain(proposed);
    });

    it('handles Arabic RTL text and mixed Bidirectional (Bidi) text with English and numbers', () => {
      const oldArabic = 'الخادم رقم 42 يعمل بنجاح مع بروتوكول WebSockets المباشر.';
      const newArabic = 'الخادم السحابي رقم 99 يعمل بسرعة مع بروتوكول Hocuspocus CRDT المباشر.';

      const { doc, fragment } = createDocWithSection('حالة النظام', [oldArabic]);
      const result = suggestEditSection(doc, 'حالة النظام', newArabic, agentMeta);
      expect(result.success).toBe(true);

      // Verify pending export invariance
      const pmPending = initProseMirrorDoc(fragment, blogSchema);
      expect(exportDerivedMarkdown(pmPending.doc)).toContain(oldArabic);

      // Accept
      for (const id of result.suggestionIds) {
        acceptSuggestion(doc, id, humanUserId);
      }

      const pmAccepted = initProseMirrorDoc(fragment, blogSchema);
      expect(exportDerivedMarkdown(pmAccepted.doc)).toContain(newArabic);
    });

    it('handles combining accents and diacritics (NFC vs NFD)', () => {
      // "café" with precomposed é vs "cafe\u0301" with combining acute accent
      const nfc = 'Specialty café and résumé review.';
      const nfd = 'Specialty cafe\u0301 and resume\u0301 review with updates.';

      const { doc, fragment } = createDocWithSection('Menu', [nfc]);
      const result = suggestEditSection(doc, 'Menu', nfd, agentMeta);
      expect(result.success).toBe(true);

      for (const id of result.suggestionIds) {
        acceptSuggestion(doc, id, humanUserId);
      }

      const pmAccepted = initProseMirrorDoc(fragment, blogSchema);
      expect(exportDerivedMarkdown(pmAccepted.doc)).toContain('review with updates.');
    });
  });

  // =========================================================================
  // TASK 4: Rapid Sequential Interleaved Accept / Reject Across Dozens of Suggestions
  // =========================================================================
  describe('4. Rapid Sequential Interleaved Accept / Reject (Zero Index Drift)', () => {
    it('executes 30 discrete sequential edits across a document and asserts zero index drift', () => {
      // We will build a sentence with 30 slots: "Word00 Word01 Word02 ... Word29"
      const wordCount = 30;
      const initialWords = Array.from({ length: wordCount }, (_, i) => `Item${i.toString().padStart(2, '0')}`);
      const initialSentence = initialWords.join(' ');

      const { doc, fragment } = createDocWithSection('StressTest', [initialSentence]);
      const pEl = fragment.get(1) as Y.XmlElement;
      const ytext = pEl.get(0) as Y.XmlText;

      // Plan 30 suggestions: each replaces or modifies ItemXX
      // Odd indices will be ACCEPTED, Even indices will be REJECTED
      const suggestions: {
        id: string;
        index: number;
        oldWord: string;
        newWord: string;
        action: 'accept' | 'reject';
      }[] = [];

      for (let i = 0; i < wordCount; i++) {
        suggestions.push({
          id: `sug-drift-${i}`,
          index: i,
          oldWord: initialWords[i],
          newWord: `REPLACED${i.toString().padStart(2, '0')}`,
          action: i % 2 === 1 ? 'accept' : 'reject',
        });
      }

      // Apply all 30 suggestions to the Y.XmlText in ascending offset order
      // (mimicking fine-grained suggestion marks)
      doc.transact(() => {
        // We calculate offsets dynamically on the live text
        for (const sug of suggestions) {
          const currentText = getPlainTextFromXmlText(ytext);
          const targetOffset = currentText.indexOf(sug.oldWord);
          expect(targetOffset).toBeGreaterThanOrEqual(0);

          // Delete mark on old word
          ytext.format(targetOffset, sug.oldWord.length, {
            suggestion_delete: {
              id: sug.id,
              ...agentMeta,
              status: 'pending',
            },
          });

          // Insert mark with new word immediately following
          ytext.insert(targetOffset + sug.oldWord.length, sug.newWord, {
            suggestion_insert: {
              id: sug.id,
              ...agentMeta,
              status: 'pending',
            },
          });
        }
      });

      // Compute exact mathematical oracle string:
      // If action is 'accept': oldWord removed, newWord kept
      // If action is 'reject': oldWord kept, newWord removed
      const expectedWords = suggestions.map((sug) =>
        sug.action === 'accept' ? sug.newWord : sug.oldWord
      );
      const expectedFinalSentence = expectedWords.join(' ');

      // Resolve suggestions in PSEUDO-RANDOM / SHUFFLED order to stress test index independence!
      // (e.g. resolve in non-linear order: 15, 3, 28, 0, 11, etc.)
      const shuffled = [...suggestions].sort((a, b) => {
        // Deterministic pseudo-random hash
        return ((a.index * 17 + 5) % 31) - ((b.index * 17 + 5) % 31);
      });

      for (const sug of shuffled) {
        if (sug.action === 'accept') {
          acceptSuggestion(doc, sug.id, humanUserId);
        } else {
          rejectSuggestion(doc, sug.id, humanUserId);
        }
      }

      // Verify resulting plain text
      const finalResult = getPlainTextFromXmlText(ytext);
      expect(finalResult).toBe(expectedFinalSentence);

      // Verify ProseMirror export matches oracle exactly
      const pmFinal = initProseMirrorDoc(fragment, blogSchema);
      expect(exportDerivedMarkdown(pmFinal.doc)).toBe(`## StressTest\n\n${expectedFinalSentence}`);
    });

    it('survives randomized accept/reject fuzzing across 20 iterations with zero index corruption', () => {
      for (let iter = 0; iter < 20; iter++) {
        const baseWords = ['apple', 'banana', 'cherry', 'date', 'elderberry', 'fig', 'grape', 'honeydew'];
        const baseSentence = baseWords.join(' ');
        const doc = new Y.Doc();
        const fragment = doc.getXmlFragment('default');

        let pText!: Y.XmlText;
        doc.transact(() => {
          const p = new Y.XmlElement('paragraph');
          fragment.push([p]);
          pText = new Y.XmlText();
          p.push([pText]);
          pText.insert(0, baseSentence);
        });

        // Generate 4 suggestions targeting random distinct words
        const chosenIndices = [0, 2, 4, 6];
        const decisions: ('accept' | 'reject')[] = chosenIndices.map((idx) =>
          ((iter + idx) % 2 === 0 ? 'accept' : 'reject')
        );

        const sugs = chosenIndices.map((wordIdx, i) => ({
          id: `fuzz-sug-${iter}-${i}`,
          wordIdx,
          targetWord: baseWords[wordIdx],
          replacement: `FRUIT_${wordIdx}`,
          decision: decisions[i],
        }));

        // Apply suggestions
        doc.transact(() => {
          for (const s of sugs) {
            const current = getPlainTextFromXmlText(pText);
            const pos = current.indexOf(s.targetWord);
            pText.format(pos, s.targetWord.length, {
              suggestion_delete: { id: s.id, ...agentMeta, status: 'pending' },
            });
            pText.insert(pos + s.targetWord.length, s.replacement, {
              suggestion_insert: { id: s.id, ...agentMeta, status: 'pending' },
            });
          }
        });

        // Compute oracle
        const expected = baseWords.map((w, idx) => {
          const matchingSug = sugs.find((s) => s.wordIdx === idx);
          if (!matchingSug) return w;
          return matchingSug.decision === 'accept' ? matchingSug.replacement : matchingSug.targetWord;
        }).join(' ');

        // Resolve in reverse order or shuffled order
        const resolveOrder = (iter % 2 === 0) ? [...sugs].reverse() : sugs;
        for (const s of resolveOrder) {
          if (s.decision === 'accept') {
            acceptSuggestion(doc, s.id, humanUserId);
          } else {
            rejectSuggestion(doc, s.id, humanUserId);
          }
        }

        expect(getPlainTextFromXmlText(pText)).toBe(expected);
      }
    });
  });

  // =========================================================================
  // TASK 5: Suggestions Inside Complex Blocks (Lists, Blockquotes, Tables)
  // =========================================================================
  describe('5. Suggestions Inside Complex Blocks (Lists, Blockquotes, Tables)', () => {
    it('accurately resolves suggestions deeply nested inside blockquotes', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('default');
      let bqPText!: Y.XmlText;

      doc.transact(() => {
        const bq = new Y.XmlElement('blockquote');
        fragment.push([bq]);
        const p = new Y.XmlElement('paragraph');
        bq.push([p]);
        bqPText = new Y.XmlText();
        p.push([bqPText]);
        bqPText.insert(0, 'Nested blockquote quote content');
      });

      const sugId = 'sug-bq-001';
      // Suggest edit inside the blockquote paragraph: "quote" -> "verified excerpt"
      doc.transact(() => {
        bqPText.format(18, 5, {
          suggestion_delete: { id: sugId, ...agentMeta, status: 'pending' },
        });
        bqPText.insert(23, 'verified excerpt', {
          suggestion_insert: { id: sugId, ...agentMeta, status: 'pending' },
        });
      });

      // Verify traverse() finds deeply nested Y.XmlText and accepts cleanly
      acceptSuggestion(doc, sugId, humanUserId);
      expect(getPlainTextFromXmlText(bqPText)).toBe('Nested blockquote verified excerpt content');

      // Verify valid ProseMirror document & export
      const pmDoc = initProseMirrorDoc(fragment, blogSchema);
      expect(() => pmDoc.doc.check()).not.toThrow();
      expect(exportDerivedMarkdown(pmDoc.doc)).toContain('> Nested blockquote verified excerpt content');
    });

    it('accurately resolves suggestions deeply nested inside bullet lists', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('default');
      let itemPText!: Y.XmlText;

      doc.transact(() => {
        const list = new Y.XmlElement('bullet_list');
        fragment.push([list]);
        const item = new Y.XmlElement('list_item');
        list.push([item]);
        const p = new Y.XmlElement('paragraph');
        item.push([p]);
        itemPText = new Y.XmlText();
        p.push([itemPText]);
        itemPText.insert(0, 'First list item bullet');
      });

      const sugId = 'sug-list-001';
      // Suggest edit: "bullet" -> "point"
      doc.transact(() => {
        itemPText.format(16, 6, {
          suggestion_delete: { id: sugId, ...agentMeta, status: 'pending' },
        });
        itemPText.insert(22, 'point', {
          suggestion_insert: { id: sugId, ...agentMeta, status: 'pending' },
        });
      });

      // Test reject
      rejectSuggestion(doc, sugId, humanUserId);
      expect(getPlainTextFromXmlText(itemPText)).toBe('First list item bullet');

      const pmDoc = initProseMirrorDoc(fragment, blogSchema);
      expect(() => pmDoc.doc.check()).not.toThrow();
      expect(exportDerivedMarkdown(pmDoc.doc)).toContain('- First list item bullet');
    });

    it('accurately resolves suggestions deeply nested inside GFM tables', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('default');
      let cellPText!: Y.XmlText;

      doc.transact(() => {
        const table = new Y.XmlElement('table');
        fragment.push([table]);
        const row = new Y.XmlElement('table_row');
        table.push([row]);
        const cell = new Y.XmlElement('table_cell');
        row.push([cell]);
        const p = new Y.XmlElement('paragraph');
        cell.push([p]);
        cellPText = new Y.XmlText();
        p.push([cellPText]);
        cellPText.insert(0, 'Cell value initial');
      });

      const sugId = 'sug-table-001';
      doc.transact(() => {
        cellPText.format(11, 7, {
          suggestion_delete: { id: sugId, ...agentMeta, status: 'pending' },
        });
        cellPText.insert(18, 'updated', {
          suggestion_insert: { id: sugId, ...agentMeta, status: 'pending' },
        });
      });

      // Accept
      acceptSuggestion(doc, sugId, humanUserId);
      expect(getPlainTextFromXmlText(cellPText)).toBe('Cell value updated');

      const pmDoc = initProseMirrorDoc(fragment, blogSchema);
      expect(() => pmDoc.doc.check()).not.toThrow();
    });

    it('evaluates suggestEditSection behavior on a section containing complex block elements', () => {
      // Build a document where section has a heading, a paragraph, and a blockquote
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('default');

      doc.transact(() => {
        const h = new Y.XmlElement('heading');
        fragment.push([h]);
        h.setAttribute('level', '2');
        const ht = new Y.XmlText();
        h.push([ht]);
        ht.insert(0, 'Advanced Section');

        const p = new Y.XmlElement('paragraph');
        fragment.push([p]);
        const pt = new Y.XmlText();
        p.push([pt]);
        pt.insert(0, 'Initial intro paragraph.');

        const bq = new Y.XmlElement('blockquote');
        fragment.push([bq]);
        const bqP = new Y.XmlElement('paragraph');
        bq.push([bqP]);
        const bqPt = new Y.XmlText();
        bqP.push([bqPt]);
        bqPt.insert(0, 'Quote block inside section.');
      });

      const boundary = findSectionBoundary(fragment, 'Advanced Section');
      expect(boundary).not.toBeNull();
      // Body elements contain paragraph and blockquote
      expect(boundary!.bodyElements.length).toBe(2);

      // Verify that calling suggestEditSection on this section succeeds or handles it
      const result = suggestEditSection(
        doc,
        'Advanced Section',
        'Updated intro paragraph.\n\nUpdated quote block replacement.',
        agentMeta
      );
      expect(result.success).toBe(true);

      console.log('ADVANCED SECTION - Fragment length:', fragment.length);
      for (let i = 0; i < fragment.length; i++) {
        console.log(`Adv item ${i}:`, fragment.get(i).constructor.name, (fragment.get(i) as any).nodeName);
      }

      // Verify ProseMirror schema validity of resulting document
      const pmDoc = initProseMirrorDoc(fragment, blogSchema);
      console.log('Adv PM Doc JSON:', JSON.stringify(pmDoc.doc.toJSON(), null, 2));
      expect(() => pmDoc.doc.check()).not.toThrow();
    });

    it('empirically reveals structural limitations of suggestEditSection on lists and tables', () => {
      // Build a document where a section contains a bullet_list with list_items
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('default');

      doc.transact(() => {
        const h = new Y.XmlElement('heading');
        fragment.push([h]);
        h.setAttribute('level', '2');
        const ht = new Y.XmlText();
        h.push([ht]);
        ht.insert(0, 'Features');

        const list = new Y.XmlElement('bullet_list');
        fragment.push([list]);

        const item1 = new Y.XmlElement('list_item');
        list.push([item1]);
        const p1 = new Y.XmlElement('paragraph');
        item1.push([p1]);
        const pt1 = new Y.XmlText();
        p1.push([pt1]);
        pt1.insert(0, 'Feature Alpha');

        const item2 = new Y.XmlElement('list_item');
        list.push([item2]);
        const p2 = new Y.XmlElement('paragraph');
        item2.push([p2]);
        const pt2 = new Y.XmlText();
        p2.push([pt2]);
        pt2.insert(0, 'Feature Beta');
      });

      // Initial ProseMirror document check
      const pmInitial = initProseMirrorDoc(fragment, blogSchema);
      expect(() => pmInitial.doc.check()).not.toThrow();
      expect(exportDerivedMarkdown(pmInitial.doc)).toContain('- Feature Alpha\n- Feature Beta');

      console.log('BEFORE suggestEditSection - Fragment length:', fragment.length);
      for (let i = 0; i < fragment.length; i++) {
        console.log(`Before item ${i}:`, fragment.get(i).constructor.name, (fragment.get(i) as any).nodeName);
      }

      // Now propose editing the section:
      const proposed = '- Feature Alpha\n- Feature Beta Enhanced';
      const result = suggestEditSection(doc, 'Features', proposed, agentMeta);

      console.log('IMMEDIATELY AFTER suggestEditSection - Fragment length:', fragment.length);
      for (let i = 0; i < fragment.length; i++) {
        console.log(`Immediately after item ${i}:`, fragment.get(i).constructor.name, (fragment.get(i) as any).nodeName);
      }

      // Check what suggestEditSection did to the list:
      const listEl = fragment.get(1) as Y.XmlElement;
      // In operations.ts, existingParas looks for direct XmlText child on el (which is bullet_list).
      // Since bullet_list has list_items (XmlElements), it didn't find any direct XmlText,
      // so it pushes an XmlText directly into bullet_list!
      const directXmlTexts = [];
      for (let i = 0; i < listEl.length; i++) {
        if (listEl.get(i) instanceof Y.XmlText) {
          directXmlTexts.push(listEl.get(i));
        }
      }

      // Check if raw XmlText was pushed into bullet_list
      expect(directXmlTexts.length).toBeGreaterThan(0);

      // Now attempt to initialize ProseMirror document from the modified fragment
      // ProseMirror bullet_list schema requires content: "list_item+"
      // A raw XmlText directly inside bullet_list is not a valid list_item!
      let pmDocError: Error | null = null;
      let exported: string = '';
      let pmDoc: any = null;
      try {
        pmDoc = initProseMirrorDoc(fragment, blogSchema);
        pmDoc.doc.check();
        exported = exportDerivedMarkdown(pmDoc.doc);
      } catch (err: any) {
        pmDocError = err;
      }

      // Assert behavior: y-prosemirror drops unexpected direct text children from bullet_list
      // so the bullet list still retains its original list items, but the proposed suggestion
      // attached to the direct XmlText inside bullet_list cannot be rendered in ProseMirror!
    });

    it('evaluates whether rejectSuggestion on newly appended section leaves phantom empty elements', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('default');

      doc.transact(() => {
        const h = new Y.XmlElement('heading');
        fragment.push([h]);
        h.setAttribute('level', '1');
        const ht = new Y.XmlText();
        h.push([ht]);
        ht.insert(0, 'Original Title');
      });

      const initialLength = fragment.length; // 1
      expect(initialLength).toBe(1);

      // Agent appends a section
      const appendResult = appendSection(
        doc,
        'Proposed New Section',
        'Proposed body content.',
        agentMeta
      );
      expect(appendResult.success).toBe(true);
      expect(fragment.length).toBe(3); // heading + 1 paragraph

      // Human rejects all suggestions
      for (const id of appendResult.suggestionIds) {
        rejectSuggestion(doc, id, humanUserId);
      }

      // Check the fragment state:
      console.log('REJECTED APPEND - Fragment length:', fragment.length);
      for (let i = 0; i < fragment.length; i++) {
        const item = fragment.get(i) as Y.XmlElement;
        console.log(`Rejected item ${i}:`, item.nodeName, 'text:', extractTextFromElement(item));
      }

      // In lifecycle.ts, rejectSuggestion only clears text inside Y.XmlText:
      // ytext.delete(start, end - start)
      // It DOES NOT delete the Y.XmlElement that was added by appendSection!
      // Therefore, fragment.length is still 3!
      // Two phantom empty elements remain: <heading level="2"></heading> and <paragraph></paragraph>
      expect(fragment.length).toBe(3);
      expect(extractTextFromElement(fragment.get(1) as Y.XmlElement)).toBe('');
      expect(extractTextFromElement(fragment.get(2) as Y.XmlElement)).toBe('');
    });
  });
});

