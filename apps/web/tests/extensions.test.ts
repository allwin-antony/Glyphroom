import { describe, it, expect } from 'vitest';
import { Schema } from 'prosemirror-model';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { SuggestionInsert, SuggestionDelete } from '../src/extensions/suggestion.js';
import { Alert } from '../src/extensions/alert.js';

describe('TipTap Web Extensions & Schema Compilation Suite', () => {
  it('correctly registers suggestion_insert and suggestion_delete marks', () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        SuggestionInsert,
        SuggestionDelete,
        Alert,
      ],
      content: '<p>Initial test content</p>',
    });

    const schema: Schema = editor.schema;

    expect(schema.marks.suggestion_insert).toBeDefined();
    expect(schema.marks.suggestion_delete).toBeDefined();
    expect(schema.nodes.alert).toBeDefined();

    // Verify mark attributes
    const insertMark = schema.marks.suggestion_insert.create({
      id: 'sug-123',
      agentId: 'agent:claude-3-7',
      tokenId: 'tok-999',
      ownerUserId: 'user-lead',
      timestamp: 1729680000000,
      status: 'pending',
    });

    expect(insertMark.attrs.id).toBe('sug-123');
    expect(insertMark.attrs.agentId).toBe('agent:claude-3-7');
    expect(insertMark.attrs.status).toBe('pending');

    editor.destroy();
  });

  it('renders and parses alert nodes with type attributes', () => {
    const editor = new Editor({
      extensions: [StarterKit, Alert],
      content: '<div class="enterprise-alert" data-alert-type="warning"><p>Attention required</p></div>',
    });

    const json = editor.getJSON();
    const alertNode = json.content?.find((n: any) => n.type === 'alert');

    expect(alertNode).toBeDefined();
    expect(alertNode.attrs?.type).toBe('warning');

    editor.destroy();
  });
});
