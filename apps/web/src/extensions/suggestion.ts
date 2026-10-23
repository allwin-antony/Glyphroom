import { Mark, mergeAttributes } from '@tiptap/core';

export interface SuggestionMarkAttrs {
  id: string;
  agentId: string;
  tokenId: string;
  ownerUserId: string;
  timestamp: number;
  status: 'pending' | 'accepted' | 'rejected';
}

export const SuggestionInsert = Mark.create({
  name: 'suggestion_insert',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      id: { default: null },
      agentId: { default: null },
      tokenId: { default: null },
      ownerUserId: { default: null },
      timestamp: { default: null },
      status: { default: 'pending' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-suggestion-type="insert"]',
        getAttrs: (element) => {
          if (typeof element === 'string') return false;
          return {
            id: element.getAttribute('data-suggestion-id'),
            agentId: element.getAttribute('data-agent-id'),
            tokenId: element.getAttribute('data-token-id'),
            ownerUserId: element.getAttribute('data-owner-id'),
            timestamp: Number(element.getAttribute('data-timestamp')),
            status: element.getAttribute('data-status') || 'pending',
          };
        },
      },
      {
        tag: 'span.suggestion-insert',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'suggestion-insert',
        'data-suggestion-type': 'insert',
        'data-suggestion-id': HTMLAttributes.id,
        'data-agent-id': HTMLAttributes.agentId,
        'data-token-id': HTMLAttributes.tokenId,
        'data-owner-id': HTMLAttributes.ownerUserId,
        'data-timestamp': HTMLAttributes.timestamp,
        'data-status': HTMLAttributes.status,
      }),
      0,
    ];
  },
});

export const SuggestionDelete = Mark.create({
  name: 'suggestion_delete',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      id: { default: null },
      agentId: { default: null },
      tokenId: { default: null },
      ownerUserId: { default: null },
      timestamp: { default: null },
      status: { default: 'pending' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-suggestion-type="delete"]',
        getAttrs: (element) => {
          if (typeof element === 'string') return false;
          return {
            id: element.getAttribute('data-suggestion-id'),
            agentId: element.getAttribute('data-agent-id'),
            tokenId: element.getAttribute('data-token-id'),
            ownerUserId: element.getAttribute('data-owner-id'),
            timestamp: Number(element.getAttribute('data-timestamp')),
            status: element.getAttribute('data-status') || 'pending',
          };
        },
      },
      {
        tag: 'span.suggestion-delete',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'suggestion-delete',
        'data-suggestion-type': 'delete',
        'data-suggestion-id': HTMLAttributes.id,
        'data-agent-id': HTMLAttributes.agentId,
        'data-token-id': HTMLAttributes.tokenId,
        'data-owner-id': HTMLAttributes.ownerUserId,
        'data-timestamp': HTMLAttributes.timestamp,
        'data-status': HTMLAttributes.status,
      }),
      0,
    ];
  },
});
