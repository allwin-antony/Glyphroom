// Unified read-only Markdown renderer powering both ReaderView and ReaderPreview.
//
// Consumes the shared export grammar (produced by exportDerivedMarkdown in
// @glyphroom/shared) and renders it as safe React nodes:
//  - Ordinary content is escaped React text (no dangerouslySetInnerHTML on user content).
//  - Raw HTML and unsafe URLs never execute.
//  - Mermaid and KaTeX are rendered through their own security controls.
//
// Supports two presentation modes:
//  - 'flow'      - continuous article flow (ReaderPreview default).
//  - 'block'     - notebook block cards (ReaderView block mode).
//
// Empty Markdown renders nothing; unsupported/malformed syntax stays readable
// text and never silently disappears.

import React from 'react';
import { parseMarkdown, parseInline, BlockNode } from './markdown.js';
import { Heading } from './presenters/Heading.js';
import { Paragraph } from './presenters/Paragraph.js';
import { List } from './presenters/List.js';
import { CodeBlock } from './presenters/CodeBlock.js';
import { Alert } from './presenters/Alert.js';
import { Table } from './presenters/Table.js';
import { MermaidBlock } from './presenters/MermaidBlock.js';
import { MathBlock } from './presenters/MathBlock.js';
import { StatusBlock } from './presenters/StatusBlock.js';
import { HorizontalRule } from './presenters/HorizontalRule.js';
import { Inline } from './presenters/Inline.js';

export type ReaderMode = 'flow' | 'block';

interface MarkdownRendererProps {
  markdown: string;
  mode?: ReaderMode;
  className?: string;
  suppressFirstHeading?: boolean;
}

function renderBlock(block: BlockNode, mode: ReaderMode, idx: number): React.ReactNode {
  const key = block.id ?? `block-${idx}`;
  switch (block.type) {
    case 'heading':
      return <Heading block={block} mode={mode} key={key} />;
    case 'paragraph':
      return <Paragraph block={block} mode={mode} key={key} />;
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return <List block={block} mode={mode} key={key} />;
    case 'codeBlock':
      return <CodeBlock block={block} mode={mode} key={key} />;
    case 'alert':
      return <Alert block={block} key={key} />;
    case 'blockquote':
      return (
        <blockquote key={key} className="border-l-3 border-accent pl-3.5 py-1 text-sm text-text-secondary italic my-2.5">
          <Inline nodes={block.text ? parseInline(block.text) : []} />
        </blockquote>
      );
    case 'table':
      return <Table block={block} mode={mode} key={key} />;
    case 'mermaid':
      return <MermaidBlock code={block.code ?? ''} key={key} className="my-4" />;
    case 'mathDisplay':
      return <MathBlock tex={block.tex ?? ''} displayMode key={key} className="my-4" />;
    case 'statusBlock':
      return <StatusBlock block={block} key={key} />;
    case 'hr':
      return <HorizontalRule key={key} />;
    case 'text':
      return <p key={key} className="text-text-secondary my-2">{block.text}</p>;
    default:
      return null;
  }
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  markdown = '',
  mode = 'flow',
  className,
  suppressFirstHeading = false,
}) => {
  const { blocks } = parseMarkdown(markdown);
  let suppressedFirstHeading = false;
  return (
    <div className={className}>
      {blocks.map((block, idx) => {
        if (suppressFirstHeading && !suppressedFirstHeading && block.type === 'heading' && block.level === 1) {
          suppressedFirstHeading = true;
          return null;
        }
        return renderBlock(block, mode, idx);
      })}
    </div>
  );
};
