import React from 'react';
import { 
  FileText, 
  Flag, 
  GitGraph, 
  AlertTriangle, 
  Terminal, 
  CheckSquare, 
  Sparkles, 
  X,
  ArrowRight
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog.js';

export interface TemplateDefinition {
  id: string;
  title: string;
  subtitle: string;
  category: 'Status & Governance' | 'Architecture & Design' | 'Operations & QA';
  icon: React.ComponentType<{ className?: string }>;
  badge: string;
  description: string;
  previewItems: string[];
}

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: 'weekly_status',
    title: 'Weekly Project Status Pulse',
    subtitle: 'Executive status report with RAG indicators and blocker tracker',
    category: 'Status & Governance',
    icon: Flag,
    badge: 'Popular',
    description: 'Structured weekly pulse including milestone progress bar, active blockers, achievements, and upcoming sprint deliverables.',
    previewItems: ['RAG Status Health Card', 'Milestone Completion Slider', 'Blocker Chips', 'Next Sprint Checklist'],
  },
  {
    id: 'architecture_rfc',
    title: 'Architecture RFC & Decision Record (ADR)',
    subtitle: 'Technical design document and architectural consensus proposal',
    category: 'Architecture & Design',
    icon: GitGraph,
    badge: 'Standard',
    description: 'Propose system architecture with context, embedded Mermaid diagrams, considered alternatives, and decision trade-offs.',
    previewItems: ['Context & Problem Statement', 'Live Mermaid Diagram', 'Decision & Rationale', 'Consequences & Trade-offs'],
  },
  {
    id: 'incident_postmortem',
    title: 'Incident Postmortem (SEV-1 Retrospective)',
    subtitle: 'Blameless incident retro with timeline and 5 Whys root cause',
    category: 'Operations & QA',
    icon: AlertTriangle,
    badge: 'Ops',
    description: 'Document an outage with customer impact metrics, chronological event timeline table, 5 Whys root cause, and corrective action checklist.',
    previewItems: ['SEV Severity Alert', 'Event Timeline Table', '5 Whys Root Cause', 'Preventive Action Checklist'],
  },
  {
    id: 'runbook',
    title: 'Operational Engineering Runbook',
    subtitle: 'Step-by-step procedures, SLA targets, and recovery playbooks',
    category: 'Operations & QA',
    icon: Terminal,
    badge: 'SRE',
    description: 'Standard operating procedure with prerequisites, terminal commands, verification health-checks, and emergency rollback steps.',
    previewItems: ['SLA Target Alert', 'Precondition Checklist', 'Verification Code Blocks', 'Rollback Procedure'],
  },
  {
    id: 'test_plan',
    title: 'Test Plan & Acceptance Matrix',
    subtitle: 'QA test scenarios table with steps and expected outcomes',
    category: 'Operations & QA',
    icon: CheckSquare,
    badge: 'QA',
    description: 'Structured testing plan with scope, environment setup, and a complete tabular matrix of test cases and pass/fail states.',
    previewItems: ['Test Scope & Environment', 'Acceptance Test Table', 'Negative Scenarios', 'Sign-off Checklist'],
  },
];

export interface TemplatePickerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (templateId: string) => void;
}

export const TemplatePickerDialog: React.FC<TemplatePickerDialogProps> = ({
  isOpen,
  onClose,
  onSelectTemplate,
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="w-4 h-4 text-accent" />
            <span>Project Documentation & Status Templates</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-text-secondary">
            Select an enterprise template to scaffold your post with pre-built status blocks, tables, diagrams, and checklists.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          {TEMPLATES.map((tpl) => {
            const Icon = tpl.icon;
            return (
              <div
                key={tpl.id}
                onClick={() => {
                  onSelectTemplate(tpl.id);
                  onClose();
                }}
                className="group p-3.5 rounded-xl border border-border bg-surface hover:border-accent hover:shadow-md transition-all cursor-pointer flex flex-col justify-between text-left"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="p-2 rounded-lg bg-canvas border border-border text-accent group-hover:bg-accent group-hover:text-white transition-colors">
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-canvas border border-border text-text-muted">
                      {tpl.badge}
                    </span>
                  </div>

                  <h4 className="font-bold text-xs text-foreground group-hover:text-accent transition-colors">
                    {tpl.title}
                  </h4>
                  <p className="text-[11px] text-text-secondary mt-1 leading-relaxed">
                    {tpl.description}
                  </p>

                  <div className="mt-3 pt-2 border-t border-border flex flex-wrap gap-1">
                    {tpl.previewItems.map((item, idx) => (
                      <span
                        key={idx}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-canvas text-text-muted font-medium"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs font-semibold text-accent pt-1">
                  <span>Use Template</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};
