import { describe, it, expect } from 'vitest';
import { Schema } from 'prosemirror-model';
import { blogNodes } from '../src/schema/nodes/index.js';
import {
  allMarks,
  MARK_SUGGESTION_INSERT,
  MARK_SUGGESTION_DELETE,
} from '../src/schema/marks/index.js';
import { exportDerivedMarkdown } from '../src/export/markdown.js';

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
});
