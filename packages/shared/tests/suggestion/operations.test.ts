import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  appendSection,
  insertAfterSection,
  suggestEditSection,
  findSectionBoundary,
  getDocumentFragment,
  normalizeHeadingText,
  extractTextFromElement,
  getPlainTextFromXmlText,
} from '../../src/suggestion/operations.js';
import { exportDerivedMarkdown } from '../../src/export/markdown.js';
import { blogSchema } from '../../src/schema/index.js';
import { initProseMirrorDoc } from 'y-prosemirror';
import type { AgentMetadata } from '../../src/types/index.js';

describe('Suggestion Engine: Additive Operations & Myers Diff (operations.ts)', () => {
  const agentMeta: AgentMetadata = {
    agentId: 'agent:researcher:v1',
    tokenId: 'pat-12345-uuid',
    ownerUserId: 'user-writer-001',
    timestamp: 1729600000000,
  };

  function setupDocWithStructure(): { doc: Y.Doc; fragment: Y.XmlFragment } {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('default');

    doc.transact(() => {
      // H1 "Specification Overview"
      const h1 = new Y.XmlElement('heading');
      fragment.push([h1]);
      h1.setAttribute('level', '1');
      const h1Text = new Y.XmlText();
      h1.push([h1Text]);
      h1Text.insert(0, 'Specification Overview');

      // Paragraph
      const p1 = new Y.XmlElement('paragraph');
      fragment.push([p1]);
      const p1Text = new Y.XmlText();
      p1.push([p1Text]);
      p1Text.insert(0, 'Introductory overview paragraph.');

      // H2 "Architecture"
      const h2 = new Y.XmlElement('heading');
      fragment.push([h2]);
      h2.setAttribute('level', '2');
      const h2Text = new Y.XmlText();
      h2.push([h2Text]);
      h2Text.insert(0, 'Architecture');

      // Paragraph under Architecture
      const p2 = new Y.XmlElement('paragraph');
      fragment.push([p2]);
      const p2Text = new Y.XmlText();
      p2.push([p2Text]);
      p2Text.insert(0, 'Architecture description paragraph.');

      // H3 "Data Flow" (Subsection under Architecture)
      const h3 = new Y.XmlElement('heading');
      fragment.push([h3]);
      h3.setAttribute('level', '3');
      const h3Text = new Y.XmlText();
      h3.push([h3Text]);
      h3Text.insert(0, 'Data Flow');

      // Paragraph under Data Flow
      const p3 = new Y.XmlElement('paragraph');
      fragment.push([p3]);
      const p3Text = new Y.XmlText();
      p3.push([p3Text]);
      p3Text.insert(0, 'Data pipeline details.');

      // H2 "Security" (Sibling section)
      const h2Sec = new Y.XmlElement('heading');
      fragment.push([h2Sec]);
      h2Sec.setAttribute('level', '2');
      const h2SecText = new Y.XmlText();
      h2Sec.push([h2SecText]);
      h2SecText.insert(0, 'Security');

      // Paragraph under Security
      const p4 = new Y.XmlElement('paragraph');
      fragment.push([p4]);
      const p4Text = new Y.XmlText();
      p4.push([p4Text]);
      p4Text.insert(0, 'Security protocol description.');
    }, 'initialization');

    return { doc, fragment };
  }

  describe('AST Traversal & Section Boundary Resolution', () => {
    it('normalizes markdown heading text cleanly', () => {
      expect(normalizeHeadingText('## Architecture')).toBe('architecture');
      expect(normalizeHeadingText('### **Data Flow** ')).toBe('data flow');
      expect(normalizeHeadingText('# `Security` Protocol')).toBe('security protocol');
    });

    it('extracts plain text recursively from element', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('default');
      const el = new Y.XmlElement('paragraph');
      fragment.push([el]);
      const txt = new Y.XmlText();
      el.push([txt]);
      txt.insert(0, 'Sample text content');
      expect(extractTextFromElement(el)).toBe('Sample text content');
    });

    it('finds section boundary including subsections and stopping at sibling heading', () => {
      const { fragment } = setupDocWithStructure();
      const boundary = findSectionBoundary(fragment, 'Architecture');

      expect(boundary).not.toBeNull();
      expect(boundary!.headingIndex).toBe(2);
      expect(boundary!.headingLevel).toBe(2);
      // Architecture section spans: H2 (idx 2), P2 (idx 3), H3 (idx 4), P3 (idx 5).
      // Stops before H2 "Security" at idx 6.
      expect(boundary!.endIndex).toBe(6);
      expect(boundary!.bodyElements.length).toBe(3); // P2, H3, P3
    });

    it('returns null if target heading does not exist', () => {
      const { fragment } = setupDocWithStructure();
      const boundary = findSectionBoundary(fragment, 'NonExistentHeading');
      expect(boundary).toBeNull();
    });
  });

  describe('appendSection', () => {
    it('safely appends new heading and paragraphs at document end', () => {
      const { doc, fragment } = setupDocWithStructure();
      const initialLength = fragment.length;

      const result = appendSection(
        doc,
        'Conclusion & Next Steps',
        'Final thoughts on the rollout plan.\n\nImmediate milestones to track.',
        agentMeta,
        { headingLevel: 2 }
      );

      expect(result.success).toBe(true);
      expect(result.suggestionIds.length).toBe(3); // 1 heading + 2 paragraphs
      expect(fragment.length).toBe(initialLength + 3);

      // Verify heading element
      const appendedHeading = fragment.get(initialLength) as Y.XmlElement;
      expect(appendedHeading.nodeName).toBe('heading');
      expect(appendedHeading.getAttribute('level')).toBe('2');
      const ht = appendedHeading.get(0) as Y.XmlText;
      expect(getPlainTextFromXmlText(ht)).toBe('Conclusion & Next Steps');

      // Verify suggestion_insert mark attributes
      const delta = ht.toDelta();
      expect(delta[0].attributes?.suggestion_insert).toMatchObject({
        agentId: agentMeta.agentId,
        tokenId: agentMeta.tokenId,
        ownerUserId: agentMeta.ownerUserId,
        status: 'pending',
      });

      // Verify paragraphs
      const p1 = fragment.get(initialLength + 1) as Y.XmlElement;
      expect(p1.nodeName).toBe('paragraph');
      expect(getPlainTextFromXmlText(p1.get(0) as Y.XmlText)).toBe('Final thoughts on the rollout plan.');

      const p2 = fragment.get(initialLength + 2) as Y.XmlElement;
      expect(p2.nodeName).toBe('paragraph');
      expect(getPlainTextFromXmlText(p2.get(0) as Y.XmlText)).toBe('Immediate milestones to track.');
    });

    it('appends paragraphs without a heading when heading is undefined', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('default');

      const result = appendSection(doc, undefined, 'Standalone paragraph.', agentMeta);
      expect(result.success).toBe(true);
      expect(result.suggestionIds.length).toBe(1);
      expect(fragment.length).toBe(1);
      expect((fragment.get(0) as Y.XmlElement).nodeName).toBe('paragraph');
    });
  });

  describe('insertAfterSection', () => {
    it('locates target section and inserts new content after its subtree', () => {
      const { doc, fragment } = setupDocWithStructure();
      // Architecture section ends at idx 6 (before Security)
      const initialSecurity = fragment.get(6);

      const result = insertAfterSection(
        doc,
        'Architecture',
        'Testing Strategy',
        'Unit testing and integration test harness.',
        agentMeta,
        { headingLevel: 2 }
      );

      expect(result.success).toBe(true);
      expect(result.insertedAtIndex).toBe(6);

      // At index 6: inserted H2 "Testing Strategy"
      const insertedH2 = fragment.get(6) as Y.XmlElement;
      expect(insertedH2.nodeName).toBe('heading');
      expect(getPlainTextFromXmlText(insertedH2.get(0) as Y.XmlText)).toBe('Testing Strategy');

      // At index 7: inserted paragraph
      const insertedP = fragment.get(7) as Y.XmlElement;
      expect(insertedP.nodeName).toBe('paragraph');
      expect(getPlainTextFromXmlText(insertedP.get(0) as Y.XmlText)).toBe('Unit testing and integration test harness.');

      // Security is now shifted down to index 8 without unlinking
      const shiftedSecurity = fragment.get(8);
      expect(shiftedSecurity).toBe(initialSecurity);
      expect((shiftedSecurity as Y.XmlElement).getAttribute('level')).toBe('2');
    });

    it('returns failure when target section does not exist', () => {
      const { doc } = setupDocWithStructure();
      const result = insertAfterSection(doc, 'Unknown Section', 'Title', 'Content', agentMeta);
      expect(result.success).toBe(false);
      expect(result.suggestionIds).toEqual([]);
      expect(result.insertedAtIndex).toBe(-1);
    });
  });

  describe('suggestEditSection (Myers Diff & Non-Destructive Mutation)', () => {
    it('applies non-destructive suggestion_delete and suggestion_insert marks for word diffs', () => {
      const { doc, fragment } = setupDocWithStructure();
      // Section "Security" has paragraph: "Security protocol description."
      // Propose edit: "Security protocol implementation and audit."

      const result = suggestEditSection(
        doc,
        'Security',
        'Security protocol implementation and audit.',
        agentMeta
      );

      expect(result.success).toBe(true);
      expect(result.changesSummary.deletions).toBeGreaterThan(0);
      expect(result.changesSummary.insertions).toBeGreaterThan(0);

      // Inspect Security paragraph ytext
      const boundary = findSectionBoundary(fragment, 'Security');
      const paraEl = boundary!.bodyElements[0];
      const ytext = paraEl.get(0) as Y.XmlText;
      const delta = ytext.toDelta();

      // Delta must contain:
      // "Security protocol " (unchanged, no mark)
      // "description." (marked with suggestion_delete)
      // "implementation and audit." (marked with suggestion_insert)
      const delOp = delta.find((op) => op.attributes?.suggestion_delete);
      const insOp = delta.find((op) => op.attributes?.suggestion_insert);

      expect(delOp).toBeDefined();
      expect(delOp?.insert).toContain('description');
      expect(delOp?.attributes?.suggestion_delete).toMatchObject({
        agentId: agentMeta.agentId,
        tokenId: agentMeta.tokenId,
        ownerUserId: agentMeta.ownerUserId,
        status: 'pending',
      });

      expect(insOp).toBeDefined();
      expect(insOp?.insert).toContain('implementation and audit');
      expect(insOp?.attributes?.suggestion_insert).toMatchObject({
        agentId: agentMeta.agentId,
        tokenId: agentMeta.tokenId,
        ownerUserId: agentMeta.ownerUserId,
        status: 'pending',
      });

      // Crucial: The paragraph node itself was NEVER deleted or replaced!
      expect(boundary!.bodyElements[0]).toBe(paraEl);
    });

    it('guarantees export invariance: exportDerivedMarkdown produces exact original content while pending', () => {
      const { doc } = setupDocWithStructure();
      // Initialize ProseMirror document from Y.Doc
      const pmDoc = initProseMirrorDoc(doc.getXmlFragment('default'), blogSchema);
      const initialExport = exportDerivedMarkdown(pmDoc.doc);
      expect(initialExport).toContain('# Specification Overview');

      // Perform agent suggestion edit
      suggestEditSection(
        doc,
        'Security',
        'Security protocol enhanced zero-trust architecture.',
        agentMeta
      );

      // Re-read ProseMirror document
      const updatedPmDoc = initProseMirrorDoc(doc.getXmlFragment('default'), blogSchema);
      const postSuggestionExport = exportDerivedMarkdown(updatedPmDoc.doc);

      // While suggestions are pending, derived markdown must be 100% IDENTICAL to original
      expect(postSuggestionExport).toBe(initialExport);
      expect(postSuggestionExport).toContain('Security protocol description.');
      expect(postSuggestionExport).not.toContain('zero-trust');
    });

    it('handles char-level granularity when requested', () => {
      const { doc, fragment } = setupDocWithStructure();
      const result = suggestEditSection(
        doc,
        'Security',
        'Security protocol description!',
        agentMeta,
        { granularity: 'chars' }
      );

      expect(result.success).toBe(true);
      expect(result.changesSummary.deletions).toBe(1); // '.' replaced by '!'
      expect(result.changesSummary.insertions).toBe(1);
    });

    it('returns failure when editing a non-existent section', () => {
      const { doc } = setupDocWithStructure();
      const result = suggestEditSection(doc, 'NonExistent', 'New content', agentMeta);
      expect(result.success).toBe(false);
      expect(result.hunks).toEqual([]);
    });
  });
});
