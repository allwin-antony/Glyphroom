import { describe, it, expect } from 'vitest';
import { Schema, DOMParser, DOMSerializer } from 'prosemirror-model';
import { blogSchema } from '../src/schema/index.js';
import {
  nodeToJSON,
  nodeFromJSON,
  validateDocumentJSON,
  createEmptyDocument,
  ProseMirrorDocJSON,
} from '../src/schema/json.js';
import { validateTableGrid, normalizeTableGrid } from '../src/schema/table-grid.js';
import {
  SuggestionInsertAttrsSchema,
  SuggestionDeleteAttrsSchema,
  AttributionAttrsSchema,
  SuggestionStatusSchema,
  safeValidate,
  validateOrThrow,
} from '../src/validation/index.js';
import {
  MARK_SUGGESTION_INSERT,
  MARK_SUGGESTION_DELETE,
  MARK_ATTRIBUTION,
} from '../src/schema/marks/constants.js';
import { exportDerivedMarkdown } from '../src/export/markdown.js';

describe('Milestone M1 Adversarial Schema & Fixture Stress Test Suite', () => {
  // =========================================================================
  // TASK 1: Deeply Nested Structures & Mixed Blocks
  // =========================================================================
  describe('1. Deeply Nested Structures and Mixed Blocks', () => {
    it('supports deeply nested blockquotes (10 levels deep) and validates with doc.check()', () => {
      let currentInner = blogSchema.nodes.paragraph.create(
        null,
        blogSchema.text('Deeply nested quotation content')
      );

      // Wrap in 10 layers of blockquotes
      for (let i = 0; i < 10; i++) {
        currentInner = blogSchema.nodes.blockquote.create(null, [currentInner]);
      }

      const doc = blogSchema.nodes.doc.create(null, [currentInner]);

      // Schema content constraint verification
      expect(() => doc.check()).not.toThrow();

      // Serialization and round-trip verification
      const json = nodeToJSON(doc);
      const roundTripped = nodeFromJSON(blogSchema, json);
      expect(roundTripped.eq(doc)).toBe(true);

      const validation = validateDocumentJSON(blogSchema, json);
      expect(validation.valid).toBe(true);
    });

    it('supports 50-level nested blockquotes without stack overflow', () => {
      let currentInner = blogSchema.nodes.paragraph.create(
        null,
        blogSchema.text('Bottom of 50-deep blockquote')
      );

      for (let i = 0; i < 50; i++) {
        currentInner = blogSchema.nodes.blockquote.create(null, [currentInner]);
      }

      const doc = blogSchema.nodes.doc.create(null, [currentInner]);
      expect(() => doc.check()).not.toThrow();

      const json = nodeToJSON(doc);
      const parsed = nodeFromJSON(blogSchema, JSON.parse(JSON.stringify(json)));
      expect(parsed.eq(doc)).toBe(true);
    });

    it('supports alternating nested bullet and ordered lists (depth 6)', () => {
      // Build from bottom up:
      // level 6 (ordered list item) -> level 5 (bullet list item) -> ...
      let currentList: any = blogSchema.nodes.bullet_list.create(null, [
        blogSchema.nodes.list_item.create(null, [
          blogSchema.nodes.paragraph.create(null, blogSchema.text('Deepest list item')),
        ]),
      ]);

      for (let depth = 5; depth >= 1; depth--) {
        const itemPara = blogSchema.nodes.paragraph.create(
          null,
          blogSchema.text(`List level ${depth}`)
        );
        const listItem = blogSchema.nodes.list_item.create(null, [itemPara, currentList]);
        const listType = depth % 2 === 0 ? blogSchema.nodes.ordered_list : blogSchema.nodes.bullet_list;
        const attrs = depth % 2 === 0 ? { order: 1 } : null;
        currentList = listType.create(attrs, [listItem]);
      }

      const doc = blogSchema.nodes.doc.create(null, [currentList]);
      expect(() => doc.check()).not.toThrow();

      const json = nodeToJSON(doc);
      const roundTripped = nodeFromJSON(blogSchema, json);
      expect(roundTripped.eq(doc)).toBe(true);
      expect(validateDocumentJSON(blogSchema, json).valid).toBe(true);
    });

    it('validates mixed block nesting: callout_alert containing blockquote containing table', () => {
      const headerCell = (txt: string) =>
        blogSchema.nodes.table_header.create(
          { align: 'left', colspan: 1, rowspan: 1 },
          blogSchema.nodes.paragraph.create(null, blogSchema.text(txt))
        );
      const bodyCell = (txt: string) =>
        blogSchema.nodes.table_cell.create(
          { align: 'left', colspan: 1, rowspan: 1 },
          blogSchema.nodes.paragraph.create(null, blogSchema.text(txt))
        );

      const innerTable = blogSchema.nodes.table.create(null, [
        blogSchema.nodes.table_row.create(null, [headerCell('Col 1'), headerCell('Col 2')]),
        blogSchema.nodes.table_row.create(null, [bodyCell('Val 1'), bodyCell('Val 2')]),
      ]);

      const innerBlockquote = blogSchema.nodes.blockquote.create(null, [
        blogSchema.nodes.paragraph.create(null, blogSchema.text('Table inside quote:')),
        innerTable,
      ]);

      const alert = blogSchema.nodes.callout_alert.create(
        { alertType: 'CAUTION' },
        [
          blogSchema.nodes.paragraph.create(null, blogSchema.text('Alert heading:')),
          innerBlockquote,
        ]
      );

      const doc = blogSchema.nodes.doc.create(null, [alert]);
      expect(() => doc.check()).not.toThrow();

      const json = nodeToJSON(doc);
      const roundTripped = nodeFromJSON(blogSchema, json);
      expect(roundTripped.eq(doc)).toBe(true);
    });

    it('rejects illegal block nesting: table inside table_cell violates content: "paragraph+"', () => {
      const illegalCellContent = {
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
                    content: [
                      {
                        type: 'table',
                        content: [
                          {
                            type: 'table_row',
                            content: [
                              {
                                type: 'table_cell',
                                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested' }] }],
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

      const result = validateDocumentJSON(blogSchema, illegalCellContent);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects illegal block nesting: list_item without leading paragraph violates content: "paragraph block*"', () => {
      const illegalListItem = {
        type: 'doc',
        content: [
          {
            type: 'bullet_list',
            content: [
              {
                type: 'list_item',
                content: [
                  {
                    type: 'bullet_list',
                    content: [
                      {
                        type: 'list_item',
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item' }] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const result = validateDocumentJSON(blogSchema, illegalListItem);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects illegal content inside code_block (block nodes not allowed in content: "text*")', () => {
      const illegalCodeBlock = {
        type: 'doc',
        content: [
          {
            type: 'code_block',
            attrs: { language: 'js' },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'illegal paragraph in code' }],
              },
            ],
          },
        ],
      };

      const result = validateDocumentJSON(blogSchema, illegalCodeBlock);
      expect(result.valid).toBe(false);
    });
  });

  // =========================================================================
  // TASK 2: Ragged / Malformed Tables (validateTableGrid & normalizeTableGrid)
  // =========================================================================
  describe('2. Ragged & Malformed Tables Testing', () => {
    const makeHeaderCell = (txt: string, colspan = 1, rowspan = 1, align: any = null) =>
      blogSchema.nodes.table_header.create(
        { align, colspan, rowspan, colwidth: null },
        blogSchema.nodes.paragraph.create(null, blogSchema.text(txt))
      );

    const makeBodyCell = (txt: string, colspan = 1, rowspan = 1, align: any = null) =>
      blogSchema.nodes.table_cell.create(
        { align, colspan, rowspan, colwidth: null },
        blogSchema.nodes.paragraph.create(null, blogSchema.text(txt))
      );

    it('handles empty table (0 rows): validateTableGrid reports invalid', () => {
      const emptyTable = blogSchema.nodes.table.create(null, []);
      const validation = validateTableGrid(emptyTable);
      expect(validation.valid).toBe(false);
      expect(validation.rowCount).toBe(0);
      expect(validation.colCount).toBe(0);
      expect(validation.errors).toContain('Table has no rows');

      // normalizeTableGrid behavior check on empty table
      const normalized = normalizeTableGrid(emptyTable, blogSchema);
      expect(normalized.childCount).toBe(0);
    });

    it('handles table with 1 row having 0 columns: detects zero columns and normalizes with padded cell', () => {
      const emptyRow = blogSchema.nodes.table_row.create(null, []);
      const tableWithEmptyRow = blogSchema.nodes.table.create(null, [emptyRow]);

      const validation = validateTableGrid(tableWithEmptyRow);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Header row has zero columns');

      const normalized = normalizeTableGrid(tableWithEmptyRow, blogSchema);
      const normValidation = validateTableGrid(normalized);
      expect(normValidation.valid).toBe(true);
      expect(normValidation.rowCount).toBe(1);
      expect(normValidation.colCount).toBe(1);
      expect(normalized.child(0).child(0).type.name).toBe('table_header');
    });

    it('handles unequal row lengths where header row has 1 column and body row has 4 columns', () => {
      const raggedTable = blogSchema.nodes.table.create(null, [
        blogSchema.nodes.table_row.create(null, [makeHeaderCell('H1')]),
        blogSchema.nodes.table_row.create(null, [
          makeBodyCell('B1'),
          makeBodyCell('B2'),
          makeBodyCell('B3'),
          makeBodyCell('B4'),
        ]),
      ]);

      const validation = validateTableGrid(raggedTable);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('rectangular grid violation'))).toBe(true);

      const normalized = normalizeTableGrid(raggedTable, blogSchema);
      const normValidation = validateTableGrid(normalized);

      expect(normValidation.valid).toBe(true);
      expect(normValidation.rowCount).toBe(2);
      expect(normValidation.colCount).toBe(4);

      // Verify row 0 was padded with 3 table_headers
      const headerRow = normalized.child(0);
      expect(headerRow.childCount).toBe(4);
      expect(headerRow.child(0).type.name).toBe('table_header');
      expect(headerRow.child(1).type.name).toBe('table_header');
      expect(headerRow.child(2).type.name).toBe('table_header');
      expect(headerRow.child(3).type.name).toBe('table_header');
    });

    it('handles unequal row lengths where middle row is shorter than first and last rows', () => {
      const raggedTable = blogSchema.nodes.table.create(null, [
        blogSchema.nodes.table_row.create(null, [
          makeHeaderCell('H1'),
          makeHeaderCell('H2'),
          makeHeaderCell('H3'),
        ]),
        blogSchema.nodes.table_row.create(null, [makeBodyCell('B1')]), // only 1 cell
        blogSchema.nodes.table_row.create(null, [
          makeBodyCell('C1'),
          makeBodyCell('C2'),
          makeBodyCell('C3'),
        ]),
      ]);

      const normalized = normalizeTableGrid(raggedTable, blogSchema);
      const normValidation = validateTableGrid(normalized);

      expect(normValidation.valid).toBe(true);
      expect(normValidation.rowCount).toBe(3);
      expect(normValidation.colCount).toBe(3);

      const middleRow = normalized.child(1);
      expect(middleRow.childCount).toBe(3);
      expect(middleRow.child(0).textContent).toBe('B1');
      expect(middleRow.child(1).type.name).toBe('table_cell');
      expect(middleRow.child(2).type.name).toBe('table_cell');
    });

    it('normalizes multi-span cells (colspan > 1, rowspan > 1) to 1x1 without crashing', () => {
      const spanTable = blogSchema.nodes.table.create(null, [
        blogSchema.nodes.table_row.create(null, [
          makeHeaderCell('Header Spanning', 3, 2, 'center'),
        ]),
      ]);

      const initialValidation = validateTableGrid(spanTable);
      expect(initialValidation.valid).toBe(false);
      expect(initialValidation.errors.some((e) => e.includes('non-unit span'))).toBe(true);

      const normalized = normalizeTableGrid(spanTable, blogSchema);
      const normValidation = validateTableGrid(normalized);

      expect(normValidation.valid).toBe(true);
      const normalizedCell = normalized.child(0).child(0);
      expect(normalizedCell.attrs.colspan).toBe(1);
      expect(normalizedCell.attrs.rowspan).toBe(1);
      expect(normalizedCell.attrs.align).toBe('center');
    });

    it('preserves cell content and cell marks during normalization', () => {
      const strongMark = blogSchema.mark('strong');
      const richCell = blogSchema.nodes.table_header.create(
        { align: 'right', colspan: 2, rowspan: 1 },
        blogSchema.nodes.paragraph.create(null, blogSchema.text('Bold Header', [strongMark]))
      );

      const table = blogSchema.nodes.table.create(null, [
        blogSchema.nodes.table_row.create(null, [richCell]),
      ]);

      const normalized = normalizeTableGrid(table, blogSchema);
      const cell = normalized.child(0).child(0);

      expect(cell.attrs.colspan).toBe(1);
      expect(cell.attrs.align).toBe('right');
      const textNode = cell.child(0).child(0);
      expect(textNode.text).toBe('Bold Header');
      expect(textNode.marks[0].type.name).toBe('strong');
    });
  });

  // =========================================================================
  // TASK 3: Unicode, Emoji, HTML-like strings in KaTeX, Mermaid, Code Blocks
  // =========================================================================
  describe('3. Unicode, Emoji, HTML Strings in KaTeX, Mermaid, and Code Blocks', () => {
    describe('3.1 KaTeX Math Nodes (math_inline & math_display)', () => {
      const testFormulas = [
        // HTML Injection attempts
        '<script>alert("xss")</script>',
        '<div onclick="evil()">Click</div>',
        '<style>body{display:none}</style>',
        // Complex TeX with special symbols
        '\\int_{-\\infty}^{+\\infty} e^{-x^2} dx = \\sqrt{\\pi}',
        '\\sum_{k=1}^n \\frac{1}{k^2} = \\frac{\\pi^2}{6}',
        '\\left[ \\begin{array}{cc} a & b \\\\ c & d \\end{array} \\right]^{-1}',
        // Unicode, Greek, Hebrew, accents
        '\\alpha + \\beta = \\gamma \\quad \\aleph_0 < \\mathfrak{c} \\quad é = mc^2',
        // Emojis
        '\\text{🚀 Energy: } E = mc^2 \\text{ 🎉}',
        '👨‍👩‍👧‍👦 + 🏳️‍🌈 = ❤️',
        // Quotes and XML entities
        '"quoted" & \'apostrophe\' <tag> &amp; &lt;',
        // Newlines and spacing
        'a + b\n+ c\n\n+ d',
      ];

      it.each(testFormulas)('losslessly round-trips math_inline formula: %s', (tex) => {
        const mathInline = blogSchema.nodes.math_inline.create({ tex });
        const doc = blogSchema.nodes.doc.create(null, [
          blogSchema.nodes.paragraph.create(null, [
            blogSchema.text('Prefix '),
            mathInline,
            blogSchema.text(' Suffix'),
          ]),
        ]);

        expect(() => doc.check()).not.toThrow();

        const json = nodeToJSON(doc);
        const parsed = nodeFromJSON(blogSchema, JSON.parse(JSON.stringify(json)));
        expect(parsed.eq(doc)).toBe(true);

        const parsedInline = parsed.child(0).child(1);
        expect(parsedInline.attrs.tex).toBe(tex);
      });

      it.each(testFormulas)('losslessly round-trips math_display formula: %s', (tex) => {
        const mathDisplay = blogSchema.nodes.math_display.create({ tex });
        const doc = blogSchema.nodes.doc.create(null, [mathDisplay]);

        expect(() => doc.check()).not.toThrow();

        const json = nodeToJSON(doc);
        const parsed = nodeFromJSON(blogSchema, JSON.parse(JSON.stringify(json)));
        expect(parsed.eq(doc)).toBe(true);

        const parsedDisplay = parsed.child(0);
        expect(parsedDisplay.attrs.tex).toBe(tex);
      });

      it('survives extreme KaTeX formula length (50,000 characters)', () => {
        const hugeTex = '\\frac{1}{2} + '.repeat(3500) + '0';
        const mathDisplay = blogSchema.nodes.math_display.create({ tex: hugeTex });
        const doc = blogSchema.nodes.doc.create(null, [mathDisplay]);

        const json = nodeToJSON(doc);
        const parsed = nodeFromJSON(blogSchema, json);
        expect(parsed.child(0).attrs.tex.length).toBe(hugeTex.length);
        expect(parsed.eq(doc)).toBe(true);
      });
    });

    describe('3.2 Mermaid Diagram Blocks (mermaid_block)', () => {
      const testDiagrams = [
        // HTML Injection inside node labels
        'graph TD\n  A["<script>alert(1)</script>"] --> B["<img src=x onerror=alert(2)>"]',
        // Multi-byte emojis in diagram syntax
        'flowchart LR\n  Client["💻 Client 🚀"] -->|Yjs Sync 🎉| Server["🖥️ Collab Hub 🛡️"]',
        // Multilingual & RTL labels
        'graph TD\n  Node1["مرحبا بك"] --> Node2["שלום"] --> Node3["你好世界"]',
        // Special characters and quotes
        'sequenceDiagram\n  autonumber\n  Alice->>Bob: Hello "Bob" & \'Alice\'\n  Bob-->>Alice: OK <200>',
        // Preserve blank lines and exact whitespace
        'flowchart TD\n\n  A --> B\n\n  B --> C\n',
      ];

      it.each(testDiagrams)('preserves exact diagram source code character-for-character', (source) => {
        const textNode = blogSchema.text(source);
        const mermaid = blogSchema.nodes.mermaid_block.create({ securityLevel: 'strict' }, textNode);
        const doc = blogSchema.nodes.doc.create(null, [mermaid]);

        expect(() => doc.check()).not.toThrow();

        const json = nodeToJSON(doc);
        const parsed = nodeFromJSON(blogSchema, JSON.parse(JSON.stringify(json)));
        expect(parsed.eq(doc)).toBe(true);
        expect(parsed.child(0).textContent).toBe(source);
      });

      it('enforces strict securityLevel default and verifies mark exclusion inside mermaid text', () => {
        const mermaid = blogSchema.nodes.mermaid_block.create();
        expect(mermaid.attrs.securityLevel).toBe('strict');

        // Marks are disallowed by spec: marks: ''
        expect(blogSchema.nodes.mermaid_block.spec.marks).toBe('');
        expect(blogSchema.nodes.code_block.spec.marks).toBe('');

        // createChecked verifies child content and marks constraints
        const strongMark = blogSchema.mark('strong');
        expect(() => {
          blogSchema.nodes.mermaid_block.createChecked(null, [
            blogSchema.text('graph TD', [strongMark]),
          ]);
        }).toThrow();

        // Also doc.check() catches marks inside nodes that disallow marks
        const mermaidWithMark = blogSchema.nodes.mermaid_block.create(null, [
          blogSchema.text('graph TD', [strongMark]),
        ]);
        const docWithIllegalMark = blogSchema.nodes.doc.create(null, [mermaidWithMark]);
        expect(() => docWithIllegalMark.check()).toThrow();
      });
    });

    describe('3.3 Fenced Code Blocks (code_block)', () => {
      const codeSamples = [
        // Raw HTML/XML
        '<!DOCTYPE html>\n<html>\n<head><script>alert("test")</script></head>\n<body><h1>Hello</h1></body>\n</html>',
        // Markdown backtick collision inside code
        '```markdown\n# Sub-fence\n```python\nprint("hello")\n```\n```',
        // Tabs, multiple spaces, mixed indentation
        '\tfunction indentTest() {\n\t\tconst a = 1;\n    const b = 2;\n\t  return a + b;\n}',
        // Unicode zero-width space and invisible characters
        'const token = "secret\u200B\uFEFFkey";\n// comment with emoji 🚀',
        // CRLF mixed content
        'line1\r\nline2\r\nline3\nline4',
      ];

      it.each(codeSamples)('losslessly round-trips code block content: %s', (code) => {
        const textNode = blogSchema.text(code);
        const codeBlock = blogSchema.nodes.code_block.create({ language: 'typescript' }, textNode);
        const doc = blogSchema.nodes.doc.create(null, [codeBlock]);

        expect(() => doc.check()).not.toThrow();

        const json = nodeToJSON(doc);
        const parsed = nodeFromJSON(blogSchema, JSON.parse(JSON.stringify(json)));
        expect(parsed.eq(doc)).toBe(true);
        expect(parsed.child(0).textContent).toBe(code);
      });

      it('supports exotic language identifiers without crashing', () => {
        const exoticLanguages = [
          'c++',
          'c#',
          'objective-c',
          'f#',
          'x86_64-asm',
          '123',
          '',
          'super-long-language-tag-with-many-hyphens',
        ];

        for (const lang of exoticLanguages) {
          const codeBlock = blogSchema.nodes.code_block.create(
            { language: lang },
            blogSchema.text('code')
          );
          const doc = blogSchema.nodes.doc.create(null, [codeBlock]);
          const json = nodeToJSON(doc);
          const parsed = nodeFromJSON(blogSchema, json);
          expect(parsed.child(0).attrs.language).toBe(lang);
        }
      });
    });
  });

  // =========================================================================
  // TASK 4: Malformed Suggestion Mark Attributes & Contracts
  // =========================================================================
  describe('4. Suggestion Mark Attributes & Zod Contract Validation', () => {
    describe('4.1 Zod Strict Schema Enforcement for Suggestion Attributes', () => {
      it('rejects empty string attributes for agentId, tokenId, ownerUserId', () => {
        const emptyAgent = {
          agentId: '',
          tokenId: 'tok-1',
          ownerUserId: 'user-1',
          timestamp: 1729600000000,
        };
        expect(safeValidate(SuggestionInsertAttrsSchema, emptyAgent).success).toBe(false);

        const emptyToken = {
          agentId: 'agent-1',
          tokenId: '',
          ownerUserId: 'user-1',
          timestamp: 1729600000000,
        };
        expect(safeValidate(SuggestionInsertAttrsSchema, emptyToken).success).toBe(false);

        const emptyUser = {
          agentId: 'agent-1',
          tokenId: 'tok-1',
          ownerUserId: '',
          timestamp: 1729600000000,
        };
        expect(safeValidate(SuggestionInsertAttrsSchema, emptyUser).success).toBe(false);
      });

      it('rejects negative, zero, float, and non-numeric timestamps in Zod contracts', () => {
        const badTimestamps = [-1, -1000, 0, 1729600000000.5, NaN, Infinity, -Infinity];

        for (const ts of badTimestamps) {
          const payload = {
            agentId: 'agent-1',
            tokenId: 'tok-1',
            ownerUserId: 'user-1',
            timestamp: ts,
          };
          expect(safeValidate(SuggestionInsertAttrsSchema, payload).success).toBe(false);
          expect(safeValidate(SuggestionDeleteAttrsSchema, payload).success).toBe(false);
        }
      });

      it('rejects invalid suggestion status values', () => {
        const invalidStatuses = ['approved', 'draft', 'active', 'PENDING', 'resolved', 'cancelled', ''];

        for (const status of invalidStatuses) {
          const payload = {
            agentId: 'agent-1',
            tokenId: 'tok-1',
            ownerUserId: 'user-1',
            timestamp: 1729600000000,
            status,
          };
          expect(safeValidate(SuggestionInsertAttrsSchema, payload).success).toBe(false);
          expect(safeValidate(SuggestionDeleteAttrsSchema, payload).success).toBe(false);
        }
      });

      it('observes that future timestamps are accepted by Zod (no upper bound constraint)', () => {
        const futureTimestamp = Date.now() + 100 * 365 * 24 * 3600 * 1000; // 100 years into the future
        const payload = {
          agentId: 'agent-1',
          tokenId: 'tok-1',
          ownerUserId: 'user-1',
          timestamp: futureTimestamp,
        };
        const result = safeValidate(SuggestionInsertAttrsSchema, payload);
        // Note finding: timestamp allows arbitrarily large positive integers
        expect(result.success).toBe(true);
      });
    });

    describe('4.2 ProseMirror Mark Schema Behavior with Suggestion Marks', () => {
      it('enforces mutual exclusion between suggestion_insert and suggestion_delete via MarkType.excludes and addToSet', () => {
        const insertMark = blogSchema.mark(MARK_SUGGESTION_INSERT, {
          agentId: 'agent-1',
          tokenId: 'tok-1',
          ownerUserId: 'user-1',
          timestamp: 1729600000000,
        });
        const deleteMark = blogSchema.mark(MARK_SUGGESTION_DELETE, {
          agentId: 'agent-1',
          tokenId: 'tok-1',
          ownerUserId: 'user-1',
          timestamp: 1729600000000,
        });

        // 1. Verify schema excludes spec
        expect(blogSchema.marks[MARK_SUGGESTION_INSERT].excludes(blogSchema.marks[MARK_SUGGESTION_DELETE])).toBe(true);
        expect(blogSchema.marks[MARK_SUGGESTION_DELETE].excludes(blogSchema.marks[MARK_SUGGESTION_INSERT])).toBe(true);

        // 2. In ProseMirror, addToSet enforces exclusion during mark application
        const setWithInsert = insertMark.addToSet([]);
        expect(setWithInsert).toHaveLength(1);
        expect(setWithInsert[0].type.name).toBe(MARK_SUGGESTION_INSERT);

        // Adding delete mark to set containing insert mark replaces/excludes insert mark
        const setWithBoth = deleteMark.addToSet(setWithInsert);
        expect(setWithBoth).toHaveLength(1);
        expect(setWithBoth[0].type.name).toBe(MARK_SUGGESTION_DELETE);
      });

      it('proves inclusive: false on suggestion marks prevents adjacent typing inheritance', () => {
        expect(blogSchema.marks[MARK_SUGGESTION_INSERT].spec.inclusive).toBe(false);
        expect(blogSchema.marks[MARK_SUGGESTION_DELETE].spec.inclusive).toBe(false);
        expect(blogSchema.marks[MARK_ATTRIBUTION].spec.inclusive).toBe(false);
      });

      it('round-trips suggestion marks via DOM without attribute corruption', () => {
        const mark = blogSchema.mark(MARK_SUGGESTION_INSERT, {
          id: 'uuid-hunk-999',
          agentId: 'agent:copywriter:v2',
          tokenId: 'pat-auth-001',
          ownerUserId: 'user-admin',
          timestamp: 1729605555000,
          status: 'pending',
        });

        const text = blogSchema.text('Proposed change', [mark]);
        const serializer = DOMSerializer.fromSchema(blogSchema);
        const dom = serializer.serializeNode(text) as HTMLElement;

        expect(dom.tagName.toLowerCase()).toBe('ins');
        expect(dom.getAttribute('data-suggestion-id')).toBe('uuid-hunk-999');
        expect(dom.getAttribute('data-agent-id')).toBe('agent:copywriter:v2');
        expect(dom.getAttribute('data-timestamp')).toBe('1729605555000');
        expect(dom.getAttribute('data-status')).toBe('pending');
      });
    });
  });

  // =========================================================================
  // TASK 5: Lossless JSON Serialization and Deserialization Stress
  // =========================================================================
  describe('5. Lossless JSON Serialization and Deserialization Stress', () => {
    it('round-trips a comprehensive document containing all node and mark types', () => {
      const fullDoc: ProseMirrorDocJSON = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Document Title' }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Normal text, ' },
              { type: 'text', text: 'bold text, ', marks: [{ type: 'strong' }] },
              { type: 'text', text: 'italic text, ', marks: [{ type: 'em' }] },
              { type: 'text', text: 'inline code, ', marks: [{ type: 'code' }] },
              {
                type: 'text',
                text: 'hyperlink, ',
                marks: [{ type: 'link', attrs: { href: 'https://example.com', title: 'Example' } }],
              },
              {
                type: 'text',
                text: 'suggested insertion, ',
                marks: [
                  {
                    type: 'suggestion_insert',
                    attrs: {
                      id: 'hunk-1',
                      agentId: 'a1',
                      tokenId: 't1',
                      ownerUserId: 'u1',
                      timestamp: 1729600000000,
                      status: 'pending',
                    },
                  },
                ],
              },
              {
                type: 'text',
                text: 'attributed provenance.',
                marks: [
                  {
                    type: 'attribution',
                    attrs: {
                      authorType: 'agent',
                      agentId: 'a1',
                      tokenId: 't1',
                      ownerUserId: 'u1',
                      acceptedBy: 'human-editor',
                      acceptedAt: 1729600100000,
                    },
                  },
                ],
              },
            ],
          },
          {
            type: 'callout_alert',
            attrs: { alertType: 'IMPORTANT' },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Important callout text' }],
              },
            ],
          },
          {
            type: 'bullet_list',
            content: [
              {
                type: 'list_item',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Bullet item 1' }] },
                ],
              },
            ],
          },
          {
            type: 'ordered_list',
            attrs: { order: 5 },
            content: [
              {
                type: 'list_item',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Ordered item starting at 5' }] },
                ],
              },
            ],
          },
          {
            type: 'code_block',
            attrs: { language: 'rust' },
            content: [{ type: 'text', text: 'fn main() {\n    println!("Hello World");\n}' }],
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'math_inline',
                attrs: { tex: 'E = mc^2' },
              },
            ],
          },
          {
            type: 'math_display',
            attrs: { tex: '\\int_0^1 f(x) dx' },
          },
          {
            type: 'mermaid_block',
            attrs: { securityLevel: 'strict' },
            content: [{ type: 'text', text: 'graph LR\n  A --> B' }],
          },
          {
            type: 'horizontal_rule',
          },
          {
            type: 'table',
            content: [
              {
                type: 'table_row',
                content: [
                  {
                    type: 'table_header',
                    attrs: { align: 'left', colspan: 1, rowspan: 1, colwidth: null },
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'H1' }] }],
                  },
                  {
                    type: 'table_header',
                    attrs: { align: 'right', colspan: 1, rowspan: 1, colwidth: null },
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'H2' }] }],
                  },
                ],
              },
              {
                type: 'table_row',
                content: [
                  {
                    type: 'table_cell',
                    attrs: { align: 'left', colspan: 1, rowspan: 1, colwidth: null },
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'C1' }] }],
                  },
                  {
                    type: 'table_cell',
                    attrs: { align: 'right', colspan: 1, rowspan: 1, colwidth: null },
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'C2' }] }],
                  },
                ],
              },
            ],
          },
        ],
      };

      const doc = nodeFromJSON(blogSchema, fullDoc);
      expect(() => doc.check()).not.toThrow();

      const serialized = nodeToJSON(doc);
      expect(serialized).toEqual(fullDoc);

      const roundTripped = nodeFromJSON(blogSchema, serialized);
      expect(roundTripped.eq(doc)).toBe(true);
    });

    it('stress tests serialization with a 1,000-paragraph document', () => {
      const paragraphs: ProseMirrorDocJSON['content'] = [];
      for (let i = 0; i < 1000; i++) {
        paragraphs.push({
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: `Paragraph line ${i}: testing lossless serialization with symbols & < > " ' and unicode 🚀`,
            },
          ],
        });
      }

      const hugeDoc: ProseMirrorDocJSON = {
        type: 'doc',
        content: paragraphs,
      };

      const start = performance.now();
      const doc = nodeFromJSON(blogSchema, hugeDoc);
      const json = nodeToJSON(doc);
      const stringified = JSON.stringify(json);
      const parsedJSON = JSON.parse(stringified);
      const roundTrippedDoc = nodeFromJSON(blogSchema, parsedJSON);
      const elapsed = performance.now() - start;

      expect(roundTrippedDoc.childCount).toBe(1000);
      expect(roundTrippedDoc.eq(doc)).toBe(true);
      // Ensure serialization is performant (< 500ms for 1000 paragraphs)
      expect(elapsed).toBeLessThan(500);
    });

    it('rejects invalid JSON inputs with proper errors', () => {
      expect(() => nodeFromJSON(blogSchema, null)).toThrow('Invalid ProseMirror JSON');
      expect(() => nodeFromJSON(blogSchema, undefined)).toThrow('Invalid ProseMirror JSON');
      expect(() => nodeFromJSON(blogSchema, 'not an object')).toThrow('Invalid ProseMirror JSON');
      expect(() => nodeFromJSON(blogSchema, 42)).toThrow('Invalid ProseMirror JSON');
      expect(() => nodeFromJSON(blogSchema, {})).toThrow('Invalid ProseMirror JSON');

      // Unknown node type
      expect(() =>
        nodeFromJSON(blogSchema, { type: 'unknown_fantasy_node' })
      ).toThrow();
    });

    it('validates documentJSON rejects empty doc content (docNode content: "block+") ', () => {
      const emptyDocJSON = {
        type: 'doc',
        content: [],
      };

      const validation = validateDocumentJSON(blogSchema, emptyDocJSON);
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('Invalid content for node doc');
    });
  });

  // =========================================================================
  // TASK 6: Markdown Exporter Stress & Table Normalization Under Markdown Export
  // =========================================================================
  describe('6. Markdown Exporter Stress & Edge Cases', () => {
    it('exports 10-level nested blockquotes with cumulative "> > > " prefixes', () => {
      let currentInner = blogSchema.nodes.paragraph.create(
        null,
        blogSchema.text('Deep nested quote text')
      );
      for (let i = 0; i < 10; i++) {
        currentInner = blogSchema.nodes.blockquote.create(null, [currentInner]);
      }
      const doc = blogSchema.nodes.doc.create(null, [currentInner]);
      const md = exportDerivedMarkdown(doc);

      // Verify 10 '>' prefixes
      expect(md).toBe('> > > > > > > > > > Deep nested quote text');
    });

    it('exports table with suggestions inside cells correctly', () => {
      const pendingInsert = blogSchema.mark(MARK_SUGGESTION_INSERT, {
        agentId: 'a1',
        tokenId: 't1',
        ownerUserId: 'u1',
        timestamp: 1729600000000,
        status: 'pending',
      });
      const pendingDelete = blogSchema.mark(MARK_SUGGESTION_DELETE, {
        agentId: 'a1',
        tokenId: 't1',
        ownerUserId: 'u1',
        timestamp: 1729600000000,
        status: 'pending',
      });

      const table = blogSchema.nodes.table.create(null, [
        blogSchema.nodes.table_row.create(null, [
          blogSchema.nodes.table_header.create(
            { align: null, colspan: 1, rowspan: 1 },
            blogSchema.nodes.paragraph.create(null, blogSchema.text('Col A'))
          ),
          blogSchema.nodes.table_header.create(
            { align: null, colspan: 1, rowspan: 1 },
            blogSchema.nodes.paragraph.create(null, blogSchema.text('Col B'))
          ),
        ]),
        blogSchema.nodes.table_row.create(null, [
          blogSchema.nodes.table_cell.create(
            { align: null, colspan: 1, rowspan: 1 },
            blogSchema.nodes.paragraph.create(null, [
              blogSchema.text('Cell 1 '),
              blogSchema.text('unreviewed addition', [pendingInsert]),
            ])
          ),
          blogSchema.nodes.table_cell.create(
            { align: null, colspan: 1, rowspan: 1 },
            blogSchema.nodes.paragraph.create(null, [
              blogSchema.text('Cell 2 '),
              blogSchema.text('preserved deletion', [pendingDelete]),
            ])
          ),
        ]),
      ]);

      const doc = blogSchema.nodes.doc.create(null, [table]);
      const md = exportDerivedMarkdown(doc);

      // Pending insertion must be dropped
      expect(md).not.toContain('unreviewed addition');
      // Pending deletion must be retained
      expect(md).toContain('preserved deletion');
      // Table formatting maintained
      expect(md).toContain('| Col A | Col B |');
      expect(md).toContain('| --- | --- |');
      expect(md).toContain('| Cell 1 | Cell 2 preserved deletion |');
    });

    it('handles math formulas containing dollar signs and TeX macros without breaking export', () => {
      const doc = blogSchema.nodes.doc.create(null, [
        blogSchema.nodes.paragraph.create(null, [
          blogSchema.text('Price: '),
          blogSchema.nodes.math_inline.create({ tex: '\\$50 + \\$100 = \\$150' }),
        ]),
        blogSchema.nodes.math_display.create({ tex: '\\text{USD } \\$ 1,000,000' }),
      ]);

      const md = exportDerivedMarkdown(doc);
      expect(md).toContain('Price: $\\$50 + \\$100 = \\$150$');
      expect(md).toContain('$$\n\\text{USD } \\$ 1,000,000\n$$');
    });
  });
});
