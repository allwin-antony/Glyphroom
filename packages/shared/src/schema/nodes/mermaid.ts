import { NodeSpec } from 'prosemirror-model';

/**
 * Sandboxed Mermaid Diagram node.
 * Uses child text nodes (content: 'text*') so Yjs CRDT manages diagram source code
 * character-by-character without overwriting block attributes.
 * Enforces securityLevel: 'strict'.
 */
export const mermaidBlockNode: NodeSpec = {
  attrs: {
    securityLevel: { default: 'strict' },
  },
  content: 'text*',
  group: 'block',
  code: true,
  defining: true,
  isolating: true,
  marks: '', // Disallow formatting marks inside mermaid syntax
  parseDOM: [
    {
      tag: 'div[data-type="mermaid"]',
      preserveWhitespace: 'full',
      contentElement: 'pre',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          securityLevel: el.getAttribute('data-security-level') || 'strict',
        };
      },
    },
    {
      tag: 'pre.mermaid',
      preserveWhitespace: 'full',
      getAttrs() {
        return { securityLevel: 'strict' };
      },
    },
  ],
  toDOM(node) {
    return [
      'div',
      {
        class: 'mermaid-block',
        'data-type': 'mermaid',
        'data-security-level': node.attrs.securityLevel || 'strict',
      },
      ['pre', { class: 'mermaid-code', spellcheck: 'false' }, 0],
    ];
  },
};
