import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import React, { useState, useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { GitGraph, Edit3, Check, RefreshCw } from 'lucide-react';

interface MermaidComponentProps {
  node: {
    attrs: {
      code: string;
    };
  };
  updateAttributes: (attrs: { code: string }) => void;
  selected: boolean;
}

const MermaidComponent: React.FC<MermaidComponentProps> = ({ node, updateAttributes, selected }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [codeText, setCodeText] = useState(
    node.attrs.code || 'graph TD\n  Client[Web Browser] -->|REST / WS| Gateway[API Gateway]\n  Gateway --> Service[Core Services]\n  Service --> Database[(PostgreSQL)]'
  );
  const [svgHtml, setSvgHtml] = useState<string>('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Securely render Mermaid SVG with lazy-loaded library and DOMPurify sanitization
  useEffect(() => {
    let isCancelled = false;

    async function renderDiagram() {
      if (!node.attrs.code) {
        setSvgHtml('');
        setRenderError(null);
        return;
      }

      setIsRendering(true);
      setRenderError(null);

      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'antiscript',
          theme: 'neutral',
          fontFamily: 'inherit',
        });

        const id = `mermaid-${Math.random().toString(36).substring(2, 9)}`;
        const { svg } = await mermaid.render(id, node.attrs.code);

        if (!isCancelled) {
          // Sanitize SVG while allowing foreignObject and its HTML container elements so node labels render
          const sanitized = DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true, html: true },
            ADD_TAGS: ['foreignObject'],
            ADD_ATTR: ['dominant-baseline'],
          });
          setSvgHtml(sanitized || svg);
          setRenderError(null);
        }
      } catch (err: any) {
        if (!isCancelled) {
          setRenderError(err?.message || 'Mermaid diagram syntax error');
          setSvgHtml('');
        }
      } finally {
        if (!isCancelled) setIsRendering(false);
      }
    }

    renderDiagram();
    return () => {
      isCancelled = true;
    };
  }, [node.attrs.code]);

  const handleSave = () => {
    updateAttributes({ code: codeText.trim() });
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
            <GitGraph className="w-3.5 h-3.5 text-accent" />
            <span>Architecture Diagram (Mermaid)</span>
          </div>
          <button
            type="button"
            onClick={() => (isEditing ? handleSave() : setIsEditing(true))}
            className="flex items-center gap-1 text-[11px] text-accent hover:underline px-2 py-0.5 rounded hover:bg-canvas"
          >
            {isEditing ? (
              <>
                <Check className="w-3 h-3 text-status-success" />
                <span className="font-semibold text-status-success">Apply Changes</span>
              </>
            ) : (
              <>
                <Edit3 className="w-3 h-3" />
                <span>Edit Diagram Code</span>
              </>
            )}
          </button>
        </div>

        {isEditing ? (
          <div className="space-y-2">
            <textarea
              value={codeText}
              onChange={(e) => setCodeText(e.target.value)}
              placeholder="e.g. graph TD; A-->B;"
              rows={6}
              className="w-full font-mono text-xs px-3 py-2 rounded-lg bg-canvas border border-border text-foreground focus:outline-none focus:border-accent resize-y"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleSave();
                }
              }}
            />
            <div className="flex items-center justify-between text-[10px] text-text-muted">
              <span>Supports flowcharts, sequence diagrams, state charts, class diagrams</span>
              <button
                type="button"
                onClick={handleSave}
                className="px-2.5 py-1 rounded bg-accent text-white font-medium text-xs shadow-xs"
              >
                Save & Render
              </button>
            </div>
          </div>
        ) : isRendering ? (
          <div className="py-8 flex flex-col items-center justify-center text-text-muted text-xs gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-accent" />
            <span>Rendering architecture diagram...</span>
          </div>
        ) : renderError ? (
          <div className="p-3 rounded-lg bg-status-danger/10 border border-status-danger/20 text-status-danger text-xs font-mono space-y-1">
            <div className="font-semibold">Diagram Syntax Error</div>
            <div className="text-[11px]">{renderError}</div>
          </div>
        ) : (
          <div
            ref={containerRef}
            className="overflow-x-auto py-3 flex justify-center text-foreground [&_svg]:max-w-full [&_svg]:h-auto"
            dangerouslySetInnerHTML={{ __html: svgHtml }}
          />
        )}
      </div>
    </NodeViewWrapper>
  );
};

export const MermaidBlock = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      code: {
        default: 'graph TD\n  Client[Web Browser] -->|REST / WS| Gateway[API Gateway]\n  Gateway --> Service[Core Services]\n  Service --> Database[(PostgreSQL)]',
        parseHTML: (el) => el.getAttribute('data-code') || '',
        renderHTML: (attrs) => ({ 'data-code': attrs.code }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="mermaid-block"]',
        getAttrs: (el) => {
          if (typeof el === 'string') return false;
          return {
            code: el.getAttribute('data-code') || '',
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'mermaid-block' }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidComponent as any);
  },
});
