import { Extension } from '@tiptap/core';
import { ySyncPlugin, yCursorPlugin } from 'y-prosemirror';
import * as Y from 'yjs';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { createHumanUndoManager } from '@enterprise-blogger/shared';

export interface CollaborationOptions {
  fragment?: Y.XmlFragment;
  provider?: HocuspocusProvider;
  user?: {
    name: string;
    color: string;
    role?: string;
  };
}

export const Collaboration = Extension.create<CollaborationOptions>({
  name: 'enterpriseCollaboration',

  addOptions() {
    return {
      fragment: undefined,
      provider: undefined,
      user: undefined,
    };
  },

  addProseMirrorPlugins() {
    const plugins = [];
    const fragment = this.options.fragment;

    if (fragment) {
      plugins.push(ySyncPlugin(fragment));
    }

    if (this.options.provider?.awareness) {
      if (this.options.user) {
        this.options.provider.awareness.setLocalStateField('user', this.options.user);
      }
      plugins.push(yCursorPlugin(this.options.provider.awareness));
    }

    return plugins;
  },
});
