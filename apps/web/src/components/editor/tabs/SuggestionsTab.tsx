import React, { useState, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { Bot, CheckCheck, XCircle, Sparkles } from 'lucide-react';
import { acceptSuggestion, rejectSuggestion } from '@enterprise-blogger/shared';
import { SuggestionItem, type SuggestionItemData } from '../SuggestionItem.js';

export interface SuggestionsTabProps {
  ydoc: Y.Doc;
  editor: any | null;
  currentUser: {
    userId: string;
    fullName?: string;
    name?: string;
  };
}

export const SuggestionsTab: React.FC<SuggestionsTabProps> = ({
  ydoc,
  editor,
  currentUser,
}) => {
  const [suggestions, setSuggestions] = useState<SuggestionItemData[]>([]);

  const scanSuggestions = useCallback(() => {
    if (!editor || !editor.state) {
      setSuggestions([]);
      return;
    }

    const map = new Map<string, SuggestionItemData>();
    const { doc } = editor.state;

    doc.descendants((node: any, pos: number) => {
      if (!node.isText) return;

      const insertMark = node.marks.find((m: any) => m.type.name === 'suggestion_insert');
      const deleteMark = node.marks.find((m: any) => m.type.name === 'suggestion_delete');

      if (insertMark) {
        const id = insertMark.attrs.id || String(pos);
        const existing = map.get(id);
        if (existing) {
          if (existing.type === 'delete') {
            existing.type = 'replace';
            existing.originalText = existing.text;
            existing.text = node.text || '';
            existing.to = Math.max(existing.to, pos + node.nodeSize);
          } else {
            existing.text += node.text || '';
            existing.to = Math.max(existing.to, pos + node.nodeSize);
          }
        } else {
          map.set(id, {
            id,
            type: 'insert',
            agentId: insertMark.attrs.agentId || 'AI Agent',
            tokenId: insertMark.attrs.tokenId,
            ownerUserId: insertMark.attrs.ownerUserId,
            timestamp: insertMark.attrs.timestamp,
            from: pos,
            to: pos + node.nodeSize,
            text: node.text || '',
          });
        }
      } else if (deleteMark) {
        const id = deleteMark.attrs.id || String(pos);
        const existing = map.get(id);
        if (existing) {
          if (existing.type === 'insert') {
            existing.type = 'replace';
            existing.originalText = node.text || '';
            existing.from = Math.min(existing.from, pos);
          } else {
            existing.text += node.text || '';
            existing.to = Math.max(existing.to, pos + node.nodeSize);
          }
        } else {
          map.set(id, {
            id,
            type: 'delete',
            agentId: deleteMark.attrs.agentId || 'AI Agent',
            tokenId: deleteMark.attrs.tokenId,
            ownerUserId: deleteMark.attrs.ownerUserId,
            timestamp: deleteMark.attrs.timestamp,
            from: pos,
            to: pos + node.nodeSize,
            text: node.text || '',
          });
        }
      }
    });

    setSuggestions(Array.from(map.values()));
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    scanSuggestions();
    editor.on('update', scanSuggestions);

    return () => {
      editor.off('update', scanSuggestions);
    };
  }, [editor, scanSuggestions]);

  const handleAccept = (sug: SuggestionItemData) => {
    try {
      acceptSuggestion(ydoc, sug.id, currentUser.userId || 'human', 'prosemirror');
    } catch (e) {
      console.warn('acceptSuggestion fallback:', e);
      if (editor) {
        if (sug.type === 'insert') {
          editor.chain().focus().setTextSelection({ from: sug.from, to: sug.to }).unsetMark('suggestion_insert').run();
        } else {
          editor.chain().focus().deleteRange({ from: sug.from, to: sug.to }).run();
        }
      }
    }
    if (editor) scanSuggestions();
  };

  const handleReject = (sug: SuggestionItemData) => {
    try {
      rejectSuggestion(ydoc, sug.id, currentUser.userId || 'human', 'prosemirror');
    } catch (e) {
      console.warn('rejectSuggestion fallback:', e);
      if (editor) {
        if (sug.type === 'insert') {
          editor.chain().focus().deleteRange({ from: sug.from, to: sug.to }).run();
        } else {
          editor.chain().focus().setTextSelection({ from: sug.from, to: sug.to }).unsetMark('suggestion_delete').run();
        }
      }
    }
    if (editor) scanSuggestions();
  };

  const handleAcceptAll = () => {
    ydoc.transact(() => {
      suggestions.forEach((sug) => {
        try {
          acceptSuggestion(ydoc, sug.id, currentUser.userId || 'human', 'prosemirror');
        } catch {
          handleAccept(sug);
        }
      });
    }, { origin: 'human', userId: currentUser.userId || 'human', action: 'acceptAll' });
    if (editor) scanSuggestions();
  };

  const handleRejectAll = () => {
    ydoc.transact(() => {
      suggestions.forEach((sug) => {
        try {
          rejectSuggestion(ydoc, sug.id, currentUser.userId || 'human', 'prosemirror');
        } catch {
          handleReject(sug);
        }
      });
    }, { origin: 'human', userId: currentUser.userId || 'human', action: 'rejectAll' });
    if (editor) scanSuggestions();
  };

  const handleSelect = (sug: SuggestionItemData) => {
    if (!editor) return;
    try {
      editor.chain().focus().setTextSelection({ from: sug.from, to: sug.to }).scrollIntoView().run();
    } catch {
      // Ignore if out of bounds
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Header with counts and Batch Actions */}
      <div className="p-3 border-b border-border flex items-center justify-between bg-surface-muted/30">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
          <Bot className="w-4 h-4 text-agent" />
          <span>Pending Suggestions</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-elevated border border-border text-text-muted">
            {suggestions.length}
          </span>
        </div>

        {suggestions.length > 0 && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleRejectAll}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-status-danger hover:bg-status-danger/10 transition-colors"
              title="Reject All Suggestions"
            >
              <XCircle className="w-3 h-3" />
              <span>Reject All</span>
            </button>
            <button
              onClick={handleAcceptAll}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold text-status-success hover:bg-status-success/10 transition-colors"
              title="Accept All Suggestions"
            >
              <CheckCheck className="w-3 h-3" />
              <span>Accept All</span>
            </button>
          </div>
        )}
      </div>

      {/* Suggestion List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {suggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-text-muted px-4">
            <div className="w-10 h-10 rounded-full bg-elevated border border-border flex items-center justify-center mb-3 text-agent">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="text-xs font-semibold text-text">No pending suggestions</div>
            <p className="text-[11px] text-text-muted mt-1 max-w-[200px]">
              Suggestions generated by AI agents or editorial collaborators will appear here for review.
            </p>
          </div>
        ) : (
          suggestions.map((sug) => (
            <SuggestionItem
              key={sug.id}
              suggestion={sug}
              onAccept={handleAccept}
              onReject={handleReject}
              onSelect={handleSelect}
            />
          ))
        )}
      </div>
    </div>
  );
};
