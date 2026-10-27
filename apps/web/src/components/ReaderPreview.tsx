import React from 'react';
import { exportDerivedMarkdown } from '@enterprise-blogger/shared';
import { BookOpen } from 'lucide-react';

export interface ReaderPreviewProps {
  prosemirrorDocJSON: any;
  title: string;
}

export const ReaderPreview: React.FC<ReaderPreviewProps> = ({ prosemirrorDocJSON, title }) => {
  const derivedMarkdown = prosemirrorDocJSON ? exportDerivedMarkdown(prosemirrorDocJSON) : '';

  const formatInline = (text: string) => {
    return text
      .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-canvas font-mono text-[13px] border border-border">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  };

  const renderContent = () => {
    if (!derivedMarkdown.trim()) {
      return <p className="text-text-muted italic">Draft is empty.</p>;
    }

    const lines = derivedMarkdown.split('\n');
    const elements: React.ReactNode[] = [];
    let inCodeBlock = false;
    let codeLines: string[] = [];
    let inList = false;
    let listItems: string[] = [];

    const flushList = (key: string) => {
      if (listItems.length > 0) {
        elements.push(
          <ul key={key} className="list-disc pl-6 space-y-1 my-3 text-text-secondary text-sm">
            {listItems.map((item, idx) => (
              <li key={idx} dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
            ))}
          </ul>
        );
        listItems = [];
        inList = false;
      }
    };

    const flushCodeBlock = (key: string) => {
      if (codeLines.length > 0) {
        elements.push(
          <pre key={key} className="p-3.5 rounded-xl bg-canvas border border-border text-xs font-mono overflow-x-auto text-foreground my-3">
            <code>{codeLines.join('\n')}</code>
          </pre>
        );
        codeLines = [];
        inCodeBlock = false;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('```')) {
        if (inCodeBlock) {
          flushCodeBlock(`code-${i}`);
        } else {
          flushList(`list-before-code-${i}`);
          inCodeBlock = true;
          codeLines = [];
        }
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }

      if (line.startsWith('- ') || line.startsWith('* ')) {
        inList = true;
        listItems.push(line.slice(2));
        continue;
      } else if (inList) {
        flushList(`list-${i}`);
      }

      if (line.startsWith('# ')) {
        elements.push(
          <h1 key={i} className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight mt-6 mb-3 border-b border-border pb-2">
            {line.slice(2)}
          </h1>
        );
      } else if (line.startsWith('## ')) {
        elements.push(
          <h2 key={i} className="text-xl font-bold text-foreground tracking-tight mt-5 mb-2">
            {line.slice(3)}
          </h2>
        );
      } else if (line.startsWith('### ')) {
        elements.push(
          <h3 key={i} className="text-base font-semibold text-foreground mt-4 mb-1.5">
            {line.slice(4)}
          </h3>
        );
      } else if (line.startsWith('> ')) {
        elements.push(
          <blockquote key={i} className="border-l-3 border-accent pl-3.5 py-1 text-sm text-text-secondary italic my-2.5">
            <span dangerouslySetInnerHTML={{ __html: formatInline(line.slice(2)) }} />
          </blockquote>
        );
      } else if (!line.trim()) {
        elements.push(<div key={i} className="h-2" />);
      } else {
        elements.push(
          <p
            key={i}
            className="text-sm leading-relaxed text-text-secondary my-1.5"
            dangerouslySetInnerHTML={{ __html: formatInline(line) }}
          />
        );
      }
    }

    flushList('list-end');
    flushCodeBlock('code-end');

    return elements;
  };

  return (
    <div className="max-w-3xl mx-auto my-6 p-6 sm:p-10 rounded-2xl bg-surface border border-border shadow-xs text-foreground">
      <div className="flex items-center gap-2 pb-4 mb-6 border-b border-border text-xs text-text-muted">
        <BookOpen size={16} className="text-accent shrink-0" />
        <span className="font-semibold text-foreground">Published Reader Projection</span>
        <span>• Pending AI insertions are excluded, pending deletions retain original text</span>
      </div>

      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground mb-6">
        {title || 'Untitled Post'}
      </h1>

      <div className="space-y-1">
        {renderContent()}
      </div>
    </div>
  );
};
