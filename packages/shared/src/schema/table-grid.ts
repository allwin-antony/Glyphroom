import { Node as ProseMirrorNode, Schema } from 'prosemirror-model';

export interface TableGridValidationResult {
  valid: boolean;
  rowCount: number;
  colCount: number;
  errors: string[];
}

/**
 * Validates that a table node adheres strictly to rectangular geometry (NxM grid)
 * with uniform column counts per row and unit (1x1) cell spans.
 */
export function validateTableGrid(tableNode: ProseMirrorNode): TableGridValidationResult {
  const errors: string[] = [];
  const rowCount = tableNode.childCount;

  if (rowCount === 0) {
    return { valid: false, rowCount: 0, colCount: 0, errors: ['Table has no rows'] };
  }

  const expectedCols = tableNode.child(0).childCount;
  if (expectedCols === 0) {
    errors.push('Header row has zero columns');
  }

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const row = tableNode.child(rowIndex);
    if (row.type.name !== 'table_row') {
      errors.push(`Row index ${rowIndex} is not of type table_row`);
    }

    if (row.childCount !== expectedCols) {
      errors.push(
        `Row index ${rowIndex} has ${row.childCount} columns, expected ${expectedCols} (rectangular grid violation)`
      );
    }

    for (let colIndex = 0; colIndex < row.childCount; colIndex++) {
      const cell = row.child(colIndex);
      if (cell.attrs.colspan !== 1 || cell.attrs.rowspan !== 1) {
        errors.push(
          `Cell [${rowIndex}, ${colIndex}] has non-unit span (colspan=${cell.attrs.colspan}, rowspan=${cell.attrs.rowspan})`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    rowCount,
    colCount: expectedCols,
    errors,
  };
}

/**
 * Normalizes a ragged or non-conforming table node into a strict rectangular grid:
 * - Finds max column count across all rows
 * - Normalizes colspan/rowspan to 1
 * - Pads shorter rows with blank cells containing empty paragraphs
 */
export function normalizeTableGrid(tableNode: ProseMirrorNode, schema: Schema): ProseMirrorNode {
  const rowCount = tableNode.childCount;
  if (rowCount === 0) return tableNode;

  // Find maximum column count across all rows
  let maxCols = 0;
  for (let i = 0; i < rowCount; i++) {
    maxCols = Math.max(maxCols, tableNode.child(i).childCount);
  }
  if (maxCols === 0) maxCols = 1;

  const normalizedRows: ProseMirrorNode[] = [];

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const row = tableNode.child(rowIndex);
    const cells: ProseMirrorNode[] = [];
    const isFirstRow = rowIndex === 0;

    for (let colIndex = 0; colIndex < maxCols; colIndex++) {
      if (colIndex < row.childCount) {
        const cell = row.child(colIndex);
        // Force colspan=1 and rowspan=1
        if (cell.attrs.colspan !== 1 || cell.attrs.rowspan !== 1) {
          cells.push(
            cell.type.create(
              { ...cell.attrs, colspan: 1, rowspan: 1 },
              cell.content,
              cell.marks
            )
          );
        } else {
          cells.push(cell);
        }
      } else {
        // Pad ragged row with blank cell containing empty paragraph
        const emptyPara = schema.nodes.paragraph.create();
        const cellType = isFirstRow ? schema.nodes.table_header : schema.nodes.table_cell;
        cells.push(cellType.create({ align: null, colspan: 1, rowspan: 1 }, emptyPara));
      }
    }

    normalizedRows.push(schema.nodes.table_row.create(null, cells));
  }

  return schema.nodes.table.create(tableNode.attrs, normalizedRows);
}
