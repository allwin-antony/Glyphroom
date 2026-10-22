/**
 * Enterprise Blogger 2.0 — Schema Round-Trip Test Suite (Tier 1: Feature Coverage)
 * Validates >=5 test cases per schema feature: GFM tables, alerts, KaTeX math, Mermaid diagrams, fenced code blocks.
 * Asserts lossless ProseMirror JSON and Yjs CRDT round-tripping.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { prosemirrorJSONToYDoc, yDocToProsemirror } from 'y-prosemirror';
import {
  blogSchema,
  nodeFromJSON,
  nodeToJSON,
  validateDocumentJSON,
  tableFixture,
  alertFixture,
  mathFixture,
  mermaidFixture,
  codeFixture,
  ProseMirrorDocJSON,
} from '@enterprise-blogger/shared';

function verifyCRDTRoundTrip(fixture: ProseMirrorDocJSON): void {
  const originalDoc = nodeFromJSON(blogSchema, fixture);
  const ydoc1 = prosemirrorJSONToYDoc(blogSchema, fixture);
  const ydoc2 = new Y.Doc();

  // Exchange full state update
  const update = Y.encodeStateAsUpdate(ydoc1);
  Y.applyUpdate(ydoc2, update);

  const restoredDoc = yDocToProsemirror(blogSchema, ydoc2);
  expect(restoredDoc.eq(originalDoc)).toBe(true);

  ydoc1.destroy();
  ydoc2.destroy();
}

describe('Tier 1: Schema Round-Trip Suite', () => {
  describe('Feature 1: GFM Tables (>= 5 cases)', () => {
    it('1.1 verifies canonical 2x3 table with headers and alignments', () => {
      const doc = nodeFromJSON(blogSchema, tableFixture);
      expect(doc.type.name).toBe('doc');
      const table = doc.firstChild!;
      expect(table.type.name).toBe('table');
      expect(table.childCount).toBe(2);

      const serialized = nodeToJSON(doc);
      expect(serialized).toEqual(tableFixture);
      verifyCRDTRoundTrip(tableFixture);
    });

    it('1.2 verifies table with colspan and rowspan attributes', () => {
      const fixture: ProseMirrorDocJSON = {
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
                    attrs: { align: 'center', colspan: 2, rowspan: 1, colwidth: null },
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Merged Header' }] }],
                  },
                ],
              },
              {
                type: 'table_row',
                content: [
                  {
                    type: 'table_cell',
                    attrs: { align: 'left', colspan: 1, rowspan: 2, colwidth: null },
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Spanned Row' }] }],
                  },
                  {
                    type: 'table_cell',
                    attrs: { align: 'right', colspan: 1, rowspan: 1, colwidth: null },
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell R1' }] }],
                  },
                ],
              },
            ],
          },
        ],
      };
      const doc = nodeFromJSON(blogSchema, fixture);
      expect(nodeToJSON(doc)).toEqual(fixture);
      verifyCRDTRoundTrip(fixture);
    });

    it('1.3 verifies table with empty cells', () => {
      const fixture: ProseMirrorDocJSON = {
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
                    content: [{ type: 'paragraph' }],
                  },
                  {
                    type: 'table_header',
                    attrs: { align: null, colspan: 1, rowspan: 1, colwidth: null },
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Header' }] }],
                  },
                ],
              },
            ],
          },
        ],
      };
      const doc = nodeFromJSON(blogSchema, fixture);
      expect(nodeToJSON(doc)).toEqual(fixture);
      verifyCRDTRoundTrip(fixture);
    });

    it('1.4 verifies table cell containing multiple marks (strong, em, code)', () => {
      const fixture: ProseMirrorDocJSON = {
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
                          { type: 'text', text: 'Bold Code', marks: [{ type: 'strong' }, { type: 'code' }] },
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
      const doc = nodeFromJSON(blogSchema, fixture);
      expect(nodeToJSON(doc)).toEqual(fixture);
      verifyCRDTRoundTrip(fixture);
    });

    it('1.5 verifies large 10x4 rectangular grid CRDT lossless convergence', () => {
      const rows = [];
      for (let r = 0; r < 10; r++) {
        const cells = [];
        for (let c = 0; c < 4; c++) {
          cells.push({
            type: r === 0 ? 'table_header' : 'table_cell',
            attrs: { align: 'left', colspan: 1, rowspan: 1, colwidth: null },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: `R${r}C${c}` }] }],
          });
        }
        rows.push({ type: 'table_row', content: cells });
      }
      const fixture: ProseMirrorDocJSON = {
        type: 'doc',
        content: [{ type: 'table', content: rows }],
      };
      const doc = nodeFromJSON(blogSchema, fixture);
      expect(nodeToJSON(doc)).toEqual(fixture);
      verifyCRDTRoundTrip(fixture);
    });
  });

  describe('Feature 2: GitHub-style Alerts (>= 5 cases)', () => {
    it('2.1 verifies canonical WARNING alert with nested list', () => {
      const doc = nodeFromJSON(blogSchema, alertFixture);
      expect(doc.firstChild!.type.name).toBe('callout_alert');
      expect(doc.firstChild!.attrs.alertType).toBe('WARNING');
      expect(nodeToJSON(doc)).toEqual(alertFixture);
      verifyCRDTRoundTrip(alertFixture);
    });

    it('2.2 verifies NOTE alert with simple text paragraph', () => {
      const fixture: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'callout_alert',
            attrs: { alertType: 'NOTE' },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Informational note for developers.' }],
              },
            ],
          },
        ],
      };
      const doc = nodeFromJSON(blogSchema, fixture);
      expect(nodeToJSON(doc)).toEqual(fixture);
      verifyCRDTRoundTrip(fixture);
    });

    it('2.3 verifies TIP, IMPORTANT, and CAUTION alert variants', () => {
      const types = ['TIP', 'IMPORTANT', 'CAUTION'] as const;
      for (const alertType of types) {
        const fixture: ProseMirrorDocJSON = {
          type: 'doc',
          content: [
            {
              type: 'callout_alert',
              attrs: { alertType },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: `This is a ${alertType} alert.` }],
                },
              ],
            },
          ],
        };
        const doc = nodeFromJSON(blogSchema, fixture);
        expect(doc.firstChild!.attrs.alertType).toBe(alertType);
        expect(nodeToJSON(doc)).toEqual(fixture);
        verifyCRDTRoundTrip(fixture);
      }
    });

    it('2.4 verifies alert with multiple paragraphs and formatted text', () => {
      const fixture: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'callout_alert',
            attrs: { alertType: 'IMPORTANT' },
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'First paragraph with ' },
                  { type: 'text', text: 'strong emphasis', marks: [{ type: 'strong' }] },
                ],
              },
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Second paragraph with details.' }],
              },
            ],
          },
        ],
      };
      const doc = nodeFromJSON(blogSchema, fixture);
      expect(doc.firstChild!.childCount).toBe(2);
      expect(nodeToJSON(doc)).toEqual(fixture);
      verifyCRDTRoundTrip(fixture);
    });

    it('2.5 verifies alert containing fenced code block', () => {
      const fixture: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'callout_alert',
            attrs: { alertType: 'TIP' },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Use this helper command:' }],
              },
              {
                type: 'code_block',
                attrs: { language: 'bash' },
                content: [{ type: 'text', text: 'pnpm --filter @enterprise-blogger/tests test' }],
              },
            ],
          },
        ],
      };
      const doc = nodeFromJSON(blogSchema, fixture);
      expect(nodeToJSON(doc)).toEqual(fixture);
      verifyCRDTRoundTrip(fixture);
    });
  });

  describe('Feature 3: KaTeX Math (>= 5 cases)', () => {
    it('3.1 verifies canonical math fixture (inline and display math)', () => {
      const doc = nodeFromJSON(blogSchema, mathFixture);
      expect(doc.childCount).toBe(2);
      expect(nodeToJSON(doc)).toEqual(mathFixture);
      verifyCRDTRoundTrip(mathFixture);
    });

    it('3.2 verifies inline math formula preservation', () => {
      const fixture: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Euler identity: ' },
              { type: 'math_inline', attrs: { tex: 'e^{i\\pi} + 1 = 0' } },
            ],
          },
        ],
      };
      const doc = nodeFromJSON(blogSchema, fixture);
      expect(nodeToJSON(doc)).toEqual(fixture);
      verifyCRDTRoundTrip(fixture);
    });

    it('3.3 verifies complex display math matrix equation', () => {
      const tex = '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}';
      const fixture: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'math_display',
            attrs: { tex },
          },
        ],
      };
      const doc = nodeFromJSON(blogSchema, fixture);
      expect(doc.firstChild!.attrs.tex).toBe(tex);
      expect(nodeToJSON(doc)).toEqual(fixture);
      verifyCRDTRoundTrip(fixture);
    });

    it('3.4 verifies adjacent math expressions with punctuation', () => {
      const fixture: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'math_inline', attrs: { tex: 'x_1' } },
              { type: 'text', text: ', ' },
              { type: 'math_inline', attrs: { tex: 'x_2' } },
              { type: 'text', text: ', and ' },
              { type: 'math_inline', attrs: { tex: 'x_n' } },
            ],
          },
        ],
      };
      const doc = nodeFromJSON(blogSchema, fixture);
      expect(nodeToJSON(doc)).toEqual(fixture);
      verifyCRDTRoundTrip(fixture);
    });

    it('3.5 verifies math display block with empty LaTeX string', () => {
      const fixture: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'math_display',
            attrs: { tex: '' },
          },
        ],
      };
      const doc = nodeFromJSON(blogSchema, fixture);
      expect(doc.firstChild!.attrs.tex).toBe('');
      expect(nodeToJSON(doc)).toEqual(fixture);
      verifyCRDTRoundTrip(fixture);
    });
  });

  describe('Feature 4: Mermaid Diagrams (>= 5 cases)', () => {
    it('4.1 verifies canonical mermaid flowchart fixture with strict securityLevel', () => {
      const doc = nodeFromJSON(blogSchema, mermaidFixture);
      const mermaid = doc.firstChild!;
      expect(mermaid.type.name).toBe('mermaid_block');
      expect(mermaid.attrs.securityLevel).toBe('strict');
      expect(nodeToJSON(doc)).toEqual(mermaidFixture);
      verifyCRDTRoundTrip(mermaidFixture);
    });

    it('4.2 verifies mermaid sequence diagram', () => {
      const diagram = 'sequenceDiagram\n  autonumber\n  Alice->>Bob: Hello Bob\n  Bob-->>Alice: Hi Alice';
      const fixture: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'mermaid_block',
            attrs: { securityLevel: 'strict' },
            content: [{ type: 'text', text: diagram }],
          },
        ],
      };
      const doc = nodeFromJSON(blogSchema, fixture);
      expect(doc.firstChild!.textContent).toBe(diagram);
      expect(nodeToJSON(doc)).toEqual(fixture);
      verifyCRDTRoundTrip(fixture);
    });

    it('4.3 verifies mermaid class diagram with relationship syntax', () => {
      const diagram = 'classDiagram\n  class YDoc {\n    +Map share\n    +Array clientID\n  }';
      const fixture: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'mermaid_block',
            attrs: { securityLevel: 'strict' },
            content: [{ type: 'text', text: diagram }],
          },
        ],
      };
      const doc = nodeFromJSON(blogSchema, fixture);
      expect(nodeToJSON(doc)).toEqual(fixture);
      verifyCRDTRoundTrip(fixture);
    });

    it('4.4 verifies mermaid state diagram', () => {
      const diagram = 'stateDiagram-v2\n  [*] --> Disconnected\n  Disconnected --> Connected: sync\n  Connected --> [*]';
      const fixture: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'mermaid_block',
            attrs: { securityLevel: 'strict' },
            content: [{ type: 'text', text: diagram }],
          },
        ],
      };
      const doc = nodeFromJSON(blogSchema, fixture);
      expect(nodeToJSON(doc)).toEqual(fixture);
      verifyCRDTRoundTrip(fixture);
    });

    it('4.5 verifies default securityLevel is strict when unspecified', () => {
      const fixture: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'mermaid_block',
            attrs: {},
            content: [{ type: 'text', text: 'graph LR\n  A --> B' }],
          },
        ],
      };
      const doc = nodeFromJSON(blogSchema, fixture);
      expect(doc.firstChild!.attrs.securityLevel).toBe('strict');
      verifyCRDTRoundTrip(fixture);
    });
  });

  describe('Feature 5: Fenced Code Blocks (>= 5 cases)', () => {
    it('5.1 verifies canonical TypeScript code block', () => {
      const doc = nodeFromJSON(blogSchema, codeFixture);
      const code = doc.firstChild!;
      expect(code.type.name).toBe('code_block');
      expect(code.attrs.language).toBe('typescript');
      expect(nodeToJSON(doc)).toEqual(codeFixture);
      verifyCRDTRoundTrip(codeFixture);
    });

    it('5.2 verifies code block with multiline indentation preservation', () => {
      const code = 'def compute_state():\n    val = 42\n    if val > 0:\n        return True\n    return False';
      const fixture: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'code_block',
            attrs: { language: 'python' },
            content: [{ type: 'text', text: code }],
          },
        ],
      };
      const doc = nodeFromJSON(blogSchema, fixture);
      expect(doc.firstChild!.textContent).toBe(code);
      expect(nodeToJSON(doc)).toEqual(fixture);
      verifyCRDTRoundTrip(fixture);
    });

    it('5.3 verifies code block with empty language attribute', () => {
      const fixture: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'code_block',
            attrs: { language: '' },
            content: [{ type: 'text', text: 'plain text in code block' }],
          },
        ],
      };
      const doc = nodeFromJSON(blogSchema, fixture);
      expect(doc.firstChild!.attrs.language).toBe('');
      expect(nodeToJSON(doc)).toEqual(fixture);
      verifyCRDTRoundTrip(fixture);
    });

    it('5.4 verifies code block with special characters and HTML escapes', () => {
      const code = '<div id="app" data-testid=\'root\'>&quot;Hello &amp; World&quot;</div>';
      const fixture: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'code_block',
            attrs: { language: 'html' },
            content: [{ type: 'text', text: code }],
          },
        ],
      };
      const doc = nodeFromJSON(blogSchema, fixture);
      expect(doc.firstChild!.textContent).toBe(code);
      expect(nodeToJSON(doc)).toEqual(fixture);
      verifyCRDTRoundTrip(fixture);
    });

    it('5.5 verifies empty code block serialization', () => {
      const fixture: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'code_block',
            attrs: { language: 'json' },
          },
        ],
      };
      const doc = nodeFromJSON(blogSchema, fixture);
      expect(doc.firstChild!.textContent).toBe('');
      expect(nodeToJSON(doc)).toEqual(fixture);
      verifyCRDTRoundTrip(fixture);
    });
  });
});
