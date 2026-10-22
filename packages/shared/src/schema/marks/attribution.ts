import { MarkSpec, DOMOutputSpec } from 'prosemirror-model';

/**
 * Attribution Mark
 * Preserves durable origin metadata for accepted agent text.
 */
export const attributionMark: MarkSpec = {
  attrs: {
    authorType: { default: 'agent' }, // 'agent' | 'human'
    agentId: { default: null },
    tokenId: { default: null },
    ownerUserId: { default: null },
    acceptedBy: { default: null },
    acceptedAt: { default: 0 },
  },
  inclusive: false,
  parseDOM: [
    {
      tag: 'span[data-attribution="true"]',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          authorType: el.getAttribute('data-author-type') || 'agent',
          agentId: el.getAttribute('data-agent-id') || null,
          tokenId: el.getAttribute('data-token-id') || null,
          ownerUserId: el.getAttribute('data-owner-user-id') || null,
          acceptedBy: el.getAttribute('data-accepted-by') || null,
          acceptedAt: el.getAttribute('data-accepted-at') ? Number(el.getAttribute('data-accepted-at')) : 0,
        };
      },
    },
  ],
  toDOM(mark): DOMOutputSpec {
    const { authorType, agentId, tokenId, ownerUserId, acceptedBy, acceptedAt } = mark.attrs;
    return [
      'span',
      {
        class: `provenance-attribution author-${authorType || 'agent'}`,
        'data-attribution': 'true',
        'data-author-type': authorType || 'agent',
        'data-agent-id': agentId || '',
        'data-token-id': tokenId || '',
        'data-owner-user-id': ownerUserId || '',
        'data-accepted-by': acceptedBy || '',
        'data-accepted-at': String(acceptedAt || 0),
      },
      0,
    ];
  },
};
