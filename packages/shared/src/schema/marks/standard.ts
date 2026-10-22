import { MarkSpec, DOMOutputSpec } from 'prosemirror-model';

/**
 * Strong / Bold mark: renders text in bold weight.
 */
export const strongMark: MarkSpec = {
  parseDOM: [
    { tag: 'strong' },
    { tag: 'b', getAttrs: (node) => (node as HTMLElement).style.fontWeight !== 'normal' && null },
    { style: 'font-weight=400', clearMark: (m) => m.type.name === 'strong' },
    {
      style: 'font-weight',
      getAttrs: (value) => /^(bold(er)?|[5-9]\d{2})$/.test(value as string) && null,
    },
  ],
  toDOM(): DOMOutputSpec {
    return ['strong', 0];
  },
};

/**
 * Emphasis / Italic mark: renders text in italic style.
 */
export const emMark: MarkSpec = {
  parseDOM: [
    { tag: 'i' },
    { tag: 'em' },
    { style: 'font-style=italic' },
    { style: 'font-style=normal', clearMark: (m) => m.type.name === 'em' },
  ],
  toDOM(): DOMOutputSpec {
    return ['em', 0];
  },
};

/**
 * Link mark: renders hyperlink anchors with href and optional title.
 * inclusive: false ensures typed text immediately following a link does not automatically join the link.
 */
export const linkMark: MarkSpec = {
  attrs: {
    href: { default: null },
    title: { default: null },
  },
  inclusive: false,
  parseDOM: [
    {
      tag: 'a[href]',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          href: el.getAttribute('href'),
          title: el.getAttribute('title') || null,
        };
      },
    },
  ],
  toDOM(mark): DOMOutputSpec {
    const { href, title } = mark.attrs;
    return ['a', { href: href || '#', title: title || null, rel: 'noopener noreferrer' }, 0];
  },
};

/**
 * Inline Code mark: renders monospace inline code runs.
 * excludes: '_' enforces that code mark cannot co-exist with other formatting marks (bold, italic, link)
 * matching standard CommonMark inline code semantics.
 */
export const codeMark: MarkSpec = {
  excludes: '_',
  parseDOM: [{ tag: 'code' }],
  toDOM(): DOMOutputSpec {
    return ['code', 0];
  },
};
