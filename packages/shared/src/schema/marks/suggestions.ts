import { MarkSpec, DOMOutputSpec } from 'prosemirror-model';

/**
 * Suggestion Insert Mark
 * Wraps inline text proposed for addition by an AI agent.
 */
export const suggestionInsertMark: MarkSpec = {
  attrs: {
    id: { default: null },           // Unique UUID identifying this suggestion hunk
    agentId: { default: '' },        // Identifier of the agent (e.g., 'agent:researcher:v1')
    tokenId: { default: '' },        // Personal Access Token UUID authorizing the edit
    ownerUserId: { default: '' },    // Human owner who authorized the token
    timestamp: { default: 0 },       // Epoch milliseconds when suggestion was generated
    status: { default: 'pending' },  // 'pending' | 'accepted' | 'rejected'
  },
  inclusive: false,
  excludes: 'suggestion_delete',
  parseDOM: [
    {
      tag: 'ins.suggestion-insert',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          id: el.getAttribute('data-suggestion-id') || null,
          agentId: el.getAttribute('data-agent-id') || '',
          tokenId: el.getAttribute('data-token-id') || '',
          ownerUserId: el.getAttribute('data-owner-user-id') || '',
          timestamp: el.getAttribute('data-timestamp') ? Number(el.getAttribute('data-timestamp')) : 0,
          status: el.getAttribute('data-status') || 'pending',
        };
      },
    },
    {
      tag: 'span[data-suggestion-type="insert"]',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          id: el.getAttribute('data-suggestion-id') || null,
          agentId: el.getAttribute('data-agent-id') || '',
          tokenId: el.getAttribute('data-token-id') || '',
          ownerUserId: el.getAttribute('data-owner-user-id') || '',
          timestamp: el.getAttribute('data-timestamp') ? Number(el.getAttribute('data-timestamp')) : 0,
          status: el.getAttribute('data-status') || 'pending',
        };
      },
    },
  ],
  toDOM(mark): DOMOutputSpec {
    const { id, agentId, tokenId, ownerUserId, timestamp, status } = mark.attrs;
    return [
      'ins',
      {
        class: `suggestion-insert suggestion-status-${status || 'pending'}`,
        'data-suggestion-type': 'insert',
        'data-suggestion-id': id || '',
        'data-agent-id': agentId || '',
        'data-token-id': tokenId || '',
        'data-owner-user-id': ownerUserId || '',
        'data-timestamp': String(timestamp || 0),
        'data-status': status || 'pending',
      },
      0,
    ];
  },
};

/**
 * Suggestion Delete Mark
 * Wraps original text proposed for deletion by an AI agent.
 */
export const suggestionDeleteMark: MarkSpec = {
  attrs: {
    id: { default: null },           // Unique UUID identifying this suggestion hunk
    agentId: { default: '' },        // Identifier of the agent
    tokenId: { default: '' },        // Personal Access Token UUID
    ownerUserId: { default: '' },    // Human owner UUID
    timestamp: { default: 0 },       // Epoch milliseconds
    status: { default: 'pending' },  // 'pending' | 'accepted' | 'rejected'
  },
  inclusive: false,
  excludes: 'suggestion_insert',
  parseDOM: [
    {
      tag: 'del.suggestion-delete',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          id: el.getAttribute('data-suggestion-id') || null,
          agentId: el.getAttribute('data-agent-id') || '',
          tokenId: el.getAttribute('data-token-id') || '',
          ownerUserId: el.getAttribute('data-owner-user-id') || '',
          timestamp: el.getAttribute('data-timestamp') ? Number(el.getAttribute('data-timestamp')) : 0,
          status: el.getAttribute('data-status') || 'pending',
        };
      },
    },
    {
      tag: 'span[data-suggestion-type="delete"]',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          id: el.getAttribute('data-suggestion-id') || null,
          agentId: el.getAttribute('data-agent-id') || '',
          tokenId: el.getAttribute('data-token-id') || '',
          ownerUserId: el.getAttribute('data-owner-user-id') || '',
          timestamp: el.getAttribute('data-timestamp') ? Number(el.getAttribute('data-timestamp')) : 0,
          status: el.getAttribute('data-status') || 'pending',
        };
      },
    },
  ],
  toDOM(mark): DOMOutputSpec {
    const { id, agentId, tokenId, ownerUserId, timestamp, status } = mark.attrs;
    return [
      'del',
      {
        class: `suggestion-delete suggestion-status-${status || 'pending'}`,
        'data-suggestion-type': 'delete',
        'data-suggestion-id': id || '',
        'data-agent-id': agentId || '',
        'data-token-id': tokenId || '',
        'data-owner-user-id': ownerUserId || '',
        'data-timestamp': String(timestamp || 0),
        'data-status': status || 'pending',
      },
      0,
    ];
  },
};
