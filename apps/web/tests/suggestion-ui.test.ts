import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { SuggestionInsert, SuggestionDelete } from '../src/extensions/suggestion.js';

describe('Suggestion Lifecycle Acceptance & Rejection Suite', () => {
  it('accepts suggestion_insert: removes mark and retains inserted text', () => {
    const editor = new Editor({
      extensions: [StarterKit, SuggestionInsert, SuggestionDelete],
      content: '<p>Hello <span class="suggestion-insert" data-suggestion-id="s1">Agent World</span>!</p>',
    });

    expect(editor.getText()).toBe('Hello Agent World!');

    // Accept suggestion: select the inserted range and remove mark
    editor.chain().setTextSelection({ from: 7, to: 18 }).unsetMark('suggestion_insert').run();

    expect(editor.getText()).toBe('Hello Agent World!');

    const json = editor.getJSON();
    const hasAnyMarks = json.content?.[0]?.content?.some((n: any) => n.marks && n.marks.length > 0);
    expect(hasAnyMarks).toBe(false); // Mark removed, clean merged text!

    editor.destroy();
  });

  it('rejects suggestion_insert: removes inserted text from document', () => {
    const editor = new Editor({
      extensions: [StarterKit, SuggestionInsert, SuggestionDelete],
      content: '<p>Hello <span class="suggestion-insert" data-suggestion-id="s2">Unwanted Agent Text</span>!</p>',
    });

    // Reject suggestion: delete range
    editor.chain().deleteRange({ from: 7, to: 26 }).run();

    expect(editor.getText().replace(/\s+/g, ' ').trim()).toBe('Hello !');

    editor.destroy();
  });

  it('accepts suggestion_delete: deletes range permanently', () => {
    const editor = new Editor({
      extensions: [StarterKit, SuggestionInsert, SuggestionDelete],
      content: '<p>Keep this. <span class="suggestion-delete" data-suggestion-id="s3">Remove this.</span> End.</p>',
    });

    // Accept delete: permanently delete the marked text
    editor.chain().deleteRange({ from: 12, to: 25 }).run();

    expect(editor.getText().replace(/\s+/g, ' ').trim()).toBe('Keep this. End.');

    editor.destroy();
  });

  it('rejects suggestion_delete: retains original text and removes suggestion mark', () => {
    const editor = new Editor({
      extensions: [StarterKit, SuggestionInsert, SuggestionDelete],
      content: '<p>Keep this. <span class="suggestion-delete" data-suggestion-id="s4">Crucial Text.</span> End.</p>',
    });

    // Reject delete: unmark suggestion_delete
    editor.chain().setTextSelection({ from: 12, to: 26 }).unsetMark('suggestion_delete').run();

    expect(editor.getText().replace(/\s+/g, ' ').trim()).toBe('Keep this. Crucial Text. End.');

    const json = editor.getJSON();
    const hasAnyMarks = json.content?.[0]?.content?.some((n: any) => n.marks && n.marks.length > 0);
    expect(hasAnyMarks).toBe(false); // Mark removed, clean merged original text!

    editor.destroy();
  });
});
