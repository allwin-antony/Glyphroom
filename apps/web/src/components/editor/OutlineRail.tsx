import React, { useState, useEffect, useCallback } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  ListTree 
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';
import { cn } from '../../lib/utils.js';

export interface HeadingItem {
  id: string;
  text: string;
  level: 1 | 2 | 3;
  pos: number;
}

export interface OutlineRailProps {
  editor: any | null;
  className?: string;
  defaultCollapsed?: boolean;
}

export const OutlineRail: React.FC<OutlineRailProps> = ({
  editor,
  className,
  defaultCollapsed = false,
}) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [headings, setHeadings] = useState<HeadingItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Extract H1–H3 headings from ProseMirror doc
  const scanHeadings = useCallback(() => {
    if (!editor || !editor.state) {
      setHeadings([]);
      return;
    }
    const items: HeadingItem[] = [];
    const { doc } = editor.state;

    doc.descendants((node: any, pos: number) => {
      if (node.type.name === 'heading') {
        const level = node.attrs.level;
        if (level >= 1 && level <= 3) {
          items.push({
            id: `heading-${pos}`,
            text: node.textContent.trim() || 'Untitled Section',
            level: level as 1 | 2 | 3,
            pos,
          });
        }
      }
    });

    setHeadings(items);

    // Compute active heading based on selection
    const selPos = editor.state.selection.from;
    let currentActive: string | null = null;
    for (const h of items) {
      if (h.pos <= selPos) {
        currentActive = h.id;
      } else {
        break;
      }
    }
    setActiveId(currentActive || items[0]?.id || null);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    scanHeadings();
    editor.on('update', scanHeadings);
    editor.on('selectionUpdate', scanHeadings);

    return () => {
      editor.off('update', scanHeadings);
      editor.off('selectionUpdate', scanHeadings);
    };
  }, [editor, scanHeadings]);

  // Jump navigation with smooth scroll and focus
  const handleJump = (item: HeadingItem) => {
    if (!editor) return;

    const targetPos = Math.min(item.pos + 1, editor.state.doc.content.size);
    editor.chain().focus().setTextSelection(targetPos).run();

    try {
      const domNode = editor.view?.nodeDOM?.(item.pos);
      const targetElement =
        domNode instanceof HTMLElement
          ? domNode
          : (editor.view?.domAtPos?.(targetPos)?.node?.parentElement as HTMLElement | null);

      if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        targetElement.classList.add('outline-highlight-jump');
        setTimeout(() => {
          targetElement.classList.remove('outline-highlight-jump');
        }, 1200);
      }
    } catch {
      // Fallback if DOM node is unavailable in test environment
    }

    setActiveId(item.id);
  };

  if (collapsed) {
    return (
      <aside 
        aria-label="Document Outline"
        className={cn(
          "w-12 border-r border-border bg-surface/60 flex flex-col items-center py-4 transition-all duration-200 shrink-0",
          className
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setCollapsed(false)}
              className="p-2 rounded-lg text-text-muted hover:text-foreground hover:bg-elevated transition-colors"
              aria-label="Expand document outline"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Expand Outline ({headings.length} headings)</TooltipContent>
        </Tooltip>

        <div className="mt-4 flex flex-col items-center gap-1.5 opacity-60">
          <ListTree className="w-4 h-4 text-text-muted" />
          <span className="text-[10px] font-mono font-semibold">{headings.length}</span>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Document Outline"
      className={cn(
        "w-60 border-r border-border bg-surface/40 flex flex-col h-full transition-all duration-200 shrink-0 select-none",
        className
      )}
    >
      <div className="h-10 px-3 border-b border-border flex items-center justify-between bg-surface/70">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-secondary">
          <ListTree className="w-3.5 h-3.5" />
          <span>Outline</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-elevated font-mono text-text-muted">
            {headings.length}
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setCollapsed(true)}
              className="p-1 rounded text-text-muted hover:text-foreground hover:bg-elevated transition-colors"
              aria-label="Collapse document outline"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Collapse Outline</TooltipContent>
        </Tooltip>
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {headings.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-text-muted italic">
            No headings yet.<br />Add H1, H2, or H3 to navigate.
          </div>
        ) : (
          headings.map((h) => {
            const isActive = activeId === h.id;
            return (
              <button
                key={h.id}
                onClick={() => handleJump(h)}
                className={cn(
                  "w-full text-left rounded-md py-1.5 pr-2 transition-all text-xs truncate flex items-center gap-1.5",
                  h.level === 1 && "pl-2 font-medium text-foreground",
                  h.level === 2 && "pl-5 text-text-secondary font-normal",
                  h.level === 3 && "pl-8 text-text-muted text-[11px] font-normal",
                  isActive
                    ? "bg-primary/10 text-primary font-semibold border-l-2 border-primary"
                    : "hover:bg-elevated hover:text-foreground"
                )}
                title={h.text}
              >
                <span className="opacity-40 text-[10px] font-mono shrink-0">H{h.level}</span>
                <span className="truncate">{h.text}</span>
              </button>
            );
          })
        )}
      </nav>
    </aside>
  );
};
