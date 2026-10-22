import { NodeSpec } from 'prosemirror-model';

/**
 * Fenced code block node with language attribute and full whitespace preservation.
 * Child text nodes (content: 'text*') enable fine-grained character-level CRDT merging.
 */
export const codeBlockNode: NodeSpec = {
  attrs: {
    language: { default: '' },
  },
  content: 'text*',
  group: 'block',
  code: true,
  defining: true,
  isolating: true,
  marks: '', // Disallow formatting marks within code blocks
  parseDOM: [
    {
      tag: 'pre',
      preserveWhitespace: 'full',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        const langAttr = el.getAttribute('data-language');
        if (langAttr) {
          return { language: langAttr };
        }
        const codeEl = el.querySelector('code');
        const className = codeEl?.className || el.className || '';
        const match = /(?:lang|language)-([a-zA-Z0-9_-]+)/.exec(className);
        return { language: match ? match[1] : '' };
      },
    },
  ],
  toDOM(node) {
    const lang = node.attrs.language || '';
    return [
      'pre',
      {
        class: lang ? `language-${lang}` : '',
        'data-language': lang,
      },
      ['code', { spellcheck: 'false' }, 0],
    ];
  },
};
