import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import React, { useState } from 'react';
import { Flag, Calendar, AlertOctagon, CheckCircle2, AlertTriangle, Edit3, Check } from 'lucide-react';

interface StatusComponentProps {
  node: {
    attrs: {
      ragStatus: 'green' | 'amber' | 'red';
      milestoneTitle: string;
      completionPercent: number;
      targetDate: string;
      blockers: string;
    };
  };
  updateAttributes: (attrs: Partial<{
    ragStatus: 'green' | 'amber' | 'red';
    milestoneTitle: string;
    completionPercent: number;
    targetDate: string;
    blockers: string;
  }>) => void;
  selected: boolean;
}

const StatusComponent: React.FC<StatusComponentProps> = ({ node, updateAttributes, selected }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [milestone, setMilestone] = useState(node.attrs.milestoneTitle || 'Q4 Major Release Milestone');
  const [percent, setPercent] = useState(node.attrs.completionPercent ?? 65);
  const [date, setDate] = useState(node.attrs.targetDate || '2026-11-30');
  const [blockersText, setBlockersText] = useState(node.attrs.blockers || '');

  const rag = node.attrs.ragStatus || 'green';

  const ragConfig = {
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
  }[rag];

  const handleSave = () => {
    updateAttributes({
      milestoneTitle: milestone.trim(),
      completionPercent: Number(percent),
      targetDate: date.trim(),
      blockers: blockersText.trim(),
    });
    setIsEditing(false);
  };

  const blockerList = (node.attrs.blockers || '')
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <NodeViewWrapper className="my-5 not-prose select-none">
      <div
        className={`rounded-2xl border p-4 sm:p-5 transition-all bg-surface ${
          selected || isEditing ? 'border-accent shadow-md ring-1 ring-accent/20' : 'border-border shadow-xs'
        }`}
      >
        {/* Header Row */}
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

          <div className="flex items-center gap-2">
            {/* RAG Status Badge / Quick Selector */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-canvas border border-border">
              {(['green', 'amber', 'red'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => updateAttributes({ ragStatus: status })}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all ${
                    rag === status
                      ? status === 'green'
                        ? 'bg-status-success text-white shadow-xs'
                        : status === 'amber'
                        ? 'bg-status-warning text-white shadow-xs'
                        : 'bg-status-danger text-white shadow-xs'
                      : 'text-text-muted hover:text-foreground'
                  }`}
                >
                  {status === 'green' ? 'On Track' : status === 'amber' ? 'At Risk' : 'Blocked'}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => (isEditing ? handleSave() : setIsEditing(true))}
              className="flex items-center gap-1 text-[11px] text-accent hover:underline px-2 py-1 rounded hover:bg-canvas"
            >
              {isEditing ? (
                <>
                  <Check className="w-3.5 h-3.5 text-status-success" />
                  <span className="font-semibold text-status-success">Done</span>
                </>
              ) : (
                <>
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Configure</span>
                </>
              )}
            </button>
          </div>
        </div>

        {isEditing ? (
          <div className="space-y-3 pt-1">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-foreground">Current Milestone Title</label>
              <input
                type="text"
                value={milestone}
                onChange={(e) => setMilestone(e.target.value)}
                className="w-full text-xs px-3 py-1.5 rounded-lg bg-canvas border border-border text-foreground focus:outline-none focus:border-accent"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-foreground">
                  Completion Progress: {percent}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={percent}
                  onChange={(e) => setPercent(Number(e.target.value))}
                  className="w-full cursor-pointer accent-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-foreground">Target Completion Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full text-xs px-3 py-1.5 rounded-lg bg-canvas border border-border text-foreground focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-foreground">Active Blockers (one per line)</label>
              <textarea
                value={blockersText}
                onChange={(e) => setBlockersText(e.target.value)}
                placeholder="e.g. Waiting on SecOps sign-off for OAuth redirect URIs..."
                rows={2}
                className="w-full text-xs px-3 py-1.5 rounded-lg bg-canvas border border-border text-foreground focus:outline-none focus:border-accent resize-none"
              />
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={handleSave}
                className="px-3 py-1.5 rounded-lg bg-accent text-white font-semibold text-xs shadow-xs"
              >
                Save Status Block
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Milestone & Target Date Banner */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-sm text-foreground">
                {node.attrs.milestoneTitle || 'Q4 Major Release Milestone'}
              </div>
              {node.attrs.targetDate && (
                <div className="flex items-center gap-1.5 text-xs text-text-secondary bg-canvas px-2.5 py-1 rounded-md border border-border">
                  <Calendar className="w-3.5 h-3.5 text-text-muted" />
                  <span>Target: {node.attrs.targetDate}</span>
                </div>
              )}
            </div>

            {/* Progress Bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-text-secondary">
                <span>Milestone Progress</span>
                <span className="font-mono font-bold text-foreground">{node.attrs.completionPercent ?? 0}%</span>
              </div>
              <div className="h-2.5 w-full bg-canvas border border-border rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${ragConfig.bar}`}
                  style={{ width: `${Math.min(100, Math.max(0, node.attrs.completionPercent ?? 0))}%` }}
                />
              </div>
            </div>

            {/* Blockers Section */}
            {blockerList.length > 0 && (
              <div className="pt-2 border-t border-border space-y-1.5">
                <div className="text-[11px] font-semibold text-status-danger flex items-center gap-1">
                  <AlertOctagon className="w-3 h-3" />
                  <span>Active Blockers ({blockerList.length})</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {blockerList.map((blocker, idx) => (
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
        )}
      </div>
    </NodeViewWrapper>
  );
};

export const ProjectStatusBlock = Node.create({
  name: 'projectStatusBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      ragStatus: {
        default: 'green',
        parseHTML: (el) => (el.getAttribute('data-rag') as any) || 'green',
        renderHTML: (attrs) => ({ 'data-rag': attrs.ragStatus }),
      },
      milestoneTitle: {
        default: 'Sprint Milestone Goal',
        parseHTML: (el) => el.getAttribute('data-milestone') || '',
        renderHTML: (attrs) => ({ 'data-milestone': attrs.milestoneTitle }),
      },
      completionPercent: {
        default: 50,
        parseHTML: (el) => Number(el.getAttribute('data-percent')) || 0,
        renderHTML: (attrs) => ({ 'data-percent': attrs.completionPercent }),
      },
      targetDate: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-date') || '',
        renderHTML: (attrs) => ({ 'data-date': attrs.targetDate }),
      },
      blockers: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-blockers') || '',
        renderHTML: (attrs) => ({ 'data-blockers': attrs.blockers }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="project-status-block"]',
        getAttrs: (el) => {
          if (typeof el === 'string') return false;
          return {
            ragStatus: (el.getAttribute('data-rag') as any) || 'green',
            milestoneTitle: el.getAttribute('data-milestone') || '',
            completionPercent: Number(el.getAttribute('data-percent')) || 0,
            targetDate: el.getAttribute('data-date') || '',
            blockers: el.getAttribute('data-blockers') || '',
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'project-status-block' }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(StatusComponent as any);
  },
});
