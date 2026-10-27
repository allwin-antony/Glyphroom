import { usePluginSlashCommands } from '../../plugins/PluginProvider.js';
import { SlotRenderer } from '../plugins/SlotRenderer.js';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Table, 
  CheckSquare, 
  Flag, 
  GitGraph, 
  Sigma, 
  Code, 
  Heading1, 
  Heading2, 
  Heading3, 
  List, 
  ListOrdered, 
  Minus, 
  AlertCircle,
  HelpCircle,
  Sparkles,
  Paperclip
} from 'lucide-react';

export interface SlashMenuItem {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  group: 'Basic' | 'Structure & Tables' | 'Project & Technical' | 'Alerts';
  action: (editor: any) => void;
}

export interface SlashMenuProps {
  editor: any;
  isOpen: boolean;
  position: { top: number; left: number };
  onClose: () => void;
  onUploadAttachment?: () => void;
  onOpenTemplates?: () => void;
}

export const SlashMenu: React.FC<SlashMenuProps> = ({
  editor,
  isOpen,
  position,
  onClose,
  onUploadAttachment,
  onOpenTemplates,
}) => {
  const pluginCommands = usePluginSlashCommands();
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const menuItems: SlashMenuItem[] = useMemo(() => [
    // 1. Structure & Tables
    {
      id: 'table',
      title: 'Table',
      description: 'Insert a 3x3 data table with headers',
      icon: Table,
      group: 'Structure & Tables',
      action: (ed) => ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    {
      id: 'task-list',
      title: 'Task Checklist',
      description: 'Interactive to-do checklist with assignees',
      icon: CheckSquare,
      group: 'Structure & Tables',
      action: (ed) => ed.chain().focus().toggleTaskList().run(),
    },
    {
      id: 'bullet-list',
      title: 'Bullet List',
      description: 'Standard bulleted list',
      icon: List,
      group: 'Structure & Tables',
      action: (ed) => ed.chain().focus().toggleBulletList().run(),
    },
    {
      id: 'ordered-list',
      title: 'Numbered List',
      description: 'Sequential numbered list',
      icon: ListOrdered,
      group: 'Structure & Tables',
      action: (ed) => ed.chain().focus().toggleOrderedList().run(),
    },

    // 2. Project & Technical
    {
      id: 'status-block',
      title: 'Project Status Block',
      description: 'Milestone progress, RAG pulse, and blocker tracker',
      icon: Flag,
      group: 'Project & Technical',
      action: (ed) => ed.chain().focus().insertContent({ type: 'projectStatusBlock' }).run(),
    },
    {
      id: 'mermaid',
      title: 'Mermaid Diagram',
      description: 'Flowchart, sequence, or architecture chart',
      icon: GitGraph,
      group: 'Project & Technical',
      action: (ed) => ed.chain().focus().insertContent({ type: 'mermaidBlock' }).run(),
    },
    {
      id: 'katex',
      title: 'Math Formula',
      description: 'LaTeX mathematical expression with KaTeX',
      icon: Sigma,
      group: 'Project & Technical',
      action: (ed) => ed.chain().focus().insertContent({ type: 'mathBlock' }).run(),
    },
    {
      id: 'code-block',
      title: 'Code Block',
      description: 'Syntax-highlighted code block',
      icon: Code,
      group: 'Project & Technical',
      action: (ed) => ed.chain().focus().toggleCodeBlock().run(),
    },
    {
      id: 'attachment',
      title: 'File / Image Attachment',
      description: 'Attach file or image (max 25MB, scan-verified)',
      icon: Paperclip,
      group: 'Project & Technical',
      action: () => {
        onUploadAttachment?.();
      },
    },
    {
      id: 'template',
      title: 'Scaffold Template',
      description: 'Scaffold status pulse, RFC, postmortem, runbook, or test plan',
      icon: Sparkles,
      group: 'Project & Technical',
      action: () => {
        onOpenTemplates?.();
      },
    },

    // 3. Headings & Basic
    {
      id: 'h1',
      title: 'Heading 1',
      description: 'Large chapter title',
      icon: Heading1,
      group: 'Basic',
      action: (ed) => ed.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      id: 'h2',
      title: 'Heading 2',
      description: 'Major section heading',
      icon: Heading2,
      group: 'Basic',
      action: (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      id: 'h3',
      title: 'Heading 3',
      description: 'Sub-section header',
      icon: Heading3,
      group: 'Basic',
      action: (ed) => ed.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      id: 'divider',
      title: 'Horizontal Divider',
      description: 'Visual separation rule',
      icon: Minus,
      group: 'Basic',
      action: (ed) => ed.chain().focus().setHorizontalRule().run(),
    },

    // 4. Alerts
    {
      id: 'alert-note',
      title: 'Note Callout',
      description: 'Helpful background context and tips',
      icon: AlertCircle,
      group: 'Alerts',
      action: (ed) => ed.chain().focus().insertContent({ type: 'alert', attrs: { type: 'note' } }).run(),
    },
    {
      id: 'alert-tip',
      title: 'Tip Callout',
      description: 'Best practices and recommendations',
      icon: Sparkles,
      group: 'Alerts',
      action: (ed) => ed.chain().focus().insertContent({ type: 'alert', attrs: { type: 'tip' } }).run(),
    },
    {
      id: 'alert-warning',
      title: 'Warning Callout',
      description: 'Deprecation and breaking change alerts',
      icon: AlertCircle,
      group: 'Alerts',
      action: (ed) => ed.chain().focus().insertContent({ type: 'alert', attrs: { type: 'warning' } }).run(),
    },
  ], []);

  const filteredItems = useMemo(() => {
    if (!search.trim()) return menuItems;
    const q = search.toLowerCase();
    return menuItems.filter(
      (item) => item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
    );
  }, [menuItems, search]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          filteredItems[selectedIndex].action(editor);
          onClose();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredItems, selectedIndex, editor, onClose]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        top: Math.min(window.innerHeight - 360, Math.max(16, position.top)),
        left: Math.min(window.innerWidth - 300, Math.max(16, position.left)),
      }}
      className="z-50 w-72 rounded-xl bg-elevated border border-border shadow-2xl overflow-hidden flex flex-col text-foreground animate-in fade-in-50 zoom-in-95"
    >
      <div className="p-2 border-b border-border bg-surface">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter commands... (Type to search)"
          className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-canvas border border-border text-foreground focus:outline-none focus:border-accent"
        />
      </div>

      <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
        {filteredItems.length === 0 ? (
          <div className="p-4 text-center text-xs text-text-muted">No matching blocks found</div>
        ) : (
          filteredItems.map((item, idx) => {
            const Icon = item.icon;
            const isSelected = idx === selectedIndex;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  item.action(editor);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                  isSelected ? 'bg-accent-bg text-accent' : 'hover:bg-canvas text-foreground'
                }`}
              >
                <div className={`p-1 rounded-md shrink-0 mt-0.5 ${isSelected ? 'bg-accent text-white' : 'bg-canvas text-text-muted'}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-xs truncate">{item.title}</div>
                  <div className="text-[10px] text-text-muted truncate">{item.description}</div>
                </div>
              </button>
            );
          })
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-border bg-surface text-[10px] text-text-muted flex items-center justify-between">
        <span>↑↓ Navigate</span>
        <span>↵ Select</span>
        <span>Esc Dismiss</span>
      </div>
      <SlotRenderer slot="editor:slash:commands" context={{ editor }} />
    </div>
  );
};
