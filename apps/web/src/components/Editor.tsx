import React, { useState, useEffect, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import * as Y from 'yjs';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { SuggestionInsert, SuggestionDelete } from '../extensions/suggestion.js';
import { Alert } from '../extensions/alert.js';
import { Collaboration } from '../extensions/collab.js';
import { AwarenessBar } from './AwarenessBar.js';
import { SuggestionActionMenu, type ActiveSuggestionInfo } from './SuggestionActionMenu.js';
import { SuggestionSidebar } from './SuggestionSidebar.js';
import { acceptSuggestion, rejectSuggestion } from '@enterprise-blogger/shared';
import {
  Bold,
  Italic,
  Code,
  Heading1,
  Heading2,
  List,
  AlertCircle,
  Sparkles,
} from 'lucide-react';

export interface CollaborativeEditorProps {
  ydoc: Y.Doc;
  provider?: HocuspocusProvider;
  user?: {
    name: string;
    color: string;
    role?: string;
  };
  onDocChange?: (json: any) => void;
  onEditorReady?: (editor: any) => void;
  hideSidebar?: boolean;
}

export const CollaborativeEditor: React.FC<CollaborativeEditorProps> = ({
  ydoc,
  provider,
  user,
  onDocChange,
  onEditorReady,
  hideSidebar = false,
}) => {
  const fragment = ydoc.getXmlFragment('prosemirror');

  const [activeSuggestion, setActiveSuggestion] = useState<ActiveSuggestionInfo | null>(null);
  const [allSuggestions, setAllSuggestions] = useState<ActiveSuggestionInfo[]>([]);

  // Detect if cursor is currently within a suggestion mark
  const detectActiveSuggestion = useCallback((ed: any) => {
    if (!ed || !ed.state) return;
    const { from, to } = ed.state.selection;
    let found: ActiveSuggestionInfo | null = null;

    ed.state.doc.nodesBetween(from, to, (node: any, pos: number) => {
      if (!node.isText) return;
      const insertMark = node.marks.find((m: any) => m.type.name === 'suggestion_insert');
      const deleteMark = node.marks.find((m: any) => m.type.name === 'suggestion_delete');

      if (insertMark) {
        found = {
          type: 'insert',
          id: insertMark.attrs.id || String(pos),
          agentId: insertMark.attrs.agentId || 'AI Agent',
          tokenId: insertMark.attrs.tokenId,
          ownerUserId: insertMark.attrs.ownerUserId,
          timestamp: insertMark.attrs.timestamp,
          from: pos,
          to: pos + node.nodeSize,
          text: node.text || '',
        };
      } else if (deleteMark) {
        found = {
          type: 'delete',
          id: deleteMark.attrs.id || String(pos),
          agentId: deleteMark.attrs.agentId || 'AI Agent',
          tokenId: deleteMark.attrs.tokenId,
          ownerUserId: deleteMark.attrs.ownerUserId,
          timestamp: deleteMark.attrs.timestamp,
          from: pos,
          to: pos + node.nodeSize,
          text: node.text || '',
        };
      }
    });

    setActiveSuggestion(found);
  }, []);

  // Collect all suggestions across the entire document
  const scanSuggestions = useCallback((ed: any) => {
    if (!ed || !ed.state) return;
    const list: ActiveSuggestionInfo[] = [];

    ed.state.doc.descendants((node: any, pos: number) => {
      if (!node.isText) return;

      const insertMark = node.marks.find((m: any) => m.type.name === 'suggestion_insert');
      const deleteMark = node.marks.find((m: any) => m.type.name === 'suggestion_delete');

      if (insertMark) {
        list.push({
          type: 'insert',
          id: insertMark.attrs.id || String(pos),
          agentId: insertMark.attrs.agentId || 'AI Agent',
          tokenId: insertMark.attrs.tokenId,
          ownerUserId: insertMark.attrs.ownerUserId,
          timestamp: insertMark.attrs.timestamp,
          from: pos,
          to: pos + node.nodeSize,
          text: node.text || '',
        });
      } else if (deleteMark) {
        list.push({
          type: 'delete',
          id: deleteMark.attrs.id || String(pos),
          agentId: deleteMark.attrs.agentId || 'AI Agent',
          tokenId: deleteMark.attrs.tokenId,
          ownerUserId: deleteMark.attrs.ownerUserId,
          timestamp: deleteMark.attrs.timestamp,
          from: pos,
          to: pos + node.nodeSize,
          text: node.text || '',
        });
      }
    });

    setAllSuggestions(list);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // CRITICAL: Disable ProseMirror default history/undo-redo plugin to allow Yjs UndoManager isolation!
        undoRedo: false,
      }),
      SuggestionInsert,
      SuggestionDelete,
      Alert,
      Collaboration.configure({
        fragment,
        provider,
        user,
      }),
    ],
    editorProps: {
      attributes: {
        class: 'enterprise-editor-content w-full focus:outline-none',
      },
    },
    onUpdate: ({ editor }) => {
      onDocChange?.(editor.getJSON());
      scanSuggestions(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      detectActiveSuggestion(editor);
    },
  });

  useEffect(() => {
    if (editor) {
      onEditorReady?.(editor);
      scanSuggestions(editor);
    }
  }, [editor, onEditorReady, scanSuggestions]);

  // Suggestion Acceptance Lifecycle using genuine @enterprise-blogger/shared lifecycle
  const handleAccept = (sug: ActiveSuggestionInfo) => {
    if (!editor) return;
    try {
      acceptSuggestion(ydoc, sug.id, user?.name || 'human', 'prosemirror');
    } catch {
      if (sug.type === 'insert') {
        editor
          .chain()
          .focus()
          .setTextSelection({ from: sug.from, to: sug.to })
          .unsetMark('suggestion_insert')
          .run();
      } else {
        editor
          .chain()
          .focus()
          .deleteRange({ from: sug.from, to: sug.to })
          .run();
      }
    }

    setActiveSuggestion(null);
    scanSuggestions(editor);
  };

  // Suggestion Rejection Lifecycle using genuine @enterprise-blogger/shared lifecycle
  const handleReject = (sug: ActiveSuggestionInfo) => {
    if (!editor) return;
    try {
      rejectSuggestion(ydoc, sug.id, user?.name || 'human', 'prosemirror');
    } catch {
      if (sug.type === 'insert') {
        editor
          .chain()
          .focus()
          .deleteRange({ from: sug.from, to: sug.to })
          .run();
      } else {
        editor
          .chain()
          .focus()
          .setTextSelection({ from: sug.from, to: sug.to })
          .unsetMark('suggestion_delete')
          .run();
      }
    }

    setActiveSuggestion(null);
    scanSuggestions(editor);
  };

  const handleAcceptAll = () => {
    ydoc.transact(() => {
      allSuggestions.forEach((sug) => {
        try {
          acceptSuggestion(ydoc, sug.id, user?.name || 'human', 'prosemirror');
        } catch {
          handleAccept(sug);
        }
      });
    }, { origin: 'human', userId: user?.name || 'human', action: 'acceptAll' });
    setActiveSuggestion(null);
    if (editor) scanSuggestions(editor);
  };

  const handleRejectAll = () => {
    ydoc.transact(() => {
      allSuggestions.forEach((sug) => {
        try {
          rejectSuggestion(ydoc, sug.id, user?.name || 'human', 'prosemirror');
        } catch {
          handleReject(sug);
        }
      });
    }, { origin: 'human', userId: user?.name || 'human', action: 'rejectAll' });
    setActiveSuggestion(null);
    if (editor) scanSuggestions(editor);
  };

  const handleSelectSuggestion = (sug: ActiveSuggestionInfo) => {
    if (!editor) return;
    editor.chain().focus().setTextSelection({ from: sug.from, to: sug.to }).run();
    setActiveSuggestion(sug);
  };

  if (!editor) return null;

  return (
    <div className="flex flex-col h-full bg-canvas text-foreground">
      {/* Awareness bar showing connected users and AI agents */}
      <AwarenessBar provider={provider} />

      {/* Editor toolbar */}
      <div className="flex items-center gap-1.5 px-4 py-2 bg-surface border-b border-border">
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className="p-1.5 rounded-lg border border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated transition-colors"
          title="Bold"
        >
          <Bold size={14} />
        </button>

        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className="p-1.5 rounded-lg border border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated transition-colors"
          title="Italic"
        >
          <Italic size={14} />
        </button>

        <button
          onClick={() => editor.chain().focus().toggleCode().run()}
          className="p-1.5 rounded-lg border border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated transition-colors"
          title="Code"
        >
          <Code size={14} />
        </button>

        <span className="text-border mx-1">|</span>

        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className="p-1.5 rounded-lg border border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated transition-colors"
          title="Heading 1"
        >
          <Heading1 size={14} />
        </button>

        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className="p-1.5 rounded-lg border border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated transition-colors"
          title="Heading 2"
        >
          <Heading2 size={14} />
        </button>

        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className="p-1.5 rounded-lg border border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated transition-colors"
          title="Bullet List"
        >
          <List size={14} />
        </button>

        <span className="text-border mx-1">|</span>

        {/* Suggestion Mode Status Indicator - strictly violet for AI agents */}
        <div className="ml-auto inline-flex items-center gap-1.5 text-xs text-agent bg-agent/10 border border-agent/25 px-2.5 py-1 rounded-full font-semibold">
          <Sparkles size={13} />
          <span>Agent Suggestion Engine Active</span>
        </div>
      </div>

      {/* Floating Suggestion Action Menu */}
      {activeSuggestion && (
        <div className="px-4 py-2 bg-elevated border-b border-border shadow-sm">
          <SuggestionActionMenu
            editor={editor}
            activeSuggestion={activeSuggestion}
            onAccept={handleAccept}
            onReject={handleReject}
          />
        </div>
      )}

      {/* Main workspace layout: Editor canvas centered on paper surface + Suggestion sidebar */}
      <div className="flex flex-1 overflow-hidden bg-canvas min-w-0">
        <div className="flex-1 overflow-y-auto p-4 sm:p-8 flex justify-center min-w-0">
          <div className="w-full max-w-[780px] min-h-[700px] h-fit bg-surface border border-border rounded-2xl p-6 sm:p-10 shadow-sm text-foreground focus-within:border-accent-main/40 transition-colors my-2">
            <EditorContent editor={editor} className="w-full max-w-full" />
          </div>
        </div>

        {!hideSidebar && (
          <SuggestionSidebar
            suggestions={allSuggestions}
            onAccept={handleAccept}
            onReject={handleReject}
            onAcceptAll={handleAcceptAll}
            onRejectAll={handleRejectAll}
            onSelect={handleSelectSuggestion}
          />
        )}
      </div>
    </div>
  );
};
