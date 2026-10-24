import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import React, { useState, useId } from 'react';
import katex from 'katex';
import { Sigma, Edit3, Check } from 'lucide-react';

interface MathComponentProps {
  node: {
    attrs: {
      formula: string;
      displayMode: boolean;
    };
  };
  updateAttributes: (attrs: { formula?: string; displayMode?: boolean }) => void;
  selected: boolean;
}

const MathComponent: React.FC<MathComponentProps> = ({ node, updateAttributes, selected }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [formulaText, setFormulaText] = useState(node.attrs.formula || 'E = mc^2');
  const uniqueId = useId();

  let renderedHtml = '';
  let renderError: string | null = null;

  try {
    renderedHtml = katex.renderToString(node.attrs.formula || '', {
      displayMode: node.attrs.displayMode ?? true,
      throwOnError: false,
      trust: false, // Strict security: prevent raw HTML/script injection
    });
  } catch (err: any) {
    renderError = err?.message || 'Formula render error';
  }

  const handleSave = () => {
    updateAttributes({ formula: formulaText.trim() });
    setIsEditing(false);
  };

  return (
    <NodeViewWrapper className="my-4 not-prose select-none">
      <div
        className={`rounded-xl border p-3.5 transition-all bg-surface ${
          selected || isEditing ? 'border-accent shadow-sm ring-1 ring-accent/20' : 'border-border'
        }`}
      >
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-border text-[11px] text-text-muted">
          <div className="flex items-center gap-1.5 font-semibold text-foreground">
            <Sigma className="w-3.5 h-3.5 text-accent" />
            <span>KaTeX Mathematical Formula</span>
          </div>
          <button
            type="button"
            onClick={() => (isEditing ? handleSave() : setIsEditing(true))}
            className="flex items-center gap-1 text-[11px] text-accent hover:underline px-2 py-0.5 rounded hover:bg-canvas"
          >
            {isEditing ? (
              <>
                <Check className="w-3 h-3 text-status-success" />
                <span className="font-semibold text-status-success">Apply</span>
              </>
            ) : (
              <>
                <Edit3 className="w-3 h-3" />
                <span>Edit Formula</span>
              </>
            )}
          </button>
        </div>

        {isEditing ? (
          <div className="space-y-2">
            <textarea
              value={formulaText}
              onChange={(e) => setFormulaText(e.target.value)}
              placeholder="e.g. \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}"
              rows={2}
              className="w-full font-mono text-xs px-3 py-2 rounded-lg bg-canvas border border-border text-foreground focus:outline-none focus:border-accent resize-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleSave();
                }
              }}
            />
            <div className="flex items-center justify-between text-[10px] text-text-muted">
              <span>LaTeX format (press Ctrl+Enter to apply)</span>
              <button
                type="button"
                onClick={handleSave}
                className="px-2.5 py-1 rounded bg-accent text-white font-medium text-xs shadow-xs"
              >
                Done
              </button>
            </div>
          </div>
        ) : renderError ? (
          <div className="p-2 rounded bg-status-danger/10 border border-status-danger/20 text-status-danger text-xs font-mono">
            {renderError}
          </div>
        ) : (
          <div
            className="overflow-x-auto py-2 flex justify-center text-foreground font-serif text-base"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        )}
      </div>
    </NodeViewWrapper>
  );
};

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      formula: {
        default: 'f(x) = \\int_{-\\infty}^\\infty \\hat f(\\xi)\\,e^{2 \\pi i \\xi x}\\,d\\xi',
        parseHTML: (el) => el.getAttribute('data-formula') || '',
        renderHTML: (attrs) => ({ 'data-formula': attrs.formula }),
      },
      displayMode: {
        default: true,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="math-block"]',
        getAttrs: (el) => {
          if (typeof el === 'string') return false;
          return {
            formula: el.getAttribute('data-formula') || '',
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'math-block' }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathComponent as any);
  },
});
