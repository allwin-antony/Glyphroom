// Presentation component for Markdown paragraphs.
//
// Rendered as escaped React text via the Inline presenter. In block mode the
// paragraph is wrapped in the existing "Text Cell" notebook card.

import React from 'react';
import { Inline } from './Inline.js';
import { parseInline, BlockNode } from '../markdown.js';

interface ParagraphBlock {
  type: 'paragraph';
  text: string;
}

interface ParagraphProps {
  block: BlockNode;
  mode: 'flow' | 'block';
}

export const Paragraph: React.FC<ParagraphProps> = ({ block, mode }) => {
  const b = block as ParagraphBlock;
  const nodes = b.text ? parseInline(b.text) : [];
  const content = <p className="leading-relaxed"><Inline nodes={nodes} /></p>;

  if (mode === 'block') {
    return (
      <div className="rounded-xl border border-border bg-surface p-5 shadow-xs my-3">
        <div className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-2 font-bold">
          Text Cell
        </div>
        {content}
      </div>
    );
  }

  return <p className="text-text-main leading-relaxed my-2">
    <Inline nodes={nodes} />
  </p>;
};
