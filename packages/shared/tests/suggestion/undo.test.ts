import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { ySyncPluginKey } from 'y-prosemirror';
import {
  createHumanUndoManager,
  createHumanUndoPlugin,
  createAgentOrigin,
  isAgentOrigin,
  runAgentTransaction,
} from '../../src/suggestion/undo.js';
import { getPlainTextFromXmlText } from '../../src/suggestion/operations.js';
import type { AgentMetadata } from '../../src/types/index.js';

describe('UndoManager Human Isolation & Origin Filtering (undo.ts)', () => {
  const agentMeta: AgentMetadata = {
    agentId: 'agent:researcher:v1',
    tokenId: 'pat-xyz-123',
    ownerUserId: 'user-001',
    timestamp: 1729600000000,
  };

  describe('Origin Tagging & Helper Utilities', () => {
    it('creates immutable AgentTransactionOrigin with complete metadata', () => {
      const origin = createAgentOrigin(agentMeta, 'suggest_edit');
      expect(origin.origin).toBe('agent');
      expect(origin.agentId).toBe(agentMeta.agentId);
      expect(origin.tokenId).toBe(agentMeta.tokenId);
      expect(origin.ownerUserId).toBe(agentMeta.ownerUserId);
      expect(origin.action).toBe('suggest_edit');
      expect(isAgentOrigin(origin)).toBe(true);
    });

    it('isAgentOrigin correctly identifies agent vs human/sync origins', () => {
      expect(isAgentOrigin({ origin: 'agent' })).toBe(true);
      expect(isAgentOrigin({ type: 'agent' })).toBe(true);
      expect(isAgentOrigin(ySyncPluginKey)).toBe(false);
      expect(isAgentOrigin(null)).toBe(false);
      expect(isAgentOrigin(undefined)).toBe(false);
      expect(isAgentOrigin({ type: 'human', userId: 'u1' })).toBe(false);
    });
  });

  describe('Human-Only UndoManager Isolation Guarantee', () => {
    it('Ctrl+Z (undo) reverts only human typing and NEVER undoes or corrupts agent suggestions', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('default');
      let pText!: Y.XmlText;

      doc.transact(() => {
        const p = new Y.XmlElement('paragraph');
        fragment.push([p]);
        pText = new Y.XmlText();
        p.push([pText]);
      });

      // Initialize UndoManager tracking ySyncPluginKey (human typing)
      const undoManager = createHumanUndoManager(fragment, {
        captureTimeout: 0, // Instant stack capture for testing
      });

      // Step 1: Human types "First human text. "
      doc.transact(() => {
        pText.insert(0, 'First human text. ');
      }, ySyncPluginKey);

      expect(getPlainTextFromXmlText(pText)).toBe('First human text. ');
      expect(undoManager.undoStack.length).toBe(1);

      // Step 2: Agent gateway performs suggestion edit
      const agentOrigin = createAgentOrigin(agentMeta, 'suggest_edit');
      runAgentTransaction(doc, agentOrigin, () => {
        pText.insert(18, 'Agent AI proposal. ', {
          suggestion_insert: { id: 'sug-1', ...agentMeta, status: 'pending' },
        });
      });

      expect(getPlainTextFromXmlText(pText)).toBe('First human text. Agent AI proposal. ');
      // Crucial: UndoManager ignored agent transaction! Stack length is STILL 1.
      expect(undoManager.undoStack.length).toBe(1);

      // Step 3: Human types "Second human text."
      doc.transact(() => {
        pText.insert(pText.length, 'Second human text.');
      }, ySyncPluginKey);

      expect(getPlainTextFromXmlText(pText)).toBe('First human text. Agent AI proposal. Second human text.');
      expect(undoManager.undoStack.length).toBe(2);

      // Step 4: Human presses Ctrl+Z (first undo)
      undoManager.undo();

      // "Second human text." must be undone. Agent AI proposal MUST REMAIN INTACT!
      expect(getPlainTextFromXmlText(pText)).toBe('First human text. Agent AI proposal. ');

      // Step 5: Human presses Ctrl+Z again (second undo)
      undoManager.undo();

      // "First human text. " must be undone. Agent AI proposal STILL REMAINS INTACT!
      expect(getPlainTextFromXmlText(pText)).toBe('Agent AI proposal. ');

      // Step 6: Human presses Ctrl+Y (redo first human edit)
      undoManager.redo();
      expect(getPlainTextFromXmlText(pText)).toBe('First human text. Agent AI proposal. ');

      // Step 7: Human presses Ctrl+Y (redo second human edit)
      undoManager.redo();
      expect(getPlainTextFromXmlText(pText)).toBe('First human text. Agent AI proposal. Second human text.');
    });

    it('works with additional tracked human origins when specified', () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('default');
      let pText!: Y.XmlText;

      doc.transact(() => {
        const p = new Y.XmlElement('paragraph');
        fragment.push([p]);
        pText = new Y.XmlText();
        p.push([pText]);
      });

      const customHumanOrigin = 'custom-client-sync';
      const undoManager = createHumanUndoManager(fragment, {
        additionalTrackedOrigins: [customHumanOrigin],
        captureTimeout: 0,
      });

      // Human edit using custom origin
      doc.transact(() => {
        pText.insert(0, 'Human custom origin text.');
      }, customHumanOrigin);

      expect(undoManager.undoStack.length).toBe(1);

      // Agent edit
      runAgentTransaction(doc, agentMeta, () => {
        pText.insert(pText.length, ' Agent text.');
      });

      // Still 1 in stack
      expect(undoManager.undoStack.length).toBe(1);

      undoManager.undo();
      expect(getPlainTextFromXmlText(pText)).toBe(' Agent text.');
    });

    it('creates yUndoPlugin properly configuring trackedOrigins', () => {
      const plugin = createHumanUndoPlugin();
      expect(plugin).toBeDefined();
      expect(plugin.spec).toBeDefined();
    });
  });
});
