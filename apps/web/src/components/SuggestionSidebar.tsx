import React from 'react';
import type { ActiveSuggestionInfo } from './SuggestionActionMenu.js';
import { Bot, Check, X, CheckCheck, XCircle } from 'lucide-react';

export interface SuggestionSidebarProps {
  suggestions: ActiveSuggestionInfo[];
  onAccept: (suggestion: ActiveSuggestionInfo) => void;
  onReject: (suggestion: ActiveSuggestionInfo) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onSelect: (suggestion: ActiveSuggestionInfo) => void;
}

export const SuggestionSidebar: React.FC<SuggestionSidebarProps> = ({
  suggestions,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
  onSelect,
}) => {
  return (
    <div className="w-80 border-l border-border bg-surface flex flex-col h-full text-foreground">
      <div className="p-3.5 border-b border-border flex justify-between items-center">
        <div className="flex items-center gap-1.5 font-semibold text-xs">
          <Bot size={15} className="text-agent" />
          <span>AI Suggestions ({suggestions.length})</span>
        </div>

        {suggestions.length > 0 && (
          <div className="flex gap-1.5">
            <button
              onClick={onAcceptAll}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold bg-status-success/15 text-status-success border border-status-success/30 rounded-lg transition-colors hover:bg-status-success/25"
              title="Accept All Suggestions"
            >
              <CheckCheck size={12} /> All
            </button>
            <button
              onClick={onRejectAll}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold bg-status-danger/15 text-status-danger border border-status-danger/30 rounded-lg transition-colors hover:bg-status-danger/25"
              title="Reject All Suggestions"
            >
              <XCircle size={12} /> All
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {suggestions.length === 0 ? (
          <div className="text-text-muted text-center py-8 text-xs">
            No pending AI suggestions in this document.
          </div>
        ) : (
          suggestions.map((s) => (
            <div
              key={s.id}
              onClick={() => onSelect(s)}
              className={`p-3 rounded-xl border cursor-pointer transition-all ${
                s.type === 'insert'
                  ? 'border-[#86efac] dark:border-[#204a32] bg-[#DDF3E4]/70 dark:bg-[#173524]/60 hover:border-status-success'
                  : 'border-[#fca5a5] dark:border-[#542727] bg-[#FBE3E0]/70 dark:bg-[#3B1D1D]/60 hover:border-status-danger'
              }`}
            >
              <div className="flex justify-between items-center mb-1.5">
                <span
                  className={`font-bold text-[10px] uppercase tracking-wider ${
                    s.type === 'insert' ? 'text-[#14532D] dark:text-[#B7F0CB]' : 'text-[#7A1D14] dark:text-[#F9B8B2]'
                  }`}
                >
                  {s.type}
                </span>
                <span className="text-text-secondary text-[11px] font-medium">{s.agentId}</span>
              </div>

              <div
                className={`font-mono text-xs mb-2.5 break-all ${
                  s.type === 'insert'
                    ? 'text-[#14532D] dark:text-[#B7F0CB] underline underline-offset-2'
                    : 'text-[#7A1D14] dark:text-[#F9B8B2] line-through'
                }`}
              >
                "{s.text}"
              </div>

              <div className="flex justify-end gap-1.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAccept(s);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-status-success hover:opacity-90 text-white rounded-lg transition-colors shadow-sm"
                >
                  <Check size={11} /> Accept
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onReject(s);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-status-danger hover:opacity-90 text-white rounded-lg transition-colors shadow-sm"
                >
                  <X size={11} /> Reject
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
