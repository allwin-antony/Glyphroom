import React from 'react';
import { exportDerivedMarkdown } from '@enterprise-blogger/shared';
import { BookOpen } from 'lucide-react';
import { MarkdownRenderer } from '../components/reader/MarkdownRenderer.js';

export interface ReaderPreviewProps {
  prosemirrorDocJSON: any;
  title: string;
}

export const ReaderPreview: React.FC<ReaderPreviewProps> = ({ prosemirrorDocJSON, title }) => {
  const derivedMarkdown = prosemirrorDocJSON ? exportDerivedMarkdown(prosemirrorDocJSON) : '';

  if (!derivedMarkdown.trim()) {
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
        <p className="text-text-muted italic">Draft is empty.</p>
      </div>
    );
  }

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
        <MarkdownRenderer markdown={derivedMarkdown} mode="flow" />
      </div>
    </div>
  );
};
