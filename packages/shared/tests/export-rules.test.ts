import { describe, it, expect } from 'vitest';
import { Schema } from 'prosemirror-model';
import { blogNodes } from '../src/schema/nodes/index.js';
import {
  allMarks,
  MARK_SUGGESTION_INSERT,
  MARK_SUGGESTION_DELETE,
} from '../src/schema/marks/index.js';
import { exportDerivedMarkdown } from '../src/export/markdown.js';
import { tableFixture, alertFixture, mathFixture, mermaidFixture } from '../src/fixtures/index.js';

describe('Derived Markdown Export Rules for Suggestions', () => {
  const schema = new Schema({ nodes: blogNodes, marks: allMarks });

  it('completely strips pending suggestion_insert text from derived export', () => {
    const insertMark = schema.mark(MARK_SUGGESTION_INSERT, {
      agentId: 'agent-1',
      tokenId: 'tok-1',
      ownerUserId: 'user-1',
      timestamp: 1729600000000,
      status: 'pending',
    });

    const doc = schema.nodes.doc.create({}, [
      schema.nodes.paragraph.create({}, [
        schema.text('Human text before. '),
        schema.text('Unreviewed AI insertion. ', [insertMark]),
        schema.text('Human text after.'),
      ]),
    ]);

    const exportedMarkdown = exportDerivedMarkdown(doc);
    expect(exportedMarkdown).not.toContain('Unreviewed AI insertion');
    expect(exportedMarkdown).toContain('Human text before.');
    expect(exportedMarkdown).toContain('Human text after.');
  });

  it('retains original text for pending suggestion_delete marks without strikethrough markup', () => {
    const deleteMark = schema.mark(MARK_SUGGESTION_DELETE, {
      agentId: 'agent-1',
      tokenId: 'tok-1',
      ownerUserId: 'user-1',
      timestamp: 1729600000000,
      status: 'pending',
    });

    const doc = schema.nodes.doc.create({}, [
      schema.nodes.paragraph.create({}, [
        schema.text('Original sentence with '),
        schema.text('critical text to delete', [deleteMark]),
        schema.text(' preserved for readers.'),
      ]),
    ]);

    const exportedMarkdown = exportDerivedMarkdown(doc);
    expect(exportedMarkdown).toContain('critical text to delete');
    expect(exportedMarkdown).not.toContain('~~'); // No markdown strikethrough in reader export
  });

  it('preserves accepted insertions in reader export', () => {
    const acceptedInsertMark = schema.mark(MARK_SUGGESTION_INSERT, {
      agentId: 'agent-1',
      tokenId: 'tok-1',
      ownerUserId: 'user-1',
      timestamp: 1729600000000,
      status: 'accepted',
    });

    const doc = schema.nodes.doc.create({}, [
      schema.nodes.paragraph.create({}, [
        schema.text('Accepted addition: '),
        schema.text('This text is approved.', [acceptedInsertMark]),
      ]),
    ]);

    const exportedMarkdown = exportDerivedMarkdown(doc);
    expect(exportedMarkdown).toContain('This text is approved.');
  });

  it('drops accepted deletions from reader export', () => {
    const acceptedDeleteMark = schema.mark(MARK_SUGGESTION_DELETE, {
      agentId: 'agent-1',
      tokenId: 'tok-1',
      ownerUserId: 'user-1',
      timestamp: 1729600000000,
      status: 'accepted',
    });

    const doc = schema.nodes.doc.create({}, [
      schema.nodes.paragraph.create({}, [
        schema.text('Prefix text. '),
        schema.text('This was deleted and accepted.', [acceptedDeleteMark]),
        schema.text('Suffix text.'),
      ]),
    ]);

    const exportedMarkdown = exportDerivedMarkdown(doc);
    expect(exportedMarkdown).not.toContain('This was deleted and accepted.');
    expect(exportedMarkdown).toContain('Prefix text. Suffix text.');
  });

  // -------------------------------------------------------------------------
  // Math Inline Suggestion Export Rules
  // -------------------------------------------------------------------------
  it('completely strips pending suggestion_insert on math_inline from derived export', () => {
    const insertMark = schema.mark(MARK_SUGGESTION_INSERT, {
      agentId: 'agent-1',
      tokenId: 'tok-1',
      ownerUserId: 'user-1',
      timestamp: 1729600000000,
      status: 'pending',
    });

    const doc = schema.nodes.doc.create({}, [
      schema.nodes.paragraph.create({}, [
        schema.text('Math prefix: '),
        schema.nodes.math_inline.create({ tex: 'f(x) = x^2' }, null, [insertMark]),
        schema.text(' math suffix.'),
      ]),
    ]);

    const exported = exportDerivedMarkdown(doc);
    expect(exported).not.toContain('f(x)');
    expect(exported).not.toContain('$');
    expect(exported).toBe('Math prefix:  math suffix.');
  });

  it('retains math_inline with pending suggestion_delete in derived export', () => {
    const deleteMark = schema.mark(MARK_SUGGESTION_DELETE, {
      agentId: 'agent-1',
      tokenId: 'tok-1',
      ownerUserId: 'user-1',
      timestamp: 1729600000000,
      status: 'pending',
    });

    const doc = schema.nodes.doc.create({}, [
      schema.nodes.paragraph.create({}, [
        schema.text('Formula: '),
        schema.nodes.math_inline.create({ tex: 'E=mc^2' }, null, [deleteMark]),
      ]),
    ]);

    const exported = exportDerivedMarkdown(doc);
    expect(exported).toContain('$E=mc^2$');
    expect(exported).toBe('Formula: $E=mc^2$');
  });

  it('preserves accepted insertions on math_inline in derived export', () => {
    const acceptedInsertMark = schema.mark(MARK_SUGGESTION_INSERT, {
      agentId: 'agent-1',
      tokenId: 'tok-1',
      ownerUserId: 'user-1',
      timestamp: 1729600000000,
      status: 'accepted',
    });

    const doc = schema.nodes.doc.create({}, [
      schema.nodes.paragraph.create({}, [
        schema.text('Approved formula: '),
        schema.nodes.math_inline.create({ tex: '\\lambda = \\frac{h}{p}' }, null, [acceptedInsertMark]),
      ]),
    ]);

    const exported = exportDerivedMarkdown(doc);
    expect(exported).toContain('$\\lambda = \\frac{h}{p}$');
  });

  it('drops accepted deletions on math_inline in derived export', () => {
    const acceptedDeleteMark = schema.mark(MARK_SUGGESTION_DELETE, {
      agentId: 'agent-1',
      tokenId: 'tok-1',
      ownerUserId: 'user-1',
      timestamp: 1729600000000,
      status: 'accepted',
    });

    const doc = schema.nodes.doc.create({}, [
      schema.nodes.paragraph.create({}, [
        schema.text('Formula was removed: '),
        schema.nodes.math_inline.create({ tex: 'old_eq' }, null, [acceptedDeleteMark]),
      ]),
    ]);

    const exported = exportDerivedMarkdown(doc);
    expect(exported).not.toContain('old_eq');
    expect(exported).toBe('Formula was removed: ');
  });

  // -------------------------------------------------------------------------
  // Block-Level Empty String Invariants for Suggestions
  // -------------------------------------------------------------------------
  it('exports heading with only pending insertions as empty string (no dangling #)', () => {
    const pendingInsert = schema.mark(MARK_SUGGESTION_INSERT, {
      agentId: 'agent-1',
      tokenId: 'tok-1',
      ownerUserId: 'user-1',
      timestamp: 1729600000000,
      status: 'pending',
    });

    const doc = schema.nodes.doc.create({}, [
      schema.nodes.heading.create({ level: 2 }, [
        schema.text('Unreviewed AI Heading', [pendingInsert]),
      ]),
    ]);

    const exported = exportDerivedMarkdown(doc);
    expect(exported).toBe('');
  });

  it('exports blockquote with only pending insertions as empty string (no dangling >)', () => {
    const pendingInsert = schema.mark(MARK_SUGGESTION_INSERT, {
      agentId: 'agent-1',
      tokenId: 'tok-1',
      ownerUserId: 'user-1',
      timestamp: 1729600000000,
      status: 'pending',
    });

    const doc = schema.nodes.doc.create({}, [
      schema.nodes.blockquote.create({}, [
        schema.nodes.paragraph.create({}, [
          schema.text('Pending quote line 1', [pendingInsert]),
        ]),
        schema.nodes.paragraph.create({}, [
          schema.text('Pending quote line 2', [pendingInsert]),
        ]),
      ]),
    ]);

    const exported = exportDerivedMarkdown(doc);
    expect(exported).toBe('');
  });

  it('exports lists with only pending insertions as empty string (no dangling - or 1.)', () => {
    const pendingInsert = schema.mark(MARK_SUGGESTION_INSERT, {
      agentId: 'agent-1',
      tokenId: 'tok-1',
      ownerUserId: 'user-1',
      timestamp: 1729600000000,
      status: 'pending',
    });

    const bulletDoc = schema.nodes.doc.create({}, [
      schema.nodes.bullet_list.create({}, [
        schema.nodes.list_item.create({}, [
          schema.nodes.paragraph.create({}, [
            schema.text('Pending item', [pendingInsert]),
          ]),
        ]),
      ]),
    ]);
    expect(exportDerivedMarkdown(bulletDoc)).toBe('');

    const orderedDoc = schema.nodes.doc.create({}, [
      schema.nodes.ordered_list.create({ order: 1 }, [
        schema.nodes.list_item.create({}, [
          schema.nodes.paragraph.create({}, [
            schema.text('Pending ordered item', [pendingInsert]),
          ]),
        ]),
      ]),
    ]);
    expect(exportDerivedMarkdown(orderedDoc)).toBe('');
  });

  it('omits pending headings in mixed document without creating extra blank lines or orphan tokens', () => {
    const pendingInsert = schema.mark(MARK_SUGGESTION_INSERT, {
      agentId: 'agent-1',
      tokenId: 'tok-1',
      ownerUserId: 'user-1',
      timestamp: 1729600000000,
      status: 'pending',
    });

    const doc = schema.nodes.doc.create({}, [
      schema.nodes.heading.create({ level: 1 }, [schema.text('Approved Title')]),
      schema.nodes.heading.create({ level: 2 }, [
        schema.text('Unreviewed Subheading', [pendingInsert]),
      ]),
      schema.nodes.paragraph.create({}, [schema.text('Approved paragraph content.')]),
    ]);

    const exported = exportDerivedMarkdown(doc);
    expect(exported).toBe('# Approved Title\n\nApproved paragraph content.');
  });

  // -------------------------------------------------------------------------
  // Raw JSON AST Input Normalization via Canonical Fixtures
  // -------------------------------------------------------------------------
  describe('Raw JSON AST Input Normalization via Canonical Fixtures', () => {
    it('serializes tableFixture (raw JSON) into complete GFM markdown table', () => {
      const exported = exportDerivedMarkdown(tableFixture);
      expect(exported).toContain('| Feature | Status | Operations |');
      expect(exported).toContain('| --- | --- | --- |');
      expect(exported).toContain('| CRDT Convergence | **VERIFIED** | 10,000 |');
    });

    it('serializes alertFixture (raw JSON) into GitHub alert markdown', () => {
      const exported = exportDerivedMarkdown(alertFixture);
      expect(exported).toContain('> [!WARNING]');
      expect(exported).toContain('Do not bypass the internal Agent Gateway.');
      expect(exported).toContain('- Direct DB writes cause split-brain state.');
    });

    it('serializes mathFixture (raw JSON) into inline and display math equations', () => {
      const exported = exportDerivedMarkdown(mathFixture);
      expect(exported).toContain('$E = mc^2$');
      expect(exported).toContain('$$\n\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n$$');
    });

    it('serializes mermaidFixture (raw JSON) into fenced Mermaid diagram block', () => {
      const exported = exportDerivedMarkdown(mermaidFixture);
      expect(exported).toContain('```mermaid');
      expect(exported).toContain('flowchart TD');
    });
  });
});
