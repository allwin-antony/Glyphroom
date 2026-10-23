import React, { useEffect, useState } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { Users, Bot } from 'lucide-react';

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
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 16px',
        background: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        fontSize: '13px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#64748b' }}>
        <Users size={16} />
        <span>Collaborators ({presences.length}):</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {presences.map((p) => {
          const isAgent = p.user.isAgent || Boolean(p.user.agentId);
          const color = p.user.color || (isAgent ? '#8b5cf6' : '#3b82f6');
          return (
            <div
              key={p.clientId}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 8px',
                borderRadius: '12px',
                background: `${color}15`,
                border: `1px solid ${color}40`,
                color: '#1e293b',
              }}
              title={`${p.user.name} (${p.user.role || (isAgent ? 'AI Agent' : 'User')})`}
            >
              {isAgent ? <Bot size={14} color={color} /> : null}
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: color,
                }}
              />
              <span style={{ fontWeight: 500 }}>{p.user.name}</span>
              {p.user.status ? (
                <span style={{ fontSize: '11px', color: '#64748b' }}>[{p.user.status}]</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
