import React, { useState } from 'react';
import { exportDerivedMarkdown } from '@glyphroom/shared';
import { BookOpen, FileText, Layers } from 'lucide-react';
import { MarkdownRenderer, type ReaderMode } from '../components/reader/MarkdownRenderer.js';

export interface ReaderPreviewProps {
  prosemirrorDocJSON?: any;
  markdown?: string;
  title?: string;
  mode?: ReaderMode;
}

export const ReaderPreview: React.FC<ReaderPreviewProps> = ({
  prosemirrorDocJSON,
  markdown,
  title = '',
  mode: initialMode = 'flow',
}) => {
  const [previewMode, setPreviewMode] = useState<ReaderMode>(initialMode);
  const derivedMarkdown =
    markdown !== undefined
      ? markdown
      : prosemirrorDocJSON
        ? exportDerivedMarkdown(prosemirrorDocJSON)
        : '';

  if (!derivedMarkdown.trim()) {
    return (
      <div className="max-w-3xl mx-auto my-6 p-6 sm:p-10 rounded-2xl bg-surface border border-border shadow-xs text-foreground">
        <div className="flex items-center justify-between pb-4 mb-6 border-b border-border text-xs text-text-muted">
          <div className="flex items-center gap-2">
            <BookOpen size={16} className="text-accent shrink-0" />
             <span className="font-semibold text-foreground">Working Preview</span>
             <span className="hidden sm:inline">• Shows the current edits as readers will see them</span>
          </div>
        </div>
        {title?.trim() && (
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground mb-6">
            {title}
          </h1>
        )}
        <p className="text-text-muted italic">Draft is empty.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto my-6 p-6 sm:p-10 rounded-2xl bg-surface border border-border shadow-xs text-foreground">
      <div className="flex items-center justify-between pb-4 mb-6 border-b border-border text-xs text-text-muted">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-accent shrink-0" />
          <span className="font-semibold text-foreground">Working Preview</span>
          <span className="hidden sm:inline">• Shows the current edits as readers will see them</span>
        </div>

        {/* Presentation mode toggle: Document vs Blocks */}
        <div className="flex items-center rounded-lg border border-border p-0.5 bg-canvas shrink-0">
          <button
            onClick={() => setPreviewMode('flow')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${previewMode === 'flow'
                ? 'bg-elevated text-foreground shadow-xs'
                : 'text-text-muted hover:text-foreground'
              }`}
             title="Document View"
          >
            <FileText size={11} />
             <span>Document</span>
          </button>
          <button
            onClick={() => setPreviewMode('block')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${previewMode === 'block'
                ? 'bg-elevated text-accent shadow-xs'
                : 'text-text-muted hover:text-foreground'
              }`}
             title="Blocks View"
          >
            <Layers size={11} />
             <span>Blocks</span>
          </button>
        </div>
      </div>

      {title?.trim() && (
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground mb-6">
          {title}
        </h1>
      )}

      <div className="space-y-1">
        <MarkdownRenderer
          markdown={derivedMarkdown}
          mode={previewMode}
          suppressFirstHeading={Boolean(title?.trim())}
        />
      </div>
    </div>
  );
};
