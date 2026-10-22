import { ProseMirrorDocJSON } from '../schema/json.js';

/**
 * 1. GFM Table Fixture
 * Rectangular grid with alignments and formatting marks inside cells.
 */
export const tableFixture: ProseMirrorDocJSON = {
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
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Feature' }] }],
            },
            {
              type: 'table_header',
              attrs: { align: 'center', colspan: 1, rowspan: 1, colwidth: null },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Status' }] }],
            },
            {
              type: 'table_header',
              attrs: { align: 'right', colspan: 1, rowspan: 1, colwidth: null },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Operations' }] }],
            },
          ],
        },
        {
          type: 'table_row',
          content: [
            {
              type: 'table_cell',
              attrs: { align: 'left', colspan: 1, rowspan: 1, colwidth: null },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'CRDT Convergence' }] }],
            },
            {
              type: 'table_cell',
              attrs: { align: 'center', colspan: 1, rowspan: 1, colwidth: null },
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'VERIFIED', marks: [{ type: 'strong' }] },
                  ],
                },
              ],
            },
            {
              type: 'table_cell',
              attrs: { align: 'right', colspan: 1, rowspan: 1, colwidth: null },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '10,000' }] }],
            },
          ],
        },
      ],
    },
  ],
};

/**
 * 2. GitHub Alert Fixture (Nested Content)
 * Alert with WARNING type containing a paragraph and a nested bullet list.
 */
export const alertFixture: ProseMirrorDocJSON = {
  type: 'doc',
  content: [
    {
      type: 'callout_alert',
      attrs: { alertType: 'WARNING' },
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Do not bypass the internal Agent Gateway.' },
          ],
        },
        {
          type: 'bullet_list',
          content: [
            {
              type: 'list_item',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Direct DB writes cause split-brain state.' }],
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
 * 3. KaTeX Math Fixture
 * Inline math formula and display math equation block.
 */
export const mathFixture: ProseMirrorDocJSON = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: "Einstein's energy-mass equivalence is " },
        { type: 'math_inline', attrs: { tex: 'E = mc^2' } },
        { type: 'text', text: '.' },
      ],
    },
    {
      type: 'math_display',
      attrs: { tex: '\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}' },
    },
  ],
};

/**
 * 4. Mermaid Diagram Fixture
 * Sandboxed diagram with strict security level and child text syntax.
 */
export const mermaidFixture: ProseMirrorDocJSON = {
  type: 'doc',
  content: [
    {
      type: 'mermaid_block',
      attrs: { securityLevel: 'strict' },
      content: [
        {
          type: 'text',
          text: 'flowchart TD\n  Agent -->|POST /internal/agent-gateway| Gateway\n  Gateway -->|openDirectConnection| Collab\n  Collab -->|Yjs Sync| Browser',
        },
      ],
    },
  ],
};

/**
 * 5. Fenced Code Block Fixture
 * Code block with language tag and preserved formatting.
 */
export const codeFixture: ProseMirrorDocJSON = {
  type: 'doc',
  content: [
    {
      type: 'code_block',
      attrs: { language: 'typescript' },
      content: [
        {
          type: 'text',
          text: 'export function testConvergence(): boolean {\n  return true;\n}',
        },
      ],
    },
  ],
};

export const canonicalFixtures = {
  table: tableFixture,
  alert: alertFixture,
  math: mathFixture,
  mermaid: mermaidFixture,
  code: codeFixture,
} as const;
