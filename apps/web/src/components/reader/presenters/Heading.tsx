// Presentation component for Markdown headings (levels 1-6).
//
// Heading ids use the same `heading-${n}` scheme as the Table of Contents so
// anchor links resolve correctly. Text is rendered as escaped React text via
// the Inline presenter (no dangerouslySetInnerHTML).

import React from 'react';
import { Inline } from './Inline.js';
import { parseInline, BlockNode } from '../markdown.js';

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

interface HeadingBlock {
  type: 'heading';
  level: HeadingLevel;
  id: string;
  text: string;
}

interface HeadingProps {
  block: BlockNode;
  mode: 'flow' | 'block';
}

const LEVEL_TAG: Record<HeadingLevel, 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'> = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
  6: 'h6',
};

const LEVEL_FLOW_CLASS: Record<HeadingLevel, string> = {
  1: 'text-2xl sm:text-3xl font-extrabold text-foreground pt-6 pb-2 scroll-mt-20',
  2: 'text-xl sm:text-2xl font-bold text-foreground border-b border-border pb-2 pt-6 scroll-mt-20',
  3: 'text-base sm:text-lg font-bold text-foreground pt-4 scroll-mt-20',
  4: 'text-sm sm:text-base font-bold text-foreground pt-3 scroll-mt-20',
  5: 'text-xs sm:text-sm font-semibold text-foreground pt-2 scroll-mt-20',
  6: 'text-xs font-semibold text-text-secondary uppercase tracking-wider pt-2 scroll-mt-20',
};

export const Heading: React.FC<HeadingProps> = ({ block, mode }) => {
  const b = block as HeadingBlock;
  const Tag = LEVEL_TAG[b.level] || 'h1';
  const flowClass = LEVEL_FLOW_CLASS[b.level] || LEVEL_FLOW_CLASS[1];
  const content = <Inline nodes={b.text ? parseInline(b.text) : []} />;

  if (mode === 'block' && b.level === 1) {
    return (
      <div key={b.id} id={b.id} className="pt-8 pb-2 scroll-mt-20">
        <div className="inline-block px-2 py-0.5 mb-2 rounded bg-accent-bg text-accent text-[10px] font-extrabold uppercase tracking-wider">
          Block Title
        </div>
        <Tag className="text-2xl sm:text-3xl font-extrabold text-foreground border-b-2 border-border pb-2" id={b.id}>
          {content}
        </Tag>
      </div>
    );
  }

  return (
    <Tag key={b.id} id={b.id} className={flowClass}>
      {content}
    </Tag>
  );
};
