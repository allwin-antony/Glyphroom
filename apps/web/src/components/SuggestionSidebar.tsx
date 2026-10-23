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
    <div
      style={{
        width: '320px',
        borderLeft: '1px solid #e2e8f0',
        background: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
          <Bot size={16} color="#8b5cf6" />
          <span>AI Suggestions ({suggestions.length})</span>
        </div>

        {suggestions.length > 0 && (
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={onAcceptAll}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '2px',
                padding: '2px 6px',
                fontSize: '11px',
                background: '#dcfce7',
                color: '#15803d',
                border: '1px solid #86efac',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
              title="Accept All Suggestions"
            >
              <CheckCheck size={12} /> All
            </button>
            <button
              onClick={onRejectAll}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '2px',
                padding: '2px 6px',
                fontSize: '11px',
                background: '#fee2e2',
                color: '#b91c1c',
                border: '1px solid #fca5a5',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
              title="Reject All Suggestions"
            >
              <XCircle size={12} /> All
            </button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {suggestions.length === 0 ? (
          <div style={{ color: '#94a3b8', textAlign: 'center', padding: '24px 8px', fontSize: '13px' }}>
            No pending AI suggestions in this document.
          </div>
        ) : (
          suggestions.map((s) => (
            <div
              key={s.id}
              onClick={() => onSelect(s)}
              style={{
                padding: '10px',
                marginBottom: '8px',
                borderRadius: '6px',
                border: `1px solid ${s.type === 'insert' ? '#86efac' : '#fca5a5'}`,
                background: s.type === 'insert' ? '#f0fdf4' : '#fef2f2',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span
                  style={{
                    fontWeight: 600,
                    color: s.type === 'insert' ? '#16a34a' : '#dc2626',
                    textTransform: 'uppercase',
                    fontSize: '10px',
                  }}
                >
                  {s.type}
                </span>
                <span style={{ color: '#64748b', fontSize: '11px' }}>{s.agentId}</span>
              </div>

              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  color: '#1e293b',
                  marginBottom: '8px',
                  wordBreak: 'break-word',
                  textDecoration: s.type === 'delete' ? 'line-through' : 'none',
                }}
              >
                "{s.text}"
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAccept(s);
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '2px',
                    padding: '2px 8px',
                    fontSize: '11px',
                    background: '#16a34a',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  <Check size={11} /> Accept
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onReject(s);
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '2px',
                    padding: '2px 8px',
                    fontSize: '11px',
                    background: '#dc2626',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
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
