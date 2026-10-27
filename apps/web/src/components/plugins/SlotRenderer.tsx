import React from 'react';
import type { UiSlotIdentifier } from '@enterprise-blogger/shared';
import { usePluginSlots } from '../../plugins/PluginProvider.js';
import type { UiSlotContext } from '../../plugins/types.js';
import { PluginErrorBoundary } from './PluginErrorBoundary.js';

export interface SlotRendererProps {
  slot: UiSlotIdentifier;
  context?: UiSlotContext;
  className?: string;
  wrapper?: 'div' | 'span' | 'none';
}

export const SlotRenderer: React.FC<SlotRendererProps> = ({
  slot,
  context,
  className,
  wrapper = 'none',
}) => {
  const contributions = usePluginSlots(slot);

  if (contributions.length === 0) {
    // Explicit requirement: No DOM output when no extensions are registered
    return null;
  }

  const renderedItems = contributions.map((contribution, index) => {
    const Component = contribution.component;
    const key = `${contribution.pluginId}-${contribution.slot}-${index}`;

    return (
      <PluginErrorBoundary
        key={key}
        pluginId={contribution.pluginId}
        slot={slot}
      >
        <Component {...(context || {})} />
      </PluginErrorBoundary>
    );
  });

  if (wrapper === 'div') {
    return <div className={className}>{renderedItems}</div>;
  }

  if (wrapper === 'span') {
    return <span className={className}>{renderedItems}</span>;
  }

  return <>{renderedItems}</>;
};
