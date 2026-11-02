// Presentation component for fenced code blocks (including longer fences).
//
// Code is emitted as escaped React text inside <pre><code>. No execution and
// no raw HTML. The language is shown as a muted label.

import React from 'react';
import { BlockNode } from '../markdown.js';

interface CodeBlockBlock {
  type: 'codeBlock';
  lang: string;
  code: string;
}

interface CodeBlockProps {
  block: BlockNode;
  mode: 'flow' | 'block';
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ block, mode }) => {
  const b = block as CodeBlockBlock;
  const pre = (
    <pre className="p-3.5 rounded-lg bg-code-bg border border-border text-xs font-mono overflow-x-auto text-foreground">
      <code>{b.code}</code>
    </pre>
  );

  if (mode === 'block') {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 shadow-xs my-3">
        <div className="flex items-center gap-2 text-[10px] font-mono text-accent font-semibold uppercase tracking-wider mb-2">
          Code Cell
          {b.lang ? <span className="text-text-muted font-normal">• {b.lang}</span> : null}
        </div>
        {pre}
      </div>
    );
  }

  return <div className="my-4">{pre}</div>;
};
