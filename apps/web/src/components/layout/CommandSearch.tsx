import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.js';
import {
  Search,
  Home,
  BookOpen,
  FolderGit2,
  CheckSquare,
  Sliders,
  Settings,
  PlusCircle,
  Shield,
  X,
  CornerDownLeft,
} from 'lucide-react';

export interface CommandSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CommandItem {
  id: string;
  category: 'Navigation' | 'Actions' | 'Governance';
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  action: () => void;
  keywords: string[];
  requiredRoles?: Array<'admin' | 'moderator' | 'author' | 'reader'>;
}

export const CommandSearch: React.FC<CommandSearchProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Command Registry
  const commands: CommandItem[] = useMemo(
    () => [
      {
        id: 'nav-home',
        category: 'Navigation',
        title: 'Home Dashboard',
        description: 'View pinned articles and pending activity',
        icon: Home,
        keywords: ['home', 'dashboard', 'overview'],
        action: () => navigate('/'),
      },
      {
        id: 'nav-catalog',
        category: 'Navigation',
        title: 'Browse Catalog',
        description: 'Explore all published enterprise articles',
        icon: BookOpen,
        keywords: ['catalog', 'posts', 'articles', 'search', 'coe'],
        action: () => navigate('/catalog'),
      },
      {
        id: 'nav-my-work',
        category: 'Navigation',
        title: 'My Work',
        description: 'Manage your drafts, submissions, and pending suggestions',
        icon: FolderGit2,
        keywords: ['my work', 'drafts', 'submissions', 'author'],
        action: () => navigate('/my-work'),
      },
      {
        id: 'nav-reviews',
        category: 'Governance',
        title: 'Review Queue',
        description: 'Moderate pending post submissions and compare diffs',
        icon: CheckSquare,
        keywords: ['reviews', 'moderator', 'approvals', 'queue'],
        requiredRoles: ['moderator', 'admin'],
        action: () => navigate('/reviews'),
      },
      {
        id: 'nav-admin',
        category: 'Governance',
        title: 'Admin Console',
        description: 'Manage users, personal access tokens, and verify SHA-256 audit chain',
        icon: Sliders,
        keywords: ['admin', 'users', 'tokens', 'pats', 'audit', 'integrity'],
        requiredRoles: ['admin'],
        action: () => navigate('/admin'),
      },
      {
        id: 'nav-settings',
        category: 'Navigation',
        title: 'Personal Settings',
        description: 'Configure your profile and generate API tokens',
        icon: Settings,
        keywords: ['settings', 'preferences', 'profile', 'tokens'],
        action: () => navigate('/settings'),
      },
      {
        id: 'act-new-post',
        category: 'Actions',
        title: 'Create New Post',
        description: 'Start a collaborative draft in TipTap editor',
        icon: PlusCircle,
        keywords: ['new', 'create', 'write', 'post', 'draft'],
        action: () => navigate('/posts/new'),
      },
      {
        id: 'act-audit-verify',
        category: 'Governance',
        title: 'Verify Audit Chain Integrity',
        description: 'Run cryptographic SHA-256 hash chain verification',
        icon: Shield,
        keywords: ['audit', 'verify', 'sha256', 'cryptographic', 'security'],
        requiredRoles: ['admin'],
        action: () => navigate('/admin?tab=audit&action=verify'),
      },
    ],
    [navigate]
  );

  // Filter commands by query and user role
  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    return commands.filter((cmd) => {
      // Role check
      if (cmd.requiredRoles && (!user || !cmd.requiredRoles.includes(user.role))) {
        return false;
      }
      if (!q) return true;
      return (
        cmd.title.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q) ||
        cmd.keywords.some((k) => k.toLowerCase().includes(q))
      );
    });
  }, [commands, query, user]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1 < filteredCommands.length ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : filteredCommands.length - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].action();
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredCommands, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div
        className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
          <Search className="w-5 h-5 text-sky-500 dark:text-sky-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command or search platform features..."
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-1 rounded text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-mono text-slate-500 dark:text-slate-400">
            ESC
          </kbd>
        </div>

        {/* Command List */}
        <div ref={listRef} className="max-h-96 overflow-y-auto p-2 space-y-1">
          {filteredCommands.length === 0 ? (
            <div className="py-12 text-center text-slate-400 dark:text-slate-500 text-xs">
              No matching commands found for <span className="text-slate-700 dark:text-slate-300">"{query}"</span>.
            </div>
          ) : (
            filteredCommands.map((cmd, idx) => {
              const Icon = cmd.icon;
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={cmd.id}
                  onClick={() => {
                    cmd.action();
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-sky-50 dark:bg-sky-500/10 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-500/30'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`p-2 rounded-lg ${
                        isSelected
                          ? 'bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate flex items-center gap-2">
                        <span>{cmd.title}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 uppercase font-mono">
                          {cmd.category}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{cmd.description}</div>
                    </div>
                  </div>

                  {isSelected && (
                    <CornerDownLeft className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 ml-2" />
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Modal Keyboard Footer */}
        <div className="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-400 font-mono text-[10px]">
                ↑
              </kbd>{' '}
              <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-400 font-mono text-[10px]">
                ↓
              </kbd>{' '}
              to navigate
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-400 font-mono text-[10px]">
                ↵
              </kbd>{' '}
              to select
            </span>
          </div>
          <span>Enterprise Search Engine</span>
        </div>
      </div>
    </div>
  );
};
