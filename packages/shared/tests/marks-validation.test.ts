import { describe, it, expect } from 'vitest';
import { Schema, DOMParser, DOMSerializer } from 'prosemirror-model';
import { blogNodes } from '../src/schema/nodes/index.js';
import {
  allMarks,
  MARK_SUGGESTION_INSERT,
  MARK_SUGGESTION_DELETE,
  MARK_ATTRIBUTION,
} from '../src/schema/marks/index.js';

describe('ProseMirror Marks Validation & DOM Round-Trip', () => {
  const schema = new Schema({ nodes: blogNodes, marks: allMarks });

  describe('suggestion_insert Mark', () => {
    it('creates an insert mark with default pending status', () => {
      const mark = schema.mark(MARK_SUGGESTION_INSERT, {
        agentId: 'agent-1',
        tokenId: 'tok-1',
        ownerUserId: 'user-1',
        timestamp: 1729600000000,
      });

      expect(mark.attrs.agentId).toBe('agent-1');
      expect(mark.attrs.status).toBe('pending');
      expect(mark.attrs.timestamp).toBe(1729600000000);
    });

    it('serializes to <ins class="suggestion-insert ..."> DOM element with data attributes', () => {
      const mark = schema.mark(MARK_SUGGESTION_INSERT, {
        id: 'hunk-123',
        agentId: 'agent-test',
        tokenId: 'pat-999',
        ownerUserId: 'user-boss',
        timestamp: 1729600000000,
        status: 'pending',
      });

      const textNode = schema.text('suggested text', [mark]);
      const serializer = DOMSerializer.fromSchema(schema);
      const dom = serializer.serializeNode(textNode);

      const ins = dom as HTMLElement;
      expect(ins.tagName.toLowerCase()).toBe('ins');
      expect(ins.getAttribute('data-suggestion-type')).toBe('insert');
      expect(ins.getAttribute('data-suggestion-id')).toBe('hunk-123');
      expect(ins.getAttribute('data-agent-id')).toBe('agent-test');
      expect(ins.getAttribute('data-token-id')).toBe('pat-999');
      expect(ins.getAttribute('data-owner-user-id')).toBe('user-boss');
      expect(ins.getAttribute('data-status')).toBe('pending');
      expect(ins.textContent).toBe('suggested text');
    });

    it('parses <ins class="suggestion-insert"> back into ProseMirror mark losslessly', () => {
      const container = document.createElement('div');
      container.innerHTML =
        '<p><ins class="suggestion-insert" data-suggestion-type="insert" data-suggestion-id="hunk-456" data-agent-id="agent-007" data-token-id="tok-1" data-owner-user-id="user-1" data-timestamp="1729600000000" data-status="pending">new text</ins></p>';

      const parser = DOMParser.fromSchema(schema);
      const doc = parser.parse(container);
      const paragraph = doc.firstChild!;
      const text = paragraph.firstChild!;

      expect(text.marks).toHaveLength(1);
      const mark = text.marks[0];
      expect(mark.type.name).toBe(MARK_SUGGESTION_INSERT);
      expect(mark.attrs.id).toBe('hunk-456');
      expect(mark.attrs.agentId).toBe('agent-007');
      expect(mark.attrs.status).toBe('pending');
      expect(mark.attrs.timestamp).toBe(1729600000000);
    });
  });

  describe('suggestion_delete Mark', () => {
    it('creates a delete mark and serializes to <del class="suggestion-delete">', () => {
      const mark = schema.mark(MARK_SUGGESTION_DELETE, {
        id: 'del-hunk-1',
        agentId: 'agent-cleaner',
        tokenId: 'tok-2',
        ownerUserId: 'user-2',
        timestamp: 1729600100000,
        status: 'pending',
      });

      const textNode = schema.text('text to remove', [mark]);
      const serializer = DOMSerializer.fromSchema(schema);
      const dom = serializer.serializeNode(textNode) as HTMLElement;

      expect(dom.tagName.toLowerCase()).toBe('del');
      expect(dom.getAttribute('data-suggestion-type')).toBe('delete');
      expect(dom.getAttribute('data-suggestion-id')).toBe('del-hunk-1');
      expect(dom.getAttribute('data-agent-id')).toBe('agent-cleaner');
      expect(dom.getAttribute('data-status')).toBe('pending');
    });

    it('parses <del class="suggestion-delete"> back into ProseMirror mark losslessly', () => {
      const container = document.createElement('div');
      container.innerHTML =
        '<p><del class="suggestion-delete" data-suggestion-type="delete" data-suggestion-id="del-1" data-agent-id="agent-1" data-token-id="tok-1" data-owner-user-id="user-1" data-timestamp="1729600000000" data-status="pending">unwanted text</del></p>';

      const parser = DOMParser.fromSchema(schema);
      const doc = parser.parse(container);
      const mark = doc.firstChild!.firstChild!.marks[0];

      expect(mark.type.name).toBe(MARK_SUGGESTION_DELETE);
      expect(mark.attrs.id).toBe('del-1');
      expect(mark.attrs.status).toBe('pending');
    });
  });

  describe('attribution Mark', () => {
    it('creates an attribution mark and round-trips via DOM', () => {
      const mark = schema.mark(MARK_ATTRIBUTION, {
        authorType: 'agent',
        agentId: 'agent-writer',
        tokenId: 'tok-7',
        ownerUserId: 'user-boss',
        acceptedBy: 'human-editor',
        acceptedAt: 1729600200000,
      });

      const textNode = schema.text('accepted provenance text', [mark]);
      const serializer = DOMSerializer.fromSchema(schema);
      const dom = serializer.serializeNode(textNode) as HTMLElement;

      expect(dom.tagName.toLowerCase()).toBe('span');
      expect(dom.getAttribute('data-attribution')).toBe('true');
      expect(dom.getAttribute('data-author-type')).toBe('agent');
      expect(dom.getAttribute('data-agent-id')).toBe('agent-writer');
      expect(dom.getAttribute('data-accepted-by')).toBe('human-editor');

      const container = document.createElement('div');
      container.innerHTML = `<p>${dom.outerHTML}</p>`;

      const parser = DOMParser.fromSchema(schema);
      const parsed = parser.parse(container);
      const text = parsed.firstChild!.firstChild!;
      const parsedMark = text.marks[0];

      expect(parsedMark.type.name).toBe(MARK_ATTRIBUTION);
      expect(parsedMark.attrs.agentId).toBe('agent-writer');
      expect(parsedMark.attrs.acceptedBy).toBe('human-editor');
      expect(parsedMark.attrs.acceptedAt).toBe(1729600200000);
    });
  });

  describe('Standard Marks Round-Trip', () => {
    it('handles strong, em, link and code parse and serialization', () => {
      const strong = schema.mark('strong');
      const em = schema.mark('em');
      const link = schema.mark('link', { href: 'https://corp.internal', title: 'Internal Hub' });

      const textNode = schema.text('rich link', [strong, em, link]);
      const serializer = DOMSerializer.fromSchema(schema);
      const dom = serializer.serializeNode(textNode) as HTMLElement;

      expect(dom.outerHTML).toContain('href="https://corp.internal"');
      expect(dom.outerHTML).toContain('strong');
      expect(dom.outerHTML).toContain('em');
    });
  });
});
