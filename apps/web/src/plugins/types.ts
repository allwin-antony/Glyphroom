import type { ComponentType } from 'react';
import type { AnyExtension, Editor } from '@tiptap/core';
import type {
  PluginManifest,
  UiSlotIdentifier,
} from '@enterprise-blogger/shared';

export interface UiSlotContext {
  postId?: string;
  spaceId?: string | null;
  editor?: Editor | null;
  [key: string]: unknown;
}

export interface UiSlotContribution {
  slot: UiSlotIdentifier;
  pluginId: string;
  order?: number;
  component: ComponentType<UiSlotContext>;
}

export interface WebPluginSlashCommand {
  id: string;
  label: string;
  description: string;
  keywords?: string[];
  order?: number;
  execute: (editor: Editor) => boolean;
}

export interface GlyphroomWebPlugin {
  manifest: PluginManifest;
  slots?: Array<{
    slot: UiSlotIdentifier;
    order?: number;
    component: ComponentType<UiSlotContext>;
  }>;
  editorExtensions?: AnyExtension[];
  slashCommands?: WebPluginSlashCommand[];
}
