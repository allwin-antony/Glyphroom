/**
 * Enterprise Blogger 2.0 — Suggestion Export Rules Test Suite (Tier 1: Feature Coverage)
 * Validates the derived Markdown exporter:
 * - Pending suggestion-insert marks are stripped from reader/derived Markdown exports.
 * - Pending suggestion-delete marks retain original text.
 * - Accepted insertions are retained as normal text.
 * - Accepted deletions are stripped completely.
 * - Blocks containing only pending insertions export cleanly without dangling syntax prefixes.
 */

import { describe, it, expect } from 'vitest';
import {
  exportDerivedMarkdown,
  blogSchema,
  nodeFromJSON,
  ProseMirrorDocJSON,
  MARK_SUGGESTION_INSERT,
  MARK_SUGGESTION_DELETE,
} from '@enterprise-blogger/shared';

describe('Tier 1: Suggestion Export Rules Suite', () => {
  describe('Pending Suggestion Rules (>= 5 cases)', () => {
    it('1.1 strips pending suggestion-insert marks completely from inline text', () => {
      const docJson: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'This is established text. ' },
              {
                type: 'text',
                text: 'This is an unreviewed AI suggestion.',
                marks: [
                  {
                    type: MARK_SUGGESTION_INSERT,
                    attrs: {
                      id: 'sug-1',
                      agentId: 'agent:1',
                      tokenId: 'tok-1',
                      ownerUserId: 'u1',
                      timestamp: 1000,
                      status: 'pending',
                    },
                  },
                ],
              },
              { type: 'text', text: ' Final text.' },
            ],
          },
        ],
      };
      const md = exportDerivedMarkdown(docJson);
      expect(md).toBe('This is established text.  Final text.');
      expect(md).not.toContain('unreviewed AI suggestion');
    });

    it('1.2 retains original text for pending suggestion-delete marks', () => {
      const docJson: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Keep this. ' },
              {
                type: 'text',
                text: 'Text proposed for deletion.',
                marks: [
                  {
                    type: MARK_SUGGESTION_DELETE,
                    attrs: {
                      id: 'sug-2',
                      agentId: 'agent:1',
                      tokenId: 'tok-1',
                      ownerUserId: 'u1',
                      timestamp: 1000,
                      status: 'pending',
                    },
                  },
                ],
              },
              { type: 'text', text: ' End.' },
            ],
          },
        ],
      };
      const md = exportDerivedMarkdown(docJson);
      expect(md).toBe('Keep this. Text proposed for deletion. End.');
      expect(md).toContain('Text proposed for deletion');
    });

    it('1.3 eliminates dangling heading prefix (# ) when heading contains only pending insertion', () => {
      const docJson: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [
              {
                type: 'text',
                text: 'Proposed AI Section Heading',
                marks: [{ type: MARK_SUGGESTION_INSERT, attrs: { status: 'pending' } }],
              },
            ],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Subsequent normal paragraph.' }],
          },
        ],
      };
      const md = exportDerivedMarkdown(docJson);
      expect(md).toBe('Subsequent normal paragraph.');
      expect(md).not.toContain('##');
    });

    it('1.4 eliminates dangling blockquote prefix (> ) when blockquote contains only pending insertion', () => {
      const docJson: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'blockquote',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Suggested quote',
                    marks: [{ type: MARK_SUGGESTION_INSERT, attrs: { status: 'pending' } }],
                  },
                ],
              },
            ],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Outer content.' }],
          },
        ],
      };
      const md = exportDerivedMarkdown(docJson);
      expect(md).toBe('Outer content.');
      expect(md).not.toContain('>');
    });

    it('1.5 eliminates dangling alert header (> [!NOTE]) when alert contains only pending insertion', () => {
      const docJson: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'callout_alert',
            attrs: { alertType: 'NOTE' },
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Unreviewed alert text',
                    marks: [{ type: MARK_SUGGESTION_INSERT, attrs: { status: 'pending' } }],
                  },
                ],
              },
            ],
          },
        ],
      };
      const md = exportDerivedMarkdown(docJson);
      expect(md).toBe('');
      expect(md).not.toContain('> [!NOTE]');
    });
  });

  describe('Accepted & Rejected Suggestion Rules (>= 5 cases)', () => {
    it('2.1 retains accepted suggestion-insert as regular text', () => {
      const docJson: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Approved content addition.',
                marks: [{ type: MARK_SUGGESTION_INSERT, attrs: { status: 'accepted' } }],
              },
            ],
          },
        ],
      };
      const md = exportDerivedMarkdown(docJson);
      expect(md).toBe('Approved content addition.');
    });

    it('2.2 strips accepted suggestion-delete completely', () => {
      const docJson: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Before delete. ' },
              {
                type: 'text',
                text: 'Deleted text.',
                marks: [{ type: MARK_SUGGESTION_DELETE, attrs: { status: 'accepted' } }],
              },
              { type: 'text', text: 'After delete.' },
            ],
          },
        ],
      };
      const md = exportDerivedMarkdown(docJson);
      expect(md).toBe('Before delete. After delete.');
      expect(md).not.toContain('Deleted text');
    });

    it('2.3 strips rejected suggestion-insert completely', () => {
      const docJson: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Rejected proposal.',
                marks: [{ type: MARK_SUGGESTION_INSERT, attrs: { status: 'rejected' } }],
              },
              { type: 'text', text: 'Surviving sentence.' },
            ],
          },
        ],
      };
      const md = exportDerivedMarkdown(docJson);
      expect(md).toBe('Surviving sentence.');
      expect(md).not.toContain('Rejected proposal');
    });

    it('2.4 retains rejected suggestion-delete text (rejection means do not delete)', () => {
      const docJson: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Original text defended from deletion.',
                marks: [{ type: MARK_SUGGESTION_DELETE, attrs: { status: 'rejected' } }],
              },
            ],
          },
        ],
      };
      const md = exportDerivedMarkdown(docJson);
      expect(md).toBe('Original text defended from deletion.');
    });

    it('2.5 verifies mixed sequence of accepted, pending, and rejected suggestions in one paragraph', () => {
      const docJson: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Alpha ' },
              { type: 'text', text: '[Accepted Ins] ', marks: [{ type: MARK_SUGGESTION_INSERT, attrs: { status: 'accepted' } }] },
              { type: 'text', text: '[Pending Ins] ', marks: [{ type: MARK_SUGGESTION_INSERT, attrs: { status: 'pending' } }] },
              { type: 'text', text: '[Pending Del] ', marks: [{ type: MARK_SUGGESTION_DELETE, attrs: { status: 'pending' } }] },
              { type: 'text', text: '[Accepted Del] ', marks: [{ type: MARK_SUGGESTION_DELETE, attrs: { status: 'accepted' } }] },
              { type: 'text', text: 'Omega.' },
            ],
          },
        ],
      };
      const md = exportDerivedMarkdown(docJson);
      expect(md).toBe('Alpha [Accepted Ins] [Pending Del] Omega.');
      expect(md).not.toContain('[Pending Ins]');
      expect(md).not.toContain('[Accepted Del]');
    });
  });

  describe('Complex Blocks with Suggestions (>= 5 cases)', () => {
    it('3.1 strips pending insertions inside table cells while preserving cell boundaries', () => {
      const docJson: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'table',
            content: [
              {
                type: 'table_row',
                content: [
                  {
                    type: 'table_header',
                    attrs: { align: null, colspan: 1, rowspan: 1, colwidth: null },
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col 1' }] }],
                  },
                  {
                    type: 'table_header',
                    attrs: { align: null, colspan: 1, rowspan: 1, colwidth: null },
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col 2' }] }],
                  },
                ],
              },
              {
                type: 'table_row',
                content: [
                  {
                    type: 'table_cell',
                    attrs: { align: null, colspan: 1, rowspan: 1, colwidth: null },
                    content: [
                      {
                        type: 'paragraph',
                        content: [
                          { type: 'text', text: 'Existing ' },
                          { type: 'text', text: 'Proposed', marks: [{ type: MARK_SUGGESTION_INSERT, attrs: { status: 'pending' } }] },
                        ],
                      },
                    ],
                  },
                  {
                    type: 'table_cell',
                    attrs: { align: null, colspan: 1, rowspan: 1, colwidth: null },
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Val 2' }] }],
                  },
                ],
              },
            ],
          },
        ],
      };
      const md = exportDerivedMarkdown(docJson);
      expect(md).toContain('| Col 1 | Col 2 |');
      expect(md).toContain('| Existing | Val 2 |');
      expect(md).not.toContain('Proposed');
    });

    it('3.2 evaluates marks on math_inline before export', () => {
      const docJson: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Equation: ' },
              {
                type: 'math_inline',
                attrs: { tex: 'E=mc^2' },
                marks: [{ type: MARK_SUGGESTION_INSERT, attrs: { status: 'pending' } }],
              },
              { type: 'text', text: ' verified.' },
            ],
          },
        ],
      };
      const md = exportDerivedMarkdown(docJson);
      expect(md).toBe('Equation:  verified.');
      expect(md).not.toContain('E=mc^2');
    });

    it('3.3 exports math_inline with accepted insertion', () => {
      const docJson: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Formula: ' },
              {
                type: 'math_inline',
                attrs: { tex: 'a^2 + b^2 = c^2' },
                marks: [{ type: MARK_SUGGESTION_INSERT, attrs: { status: 'accepted' } }],
              },
            ],
          },
        ],
      };
      const md = exportDerivedMarkdown(docJson);
      expect(md).toBe('Formula: $a^2 + b^2 = c^2$');
    });

    it('3.4 exports bullet list eliminating empty items from pending insertions', () => {
      const docJson: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'bullet_list',
            content: [
              {
                type: 'list_item',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First item' }] }],
              },
              {
                type: 'list_item',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Pending item', marks: [{ type: MARK_SUGGESTION_INSERT, attrs: { status: 'pending' } }] }],
                  },
                ],
              },
              {
                type: 'list_item',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Third item' }] }],
              },
            ],
          },
        ],
      };
      const md = exportDerivedMarkdown(docJson);
      expect(md).toContain('- First item');
      expect(md).toContain('- Third item');
      expect(md).not.toContain('Pending item');
    });

    it('3.5 exports standard inline formatting alongside suggestions cleanly', () => {
      const docJson: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Formatted: ' },
              { type: 'text', text: 'Bold', marks: [{ type: 'strong' }] },
              { type: 'text', text: ' and ' },
              { type: 'text', text: 'Italic', marks: [{ type: 'em' }] },
              { type: 'text', text: ' and ' },
              { type: 'text', text: 'Code', marks: [{ type: 'code' }] },
              { type: 'text', text: ' [Proposed]', marks: [{ type: MARK_SUGGESTION_INSERT, attrs: { status: 'pending' } }] },
            ],
          },
        ],
      };
      const md = exportDerivedMarkdown(docJson);
      expect(md).toBe('Formatted: **Bold** and *Italic* and `Code`');
    });
  });
});
