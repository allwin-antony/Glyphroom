import React from 'react';
import { Check, X, Bot, Clock, Plus, Minus } from 'lucide-react';

export interface SuggestionItemData {
  id: string;
  type: 'insert' | 'delete' | 'replace';
  agentId: string;
  tokenId?: string;
  ownerUserId?: string;
  timestamp?: number;
  from: number;
  to: number;
  text: string;
  originalText?: string;
}

export interface SuggestionItemProps {
  suggestion: SuggestionItemData;
  onAccept: (suggestion: SuggestionItemData) => void;
  onReject: (suggestion: SuggestionItemData) => void;
  onSelect: (suggestion: SuggestionItemData) => void;
}

export const SuggestionItem: React.FC<SuggestionItemProps> = ({
  suggestion,
  onAccept,
  onReject,
  onSelect,
}) => {
  const timeFormatted = suggestion.timestamp
    ? new Date(suggestion.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'Just now';

  return (
    <div
      onClick={() => onSelect(suggestion)}
      className="p-3 rounded-xl border border-border bg-surface hover:border-accent-main cursor-pointer transition-all shadow-xs space-y-2 group"
    >
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 font-semibold text-text">
          <Bot className="w-3.5 h-3.5 text-agent shrink-0" />
          <span className="truncate max-w-[130px]">{suggestion.agentId}</span>
        </div>
        <span className="text-[10px] text-text-muted flex items-center gap-1 shrink-0">
          <Clock className="w-2.5 h-2.5" />
          {timeFormatted}
        </span>
      </div>

      {/* Diff Visualization */}
      <div className="text-xs font-mono rounded-lg p-2 bg-canvas border border-border space-y-1">
        {suggestion.type === 'replace' ? (
          <>
            <div className="text-status-danger line-through opacity-85 flex items-start gap-1">
              <Minus className="w-3 h-3 shrink-0 mt-0.5" />
              <span className="break-all">{suggestion.originalText}</span>
            </div>
            <div className="text-status-success font-semibold flex items-start gap-1">
              <Plus className="w-3 h-3 shrink-0 mt-0.5" />
              <span className="break-all">{suggestion.text}</span>
            </div>
          </>
        ) : suggestion.type === 'insert' ? (
          <div className="text-status-success font-semibold flex items-start gap-1">
            <Plus className="w-3 h-3 shrink-0 mt-0.5" />
            <span className="break-all">{suggestion.text}</span>
          </div>
        ) : (
          <div className="text-status-danger line-through opacity-85 flex items-start gap-1">
            <Minus className="w-3 h-3 shrink-0 mt-0.5" />
            <span className="break-all">{suggestion.text}</span>
          </div>
        )}
      </div>

      {/* Accept & Reject Action Controls */}
      <div className="flex items-center justify-end gap-1.5 pt-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onReject(suggestion);
          }}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-status-danger bg-status-danger/10 hover:bg-status-danger/20 transition-colors"
          title="Reject Suggestion"
        >
          <X className="w-3 h-3" />
          Reject
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onAccept(suggestion);
          }}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-white bg-status-success hover:bg-status-success/90 transition-colors shadow-xs"
          title="Accept Suggestion"
        >
          <Check className="w-3 h-3" />
          Accept
        </button>
      </div>
    </div>
  );
};
