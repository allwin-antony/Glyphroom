// Presentation component for ordered, unordered and task lists.
//
// Items render as escaped React text via the Inline presenter. Task items show
// a disabled checkbox reflecting the checked state. Nested lists are not part
// of the shared export grammar (each line is one item); unsupported nesting
// stays readable as separate items.

import React from 'react';
import { Inline } from './Inline.js';
import { parseInline, BlockNode, InlineNode } from '../markdown.js';

interface ListBlock {
  type: 'bulletList' | 'orderedList' | 'taskList';
  items?: InlineNode[][];
  taskItems?: { checked: boolean; inlines: InlineNode[] }[];
}

interface ListProps {
  block: BlockNode;
  mode: 'flow' | 'block';
}

const renderItem = (item: { inlines: InlineNode[]; checked?: boolean }, idx: number) => {
  if (item.checked !== null) {
    return (
      <li key={idx} className="flex items-start gap-2 my-1 text-text-secondary">
        <input type="checkbox" disabled checked={item.checked} className="mt-0.5 shrink-0" aria-checked={item.checked} readOnly />
        <Inline nodes={item.inlines} />
      </li>
    );
  }
  return <li key={idx} className="my-1 text-text-secondary"><Inline nodes={item.inlines} /></li>;
};

export const List: React.FC<ListProps> = ({ block, mode }) => {
  const b = block as ListBlock;
  const items =
    b.type === 'taskList'
      ? (b.taskItems ?? []).map((it, idx) => renderItem({ inlines: it.inlines, checked: it.checked }, idx))
      : (b.items ?? []).map((it, idx) => renderItem({ inlines: it }, idx));

  const listEl = b.type === 'orderedList' ? (
    <ol className="list-decimal pl-6 space-y-1.5 text-text-secondary">{items}</ol>
  ) : b.type === 'taskList' ? (
    <ul className="list-none pl-4 space-y-1.5 text-text-secondary">{items}</ul>
  ) : (
    <ul className="list-disc pl-6 space-y-1.5 text-text-secondary">{items}</ul>
  );

  if (mode === 'block') {
    return (
      <div className="rounded-xl border border-border bg-surface p-5 shadow-xs my-3">
        <div className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-2 font-bold">
          List Cell
        </div>
        <div className="my-3">{listEl}</div>
      </div>
    );
  }

  return <div className="my-3">{listEl}</div>;
};
