// Presentation component for project status blocks (status cards).
//
// Attributes come from the exact `<!-- status-block ... -->` serialization
// produced by the shared exporter and are validated here:
//  - ragStatus is allowlisted to green|amber|red (default green).
//  - completionPercent is clamped to 0-100.
//  - All free-text fields are rendered as escaped React text.
//
// This is presentation-only: no Tiptap NodeView, no editable callbacks.

import React from 'react';
import { Flag, Calendar, AlertOctagon, CheckCircle2, AlertTriangle } from 'lucide-react';
import { BlockNode } from '../markdown.js';

interface StatusBlockBlock {
  type: 'statusBlock';
  attrs: {
    ragStatus: 'green' | 'amber' | 'red';
    milestoneTitle: string;
    completionPercent: number;
    targetDate: string;
    blockers: string;
  };
}

interface StatusBlockProps {
  block: BlockNode;
}

const RAG_CONFIG: Record<string, { label: string; color: string; bg: string; bar: string; icon: React.ReactNode }> = {
  green: {
    label: 'On Track',
    color: 'text-status-success',
    bg: 'bg-status-success/10 border-status-success/30',
    bar: 'bg-status-success',
    icon: <CheckCircle2 className="w-3.5 h-3.5 text-status-success" />,
  },
  amber: {
    label: 'At Risk',
    color: 'text-status-warning',
    bg: 'bg-status-warning/10 border-status-warning/30',
    bar: 'bg-status-warning',
    icon: <AlertTriangle className="w-3.5 h-3.5 text-status-warning" />,
  },
  red: {
    label: 'Blocked',
    color: 'text-status-danger',
    bg: 'bg-status-danger/10 border-status-danger/30',
    bar: 'bg-status-danger',
    icon: <AlertOctagon className="w-3.5 h-3.5 text-status-danger" />,
  },
};

export const StatusBlock: React.FC<StatusBlockProps> = ({ block }) => {
  const b = block as StatusBlockBlock;
  const attrs = b.attrs;
  const rag = RAG_CONFIG[attrs.ragStatus] ?? RAG_CONFIG.green;
  const percent = Math.min(100, Math.max(0, Number(attrs.completionPercent) || 0));
  const blockers = (attrs.blockers || '')
    .split(/[,;\n]/)
    .map((s: string) => s.trim())
    .filter(Boolean);

  return (
    <div className="rounded-2xl border p-4 sm:p-5 transition-all bg-surface border-border shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-accent-bg text-accent">
            <Flag className="w-4 h-4" />
          </div>
          <div>
            <div className="font-bold text-xs text-foreground">Project Status & Pulse</div>
            <div className="text-[10px] text-text-muted">Live project health and milestone tracker</div>
          </div>
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-canvas border border-border">
          {(['green', 'amber', 'red'] as const).map((status) => (
            <button
              key={status}
              type="button"
              disabled
              aria-pressed={attrs.ragStatus === status}
              className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all ${
                attrs.ragStatus === status
                  ? status === 'green'
                    ? 'bg-status-success text-white shadow-xs'
                    : status === 'amber'
                      ? 'bg-status-warning text-white shadow-xs'
                      : 'bg-status-danger text-white shadow-xs'
                  : 'text-text-muted'
              }`}
            >
              {status === 'green' ? 'On Track' : status === 'amber' ? 'At Risk' : 'Blocked'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-sm text-foreground">{attrs.milestoneTitle || 'Sprint Milestone Goal'}</div>
        {attrs.targetDate && (
          <div className="flex items-center gap-1.5 text-xs text-text-secondary bg-canvas px-2.5 py-1 rounded-md border border-border">
            <Calendar className="w-3.5 h-3.5 text-text-muted" />
            <span>Target: {attrs.targetDate}</span>
          </div>
        )}
      </div>

      <div className="space-y-1 mt-3">
        <div className="flex justify-between text-xs text-text-secondary">
          <span>Milestone Progress</span>
          <span className="font-mono font-bold text-foreground">{percent}%</span>
        </div>
        <div className="h-2.5 w-full bg-canvas border border-border rounded-full overflow-hidden">
          <div className={`h-full transition-all duration-300 ${rag.bar}`} style={{ width: `${percent}%` }} />
        </div>
      </div>

      {blockers.length > 0 && (
        <div className="pt-2 border-t border-border space-y-1.5 mt-3">
          <div className="text-[11px] font-semibold text-status-danger flex items-center gap-1">
            <AlertOctagon className="w-3 h-3" />
            <span>Active Blockers ({blockers.length})</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {blockers.map((blocker: string, idx: number) => (
              <span
                key={idx}
                className="px-2.5 py-1 rounded-md bg-status-danger/10 border border-status-danger/25 text-status-danger text-xs flex items-center gap-1"
              >
                <span className="font-bold">•</span>
                <span>{blocker}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
