import type { AnyExtension } from '@tiptap/core';
import {
  PluginManifestSchema,
  CORE_SLASH_COMMAND_IDS,
  type UiSlotIdentifier,
} from '@enterprise-blogger/shared';
import type {
  GlyphroomWebPlugin,
  UiSlotContribution,
  WebPluginSlashCommand,
} from './types.js';

export class WebPluginRegistry {
  private plugins = new Map<string, GlyphroomWebPlugin>();
  private slashCommandIds = new Set<string>();

  /**
   * Registers a web plugin contribution bundle with manifest and slot validation.
   */
  register(plugin: GlyphroomWebPlugin): void {
    // 1. Validate manifest
    const manifest = PluginManifestSchema.parse(plugin.manifest);

    // 2. Reject duplicate plugin IDs
    if (this.plugins.has(manifest.id)) {
      throw new Error(`Duplicate web plugin ID registered: "${manifest.id}"`);
    }

    // 3. Validate slash commands against core commands and duplicates
    if (plugin.slashCommands) {
      for (const cmd of plugin.slashCommands) {
        if ((CORE_SLASH_COMMAND_IDS as readonly string[]).includes(cmd.id)) {
          throw new Error(
            `Security violation: Plugin "${manifest.id}" cannot override core slash command "${cmd.id}"`
          );
        }
        if (this.slashCommandIds.has(cmd.id)) {
          throw new Error(
            `Duplicate slash command ID "${cmd.id}" registered by plugin "${manifest.id}"`
          );
        }
        this.slashCommandIds.add(cmd.id);
      }
    }

    this.plugins.set(manifest.id, plugin);
  }

  /**
   * Returns list of all registered web plugins.
   */
  getPlugins(): GlyphroomWebPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Returns slot contributions for a specific slot, sorted stably by order, then pluginId.
   */
  getSlots(slot: UiSlotIdentifier): UiSlotContribution[] {
    const contributions: UiSlotContribution[] = [];

    for (const [pluginId, plugin] of this.plugins.entries()) {
      if (!plugin.slots) continue;
      for (const item of plugin.slots) {
        if (item.slot === slot) {
          contributions.push({
            slot,
            pluginId,
            order: item.order ?? 100,
            component: item.component,
          });
        }
      }
    }

    return contributions.sort((a, b) => {
      const orderA = a.order ?? 100;
      const orderB = b.order ?? 100;
      if (orderA !== orderB) return orderA - orderB;
      return a.pluginId.localeCompare(b.pluginId);
    });
  }

  /**
   * Aggregates all TipTap editor extensions from registered plugins.
   */
  getEditorExtensions(): AnyExtension[] {
    const extensions: AnyExtension[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.editorExtensions) {
        extensions.push(...plugin.editorExtensions);
      }
    }
    return extensions;
  }

  /**
   * Returns all registered plugin slash commands sorted by order, then label.
   */
  getSlashCommands(): WebPluginSlashCommand[] {
    const commands: WebPluginSlashCommand[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.slashCommands) {
        commands.push(...plugin.slashCommands);
      }
    }
    return commands.sort((a, b) => {
      const orderA = a.order ?? 100;
      const orderB = b.order ?? 100;
      if (orderA !== orderB) return orderA - orderB;
      return a.label.localeCompare(b.label);
    });
  }

  /**
   * Clears all registered web plugins (useful for testing).
   */
  clear(): void {
    this.plugins.clear();
    this.slashCommandIds.clear();
  }
}

/**
 * Global singleton WebPluginRegistry for the web application.
 */
export const defaultWebRegistry = new WebPluginRegistry();

/**
 * Returns available web plugins.
 */
export function getWebPlugins(): GlyphroomWebPlugin[] {
  return defaultWebRegistry.getPlugins();
}
