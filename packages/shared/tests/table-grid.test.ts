import { describe, it, expect } from 'vitest';
import { blogSchema } from '../src/schema/index.js';
import { validateTableGrid, normalizeTableGrid } from '../src/schema/table-grid.js';
import { tableFixture } from '../src/fixtures/canonical.js';
import { nodeFromJSON } from '../src/schema/json.js';

describe('Table Grid Invariant & Normalization Engine', () => {
  it('validates a rectangular table fixture successfully', () => {
    const doc = nodeFromJSON(blogSchema, tableFixture);
    const tableNode = doc.firstChild!;
    expect(tableNode.type.name).toBe('table');

    const result = validateTableGrid(tableNode);
    expect(result.valid).toBe(true);
    expect(result.rowCount).toBe(2);
    expect(result.colCount).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  it('detects ragged row column counts in non-conforming table', () => {
    // Construct a ragged table: Row 1 has 3 columns, Row 2 has 2 columns
    const headerCell = () =>
      blogSchema.nodes.table_header.create(
        { align: null, colspan: 1, rowspan: 1 },
        blogSchema.nodes.paragraph.create({}, blogSchema.text('H'))
      );
    const bodyCell = () =>
      blogSchema.nodes.table_cell.create(
        { align: null, colspan: 1, rowspan: 1 },
        blogSchema.nodes.paragraph.create({}, blogSchema.text('B'))
      );

    const raggedTable = blogSchema.nodes.table.create(null, [
      blogSchema.nodes.table_row.create(null, [headerCell(), headerCell(), headerCell()]),
      blogSchema.nodes.table_row.create(null, [bodyCell(), bodyCell()]),
    ]);

    const result = validateTableGrid(raggedTable);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('rectangular grid violation');
  });

  it('normalizes a ragged table by padding missing cells', () => {
    const headerCell = (txt: string) =>
      blogSchema.nodes.table_header.create(
        { align: null, colspan: 1, rowspan: 1 },
        blogSchema.nodes.paragraph.create({}, blogSchema.text(txt))
      );
    const bodyCell = (txt: string) =>
      blogSchema.nodes.table_cell.create(
        { align: null, colspan: 1, rowspan: 1 },
        blogSchema.nodes.paragraph.create({}, blogSchema.text(txt))
      );

    const raggedTable = blogSchema.nodes.table.create(null, [
      blogSchema.nodes.table_row.create(null, [headerCell('H1'), headerCell('H2'), headerCell('H3')]),
      blogSchema.nodes.table_row.create(null, [bodyCell('B1')]), // only 1 column
    ]);

    const normalized = normalizeTableGrid(raggedTable, blogSchema);
    const validation = validateTableGrid(normalized);

    expect(validation.valid).toBe(true);
    expect(validation.rowCount).toBe(2);
    expect(validation.colCount).toBe(3);
    expect(normalized.child(1).childCount).toBe(3);
  });

  it('normalizes non-unit spans (colspan > 1, rowspan > 1) to 1', () => {
    const multiSpanCell = blogSchema.nodes.table_cell.create(
      { align: null, colspan: 2, rowspan: 2 },
      blogSchema.nodes.paragraph.create({}, blogSchema.text('Span'))
    );
    const row = blogSchema.nodes.table_row.create(null, [multiSpanCell]);
    const table = blogSchema.nodes.table.create(null, [row]);

    const normalized = normalizeTableGrid(table, blogSchema);
    const cell = normalized.child(0).child(0);

    expect(cell.attrs.colspan).toBe(1);
    expect(cell.attrs.rowspan).toBe(1);
  });
});
