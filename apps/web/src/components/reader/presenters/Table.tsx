// Presentation component for Markdown tables (escaped pipes).
//
// Cells are rendered as escaped React text; the leading/trailing pipes and
// divider row are structural only. No raw HTML from cell content is executed.

import React from 'react';
import { BlockNode } from '../markdown.js';

interface TableBlock {
  type: 'table';
  rows: string[][];
}

interface TableProps {
  block: BlockNode;
  mode: 'flow' | 'block';
}

export const Table: React.FC<TableProps> = ({ block, mode }) => {
  const b = block as TableBlock;
  const rows = b.rows ?? [];
  if (rows.length === 0) return null;

  const header = rows[0];
  const body = rows.slice(1);

  const table = (
    <div className="overflow-x-auto my-4">
      <table className="reader-table">
        <thead>
          <tr>
            {header.map((cell, idx) => (
              <th key={idx} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIdx) => (
            <tr key={rowIdx}>
              {row.map((cell, cellIdx) => (
                <td key={cellIdx}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (mode === 'block') {
    return (
      <div className="rounded-xl border border-border bg-surface p-5 shadow-xs my-3">
        <div className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-2 font-bold">
          Table Cell
        </div>
        {table}
      </div>
    );
  }

  return table;
};
