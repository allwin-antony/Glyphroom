import React from 'react';
import type { Editor } from '@tiptap/core';
import { Check, X, Bot, Clock } from 'lucide-react';

export interface ActiveSuggestionInfo {
  type: 'insert' | 'delete';
  id: string;
  agentId: string;
  tokenId?: string;
  ownerUserId?: string;
  timestamp?: number;
  from: number;
  to: number;
  text: string;
}

export interface SuggestionActionMenuProps {
  editor: Editor | null;
  activeSuggestion: ActiveSuggestionInfo | null;
  onAccept: (suggestion: ActiveSuggestionInfo) => void;
  onReject: (suggestion: ActiveSuggestionInfo) => void;
}

export const SuggestionActionMenu: React.FC<SuggestionActionMenuProps> = ({
  activeSuggestion,
  onAccept,
  onReject,
}) => {
  if (!activeSuggestion) return null;

  const dateStr = activeSuggestion.timestamp
    ? new Date(activeSuggestion.timestamp).toLocaleTimeString()
    : 'Just now';

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 12px',
        background: '#1e293b',
        color: '#f8fafc',
        borderRadius: '6px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        fontSize: '12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <Bot size={14} color="#a78bfa" />
        <span style={{ fontWeight: 600 }}>{activeSuggestion.agentId}</span>
        <span style={{ color: '#94a3b8' }}>suggested {activeSuggestion.type}:</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#cbd5e1' }}>
        <Clock size={12} />
        <span>{dateStr}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '6px' }}>
        <button
          onClick={() => onAccept(activeSuggestion)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '2px',
            background: '#16a34a',
            color: '#ffffff',
            border: 'none',
            borderRadius: '4px',
            padding: '3px 8px',
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: '11px',
          }}
          title="Accept AI Suggestion"
        >
          <Check size={12} /> Accept
        </button>

        <button
          onClick={() => onReject(activeSuggestion)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '2px',
            background: '#dc2626',
            color: '#ffffff',
            border: 'none',
            borderRadius: '4px',
            padding: '3px 8px',
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: '11px',
          }}
          title="Reject AI Suggestion"
        >
          <X size={12} /> Reject
        </button>
      </div>
    </div>
  );
};
