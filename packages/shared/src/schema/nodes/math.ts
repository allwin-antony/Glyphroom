import { NodeSpec } from 'prosemirror-model';

/**
 * Inline KaTeX math formula node.
 */
export const mathInlineNode: NodeSpec = {
  attrs: {
    tex: { default: '' },
  },
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  parseDOM: [
    {
      tag: 'span[data-type="math-inline"]',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          tex: el.getAttribute('data-tex') || el.textContent || '',
        };
      },
    },
    {
      tag: 'span.math-inline',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          tex: el.getAttribute('data-tex') || el.textContent || '',
        };
      },
    },
  ],
  toDOM(node) {
    return [
      'span',
      {
        class: 'math-inline',
        'data-type': 'math-inline',
        'data-tex': node.attrs.tex || '',
      },
      node.attrs.tex || '',
    ];
  },
};

/**
 * Display / block KaTeX math equation node.
 */
export const mathDisplayNode: NodeSpec = {
  attrs: {
    tex: { default: '' },
  },
  group: 'block',
  inline: false,
  atom: true,
  selectable: true,
  isolating: true,
  defining: true,
  parseDOM: [
    {
      tag: 'div[data-type="math-display"]',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          tex: el.getAttribute('data-tex') || el.textContent || '',
        };
      },
    },
    {
      tag: 'div.math-display',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          tex: el.getAttribute('data-tex') || el.textContent || '',
        };
      },
    },
  ],
  toDOM(node) {
    return [
      'div',
      {
        class: 'math-display',
        'data-type': 'math-display',
        'data-tex': node.attrs.tex || '',
      },
      node.attrs.tex || '',
    ];
  },
};
