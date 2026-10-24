import React, { useEffect, useState } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { Users, Bot } from 'lucide-react';

/**
 * Okabe-Ito color-blind safe palette for human collaborators.
 * Yellow is intentionally omitted because it vanishes on warm paper light mode.
 */
export const OKABE_ITO_PALETTE = [
  '#0072B2', // Blue
  '#D55E00', // Vermillion
  '#009E73', // Green
  '#CC79A7', // Pink
  '#E69F00', // Orange
  '#56B4E9', // Sky
];

/**
 * Violet is strictly reserved for AI agents so users can tell
 * at a glance who or what is editing. Never used for human cursors.
 */
export const AGENT_COLOR_LIGHT = '#6B46E0';
export const AGENT_COLOR_DARK = '#A78BFA';

export function getCollaboratorColor(clientId: number, isAgent: boolean, isDark = false): string {
  if (isAgent) {
    return isDark ? AGENT_COLOR_DARK : AGENT_COLOR_LIGHT;
  }
  return OKABE_ITO_PALETTE[Math.abs(clientId) % OKABE_ITO_PALETTE.length];
}

export function getTextColorForBackground(hex: string): string {
  // Orange, Sky, and Light Violet pass contrast with near-black text
  const upper = hex.toUpperCase();
  if (upper === '#E69F00' || upper === '#56B4E9' || upper === '#A78BFA' || upper === '#CFDCFB') {
    return '#0F1216';
  }
  return '#FFFFFF';
}

export interface UserPresence {
  clientId: number;
  user: {
    name: string;
    color?: string;
    role?: string;
    isAgent?: boolean;
    agentId?: string;
    status?: 'viewing' | 'editing' | 'idle';
  };
}

export interface AwarenessBarProps {
  provider?: HocuspocusProvider;
}

export const AwarenessBar: React.FC<AwarenessBarProps> = ({ provider }) => {
  const [presences, setPresences] = useState<UserPresence[]>([]);

  useEffect(() => {
    if (!provider?.awareness) return;

    const updatePresence = () => {
      const states = provider.awareness?.getStates();
      if (!states) return;

      const list: UserPresence[] = [];
      states.forEach((state: any, clientId: number) => {
        if (state.user) {
          list.push({ clientId, user: state.user });
        }
      });
      setPresences(list);
    };

    provider.awareness.on('change', updatePresence);
    updatePresence();

    return () => {
      provider.awareness?.off('change', updatePresence);
    };
  }, [provider]);

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-surface border-b border-border text-xs">
      <div className="flex items-center gap-1.5 text-text-secondary font-medium">
        <Users size={14} />
        <span>Collaborators ({presences.length}):</span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {presences.map((p) => {
          const isAgent = p.user.isAgent || Boolean(p.user.agentId);
          const color = p.user.color || getCollaboratorColor(p.clientId, isAgent);
          const textColor = getTextColorForBackground(color);

          return (
            <div
              key={p.clientId}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold shadow-sm transition-all"
              style={{
                backgroundColor: color,
                color: textColor,
              }}
              title={`${p.user.name} (${p.user.role || (isAgent ? 'AI Agent' : 'User')})`}
            >
              {isAgent ? <Bot size={13} className="shrink-0" /> : <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80 shrink-0" />}
              <span>{p.user.name}</span>
              {p.user.status ? (
                <span className="text-[10px] opacity-90 font-mono">[{p.user.status}]</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
