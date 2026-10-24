import React, { useState, useEffect } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { Bot, Sparkles } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';
import { cn } from '../../lib/utils.js';

export interface AgentPresence {
  clientId: number;
  agentId: string;
  name: string;
  color: string;
  status: string;
  tokenId?: string;
  ownerUserId?: string;
}

export interface AgentPresenceChipProps {
  provider?: HocuspocusProvider | null;
  className?: string;
}

export const AgentPresenceChip: React.FC<AgentPresenceChipProps> = ({
  provider,
  className,
}) => {
  const [agents, setAgents] = useState<AgentPresence[]>([]);

  useEffect(() => {
    if (!provider?.awareness) {
      setAgents([]);
      return;
    }

    const handleAwarenessChange = () => {
      const states = provider.awareness?.getStates();
      if (!states) return;

      const active: AgentPresence[] = [];
      states.forEach((state: any, clientId: number) => {
        const u = state.user;
        if (!u) return;

        // Role === 'agent' or presence of agentId
        if (u.role === 'agent' || u.isAgent || u.agentId) {
          active.push({
            clientId,
            agentId: u.agentId || 'ai-agent',
            name: (u.name || 'AI Agent').replace(/^\[Agent:\s*/, '').replace(/\]$/, ''),
            color: u.color || '#6366f1',
            status: u.status || 'Active',
            tokenId: u.tokenId,
            ownerUserId: u.ownerUserId,
          });
        }
      });

      setAgents(active);
    };

    provider.awareness.on('change', handleAwarenessChange);
    handleAwarenessChange();

    return () => {
      provider.awareness?.off('change', handleAwarenessChange);
    };
  }, [provider]);

  if (agents.length === 0) {
    return null; // Keep top status bar uncluttered when no AI agent is active
  }

  const primary = agents[0];
  const moreCount = agents.length - 1;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="status"
          className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-agent/15 text-agent border border-agent/30 shadow-xs cursor-default select-none animate-in fade-in-50",
            className
          )}
        >
          {/* Pulsing live activity beacon */}
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-agent opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-agent"></span>
          </span>

          <Bot className="w-3.5 h-3.5 shrink-0" />
          <span className="font-medium max-w-[120px] truncate">{primary.name}</span>

          <span className="text-[10px] px-1.5 py-0.2 rounded bg-agent/20 font-mono text-agent max-w-[130px] truncate">
            {primary.status}
          </span>

          {moreCount > 0 && (
            <span className="text-[10px] px-1 rounded-full bg-agent/25 font-bold">
              +{moreCount}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs space-y-1 p-2.5 text-xs">
        <div className="flex items-center gap-1.5 font-semibold text-agent">
          <Sparkles className="w-3.5 h-3.5" />
          <span>AI Agent Co-Editor Active</span>
        </div>
        <p className="text-text-muted text-[11px]">
          Autonomous suggestion mode via CRDT marks (insertions & deletions).
        </p>
        <div className="border-t border-border/50 pt-1 text-[10px] space-y-0.5 font-mono text-text-secondary">
          <div>Agent ID: <span className="text-foreground">{primary.agentId}</span></div>
          {primary.tokenId && <div>Token: <span className="text-foreground">{primary.tokenId}</span></div>}
          <div>Status: <span className="text-foreground">{primary.status}</span></div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};
