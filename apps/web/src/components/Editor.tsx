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
}

export const CollaborativeEditor: React.FC<CollaborativeEditorProps> = ({
  ydoc,
  provider,
  user,
  onDocChange,
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
      StarterKit,
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
        class: 'enterprise-editor-content',
        style: 'outline: none; padding: 24px; min-height: 500px;',
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
      scanSuggestions(editor);
    }
  }, [editor, scanSuggestions]);

  // Suggestion Acceptance Lifecycle
  const handleAccept = (sug: ActiveSuggestionInfo) => {
    if (!editor) return;

    if (sug.type === 'insert') {
      // Accepting insert: remove suggestion_insert mark, text is kept!
      editor
        .chain()
        .focus()
        .setTextSelection({ from: sug.from, to: sug.to })
        .unsetMark('suggestion_insert')
        .run();
    } else {
      // Accepting delete: remove text permanently!
      editor
        .chain()
        .focus()
        .deleteRange({ from: sug.from, to: sug.to })
        .run();
    }

    setActiveSuggestion(null);
    scanSuggestions(editor);
  };

  // Suggestion Rejection Lifecycle
  const handleReject = (sug: ActiveSuggestionInfo) => {
    if (!editor) return;

    if (sug.type === 'insert') {
      // Rejecting insert: delete inserted text!
      editor
        .chain()
        .focus()
        .deleteRange({ from: sug.from, to: sug.to })
        .run();
    } else {
      // Rejecting delete: strip suggestion_delete mark, revert to regular text!
      editor
        .chain()
        .focus()
        .setTextSelection({ from: sug.from, to: sug.to })
        .unsetMark('suggestion_delete')
        .run();
    }

    setActiveSuggestion(null);
    scanSuggestions(editor);
  };

  const handleAcceptAll = () => {
    allSuggestions.forEach(handleAccept);
  };

  const handleRejectAll = () => {
    allSuggestions.forEach(handleReject);
  };

  const handleSelectSuggestion = (sug: ActiveSuggestionInfo) => {
    if (!editor) return;
    editor.chain().focus().setTextSelection({ from: sug.from, to: sug.to }).run();
    setActiveSuggestion(sug);
  };

  if (!editor) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Awareness bar showing connected users and AI agents */}
      <AwarenessBar provider={provider} />

      {/* Editor toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 16px',
          background: '#f8fafc',
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}
          title="Bold"
        >
          <Bold size={14} />
        </button>

        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}
          title="Italic"
        >
          <Italic size={14} />
        </button>

        <button
          onClick={() => editor.chain().focus().toggleCode().run()}
          style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}
          title="Code"
        >
          <Code size={14} />
        </button>

        <span style={{ color: '#cbd5e1' }}>|</span>

        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}
          title="Heading 1"
        >
          <Heading1 size={14} />
        </button>

        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}
          title="Heading 2"
        >
          <Heading2 size={14} />
        </button>

        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}
          title="Bullet List"
        >
          <List size={14} />
        </button>

        <span style={{ color: '#cbd5e1' }}>|</span>

        {/* Suggestion Mode Status Indicator */}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '12px',
            color: '#7c3aed',
            background: '#f5f3ff',
            padding: '4px 10px',
            borderRadius: '16px',
            border: '1px solid #ddd6fe',
          }}
        >
          <Sparkles size={14} />
          <span>Agent Suggestion Engine Active</span>
        </div>
      </div>

      {/* Floating Suggestion Action Menu */}
      {activeSuggestion && (
        <div style={{ padding: '8px 16px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
          <SuggestionActionMenu
            editor={editor}
            activeSuggestion={activeSuggestion}
            onAccept={handleAccept}
            onReject={handleReject}
          />
        </div>
      )}

      {/* Main workspace layout: Editor canvas + Suggestion sidebar */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto', background: '#ffffff' }}>
          <EditorContent editor={editor} />
        </div>

        <SuggestionSidebar
          suggestions={allSuggestions}
          onAccept={handleAccept}
          onReject={handleReject}
          onAcceptAll={handleAcceptAll}
          onRejectAll={handleRejectAll}
          onSelect={handleSelectSuggestion}
        />
      </div>
    </div>
  );
};
