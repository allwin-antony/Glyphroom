import { NodeSpec } from 'prosemirror-model';

export type TableCellAlignment = 'left' | 'center' | 'right' | null;

/**
 * GFM Table container node. Contains one or more table rows.
 */
export const tableNode: NodeSpec = {
  content: 'table_row+',
  group: 'block',
  tableRole: 'table',
  isolating: true,
  parseDOM: [{ tag: 'table' }],
  toDOM() {
    return ['table', ['tbody', 0]];
  },
};

/**
 * GFM Table row node. Contains cells or header cells.
 */
export const tableRowNode: NodeSpec = {
  content: '(table_cell | table_header)+',
  tableRole: 'row',
  parseDOM: [{ tag: 'tr' }],
  toDOM() {
    return ['tr', 0];
  },
};

/**
 * GFM Table header cell.
 */
export const tableHeaderNode: NodeSpec = {
  attrs: {
    align: { default: null },
    colspan: { default: 1 },
    rowspan: { default: 1 },
    colwidth: { default: null },
  },
  content: 'paragraph+',
  tableRole: 'header_cell',
  isolating: true,
  parseDOM: [
    {
      tag: 'th',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        const align = el.getAttribute('align') || el.style.textAlign || el.getAttribute('data-align') || null;
        return {
          align: align && ['left', 'center', 'right'].includes(align) ? align : null,
          colspan: 1,
          rowspan: 1,
        };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = {};
    if (node.attrs.align) {
      attrs.style = `text-align: ${node.attrs.align}`;
      attrs['data-align'] = node.attrs.align;
    }
    return ['th', attrs, 0];
  },
};

/**
 * GFM Table body cell.
 */
export const tableCellNode: NodeSpec = {
  attrs: {
    align: { default: null },
    colspan: { default: 1 },
    rowspan: { default: 1 },
    colwidth: { default: null },
  },
  content: 'paragraph+',
  tableRole: 'cell',
  isolating: true,
  parseDOM: [
    {
      tag: 'td',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        const align = el.getAttribute('align') || el.style.textAlign || el.getAttribute('data-align') || null;
        return {
          align: align && ['left', 'center', 'right'].includes(align) ? align : null,
          colspan: 1,
          rowspan: 1,
        };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = {};
    if (node.attrs.align) {
      attrs.style = `text-align: ${node.attrs.align}`;
      attrs['data-align'] = node.attrs.align;
    }
    return ['td', attrs, 0];
  },
};
