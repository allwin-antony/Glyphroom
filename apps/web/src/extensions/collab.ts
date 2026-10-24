import { Extension } from '@tiptap/core';
import { ySyncPlugin, yCursorPlugin, undo, redo } from 'y-prosemirror';
import * as Y from 'yjs';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { createHumanUndoManager, createHumanUndoPlugin } from '@enterprise-blogger/shared';

export interface CollaborationOptions {
  fragment?: Y.XmlFragment;
  provider?: HocuspocusProvider;
  user?: {
    name: string;
    color: string;
    role?: string;
  };
  undoManager?: Y.UndoManager;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    enterpriseCollaboration: {
      undo: () => ReturnType;
      redo: () => ReturnType;
    };
  }
}

export const Collaboration = Extension.create<CollaborationOptions>({
  name: 'enterpriseCollaboration',

  addOptions() {
    return {
      fragment: undefined,
      provider: undefined,
      user: undefined,
      undoManager: undefined,
    };
  },

  addProseMirrorPlugins() {
    const plugins = [];
    const fragment = this.options.fragment;

    if (fragment) {
      // 1. Sync plugin binds Yjs XmlFragment to ProseMirror doc
      plugins.push(ySyncPlugin(fragment));

      // 2. Human UndoManager isolation (Feature 25)
      const undoManager =
        this.options.undoManager ?? createHumanUndoManager(fragment);
      plugins.push(createHumanUndoPlugin({ undoManager }));
    }

    // 3. Collaborative Cursors & Awareness (Feature 15)
    if (this.options.provider?.awareness) {
      if (this.options.user) {
        this.options.provider.awareness.setLocalStateField('user', this.options.user);
      }
      plugins.push(yCursorPlugin(this.options.provider.awareness));
    }

    return plugins;
  },

  addKeyboardShortcuts() {
    return {
      'Mod-z': () => undo(this.editor.state),
      'Mod-y': () => redo(this.editor.state),
      'Mod-Shift-z': () => redo(this.editor.state),
    };
  },

  addCommands() {
    return {
      undo: () => ({ state }) => undo(state),
      redo: () => ({ state }) => redo(state),
    };
  },
});
