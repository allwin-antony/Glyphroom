// Presentation component for blockquotes and callout alerts (> [!TYPE]).
//
// Rendered identically in flow and block mode (matches existing ReaderView
// behaviour: alerts are not wrapped in notebook cards). Body text is escaped
// React text via Inline.

import React from 'react';
import { Inline } from './Inline.js';
import { parseInline, BlockNode } from '../markdown.js';

interface AlertBlock {
  type: 'alert' | 'blockquote';
  alertType?: string;
  text: string;
}

interface AlertProps {
  block: BlockNode;
}

const ALERT_LABEL: Record<string, string> = {
  NOTE: 'Note',
  TIP: 'Tip',
  IMPORTANT: 'Important',
  WARNING: 'Warning',
  CAUTION: 'Caution',
};

export const Alert: React.FC<AlertProps> = ({ block }) => {
  const b = block as AlertBlock;
  const type = (b.alertType || 'NOTE').toUpperCase();
  const label = ALERT_LABEL[type] || 'Note';
  const className = `enterprise-alert enterprise-alert-${type.toLowerCase()} my-4`;

  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-bold text-text-muted uppercase tracking-wider">
        <span>{label}</span>
      </div>
      <div className="text-text-secondary leading-relaxed">
        <Inline nodes={b.text ? parseInline(b.text) : []} />
      </div>
    </div>
  );
};
