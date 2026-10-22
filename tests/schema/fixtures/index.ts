import {
  tableFixture,
  alertFixture,
  mathFixture,
  mermaidFixture,
  codeFixture,
  canonicalFixtures,
  ProseMirrorDocJSON,
} from '@enterprise-blogger/shared';

export { tableFixture, alertFixture, mathFixture, mermaidFixture, codeFixture, canonicalFixtures };

/**
 * Empty document fixture
 */
export const emptyDocFixture: ProseMirrorDocJSON = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
    },
  ],
};

/**
 * Maximum section size fixture (stress testing 100KB+ text block)
 */
export const largeSectionFixture: ProseMirrorDocJSON = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Large Enterprise Architecture Document' }],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Enterprise Blogger CRDT convergence engine stress test payload. '.repeat(1500),
        },
      ],
    },
  ],
};

/**
 * Complex table with nested formatting and alignments
 */
export const complexTableFixture: ProseMirrorDocJSON = {
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
              attrs: { align: 'left', colspan: 1, rowspan: 1, colwidth: null },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Module' }] }],
            },
            {
              type: 'table_header',
              attrs: { align: 'center', colspan: 1, rowspan: 1, colwidth: null },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'CRDT Role' }] }],
            },
            {
              type: 'table_header',
              attrs: { align: 'right', colspan: 1, rowspan: 1, colwidth: null },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Formula / State' }] }],
            },
          ],
        },
        {
          type: 'table_row',
          content: [
            {
              type: 'table_cell',
              attrs: { align: 'left', colspan: 1, rowspan: 1, colwidth: null },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hocuspocus Server' }] }],
            },
            {
              type: 'table_cell',
              attrs: { align: 'center', colspan: 1, rowspan: 1, colwidth: null },
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'State Authority', marks: [{ type: 'strong' }] },
                  ],
                },
              ],
            },
            {
              type: 'table_cell',
              attrs: { align: 'right', colspan: 1, rowspan: 1, colwidth: null },
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Bytea: ' },
                    { type: 'math_inline', attrs: { tex: '\\mathcal{O}(N)' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/**
 * Fixture combining agent suggestions inside table cells
 */
export const tableWithSuggestionsFixture: ProseMirrorDocJSON = {
  type: 'doc',
  content: [
    {
      type: 'table',
      content: [
        {
          type: 'table_row',
          content: [
            {
              type: 'table_cell',
              attrs: { align: 'left', colspan: 1, rowspan: 1, colwidth: null },
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Base cell ' },
                    {
                      type: 'text',
                      text: 'proposed revision',
                      marks: [
                        {
                          type: 'suggestion_insert',
                          attrs: {
                            id: 'sug-tbl-1',
                            agentId: 'agent:table-fixer',
                            tokenId: 'tok-tbl-1',
                            ownerUserId: 'user:lead',
                            timestamp: 1729612800000,
                            status: 'pending',
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
