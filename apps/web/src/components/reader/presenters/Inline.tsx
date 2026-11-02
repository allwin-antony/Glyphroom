// Presentation component for inline Markdown nodes.
//
// Every text node is emitted as interpolated React text (escaped automatically).
// Links and images only render when their URL passes the protocol allowlist;
// otherwise the visible text/alt is shown as plain text and no link is created.

import React from 'react';
import { isAllowedUrl } from '../security.js';
import { InlineNode } from '../markdown.js';
import { MathBlock } from './MathBlock.js';

interface InlineProps {
  nodes: InlineNode[];
  className?: string;
}

export const Inline: React.FC<InlineProps> = ({ nodes, className }) => (
  <span className={className}>
    {nodes.map((node, idx) => {
      switch (node.type) {
        case 'text':
          return <React.Fragment key={idx}>{node.content}</React.Fragment>;
        case 'strong':
          return <strong key={idx}>{node.content}</strong>;
        case 'em':
          return <em key={idx}>{node.content}</em>;
        case 'strike':
          return <s key={idx}>
            {node.content}
          </s>;
        case 'code':
          return (
            <code key={idx} className="px-1.5 py-0.5 rounded bg-code-bg font-mono text-[13px] border border-border">
              {node.content}
            </code>
          );
        case 'link': {
          const href = isAllowedUrl(node.href) ? node.href : '';
          if (!href) return <span key={idx}>{node.content}</span>;
          return (
            <a
              key={idx}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-4 hover:text-accent-main transition-colors"
            >
              {node.content}
            </a>
          );
        }
        case 'image': {
          const src = isAllowedUrl(node.src) ? node.src : '';
          if (!src) return <span key={idx} className="text-text-muted italic">
            {node.alt || '(image)'}
          </span>;
          return (
            <img
              key={idx}
              src={src}
              alt={node.alt || ''}
              className="max-w-full h-auto rounded-lg border border-border"
            />
          );
        }
        case 'inlineMath':
          return <MathBlock key={idx} tex={node.content} displayMode={false} />;
        default:
          return <React.Fragment key={idx}>{node.content}</React.Fragment>;
      }
    })}
  </span>
);
