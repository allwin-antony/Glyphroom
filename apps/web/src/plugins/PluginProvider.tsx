import React, { createContext, useContext, useMemo } from 'react';
import type { AnyExtension } from '@tiptap/core';
import type { UiSlotIdentifier } from '@enterprise-blogger/shared';
import { WebPluginRegistry, defaultWebRegistry } from './registry.js';
import type { UiSlotContribution, WebPluginSlashCommand } from './types.js';

interface PluginContextValue {
  registry: WebPluginRegistry;
  getSlots: (slot: UiSlotIdentifier) => UiSlotContribution[];
  getEditorExtensions: () => AnyExtension[];
  getSlashCommands: () => WebPluginSlashCommand[];
}

const PluginContext = createContext<PluginContextValue | null>(null);

export interface PluginProviderProps {
  registry?: WebPluginRegistry;
  children: React.ReactNode;
}

export const PluginProvider: React.FC<PluginProviderProps> = ({
  registry = defaultWebRegistry,
  children,
}) => {
  const value = useMemo<PluginContextValue>(
    () => ({
      registry,
      getSlots: (slot) => registry.getSlots(slot),
      getEditorExtensions: () => registry.getEditorExtensions(),
      getSlashCommands: () => registry.getSlashCommands(),
    }),
    [registry]
  );

  return <PluginContext.Provider value={value}>{children}</PluginContext.Provider>;
};

export function usePluginRegistry(): PluginContextValue {
  const ctx = useContext(PluginContext);
  if (!ctx) {
    // If used outside of provider, fallback gracefully to default singleton
    return {
      registry: defaultWebRegistry,
      getSlots: (slot) => defaultWebRegistry.getSlots(slot),
      getEditorExtensions: () => defaultWebRegistry.getEditorExtensions(),
      getSlashCommands: () => defaultWebRegistry.getSlashCommands(),
    };
  }
  return ctx;
}

export function usePluginSlots(slot: UiSlotIdentifier): UiSlotContribution[] {
  const { getSlots } = usePluginRegistry();
  return useMemo(() => getSlots(slot), [getSlots, slot]);
}

export function usePluginEditorExtensions(): AnyExtension[] {
  const { getEditorExtensions } = usePluginRegistry();
  return useMemo(() => getEditorExtensions(), [getEditorExtensions]);
}

export function usePluginSlashCommands(): WebPluginSlashCommand[] {
  const { getSlashCommands } = usePluginRegistry();
  return useMemo(() => getSlashCommands(), [getSlashCommands]);
}
