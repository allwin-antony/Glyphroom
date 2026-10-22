import { NodeSpec } from 'prosemirror-model';

/**
 * Top-level document root node.
 * Must contain one or more block nodes.
 */
export const docNode: NodeSpec = {
  content: 'block+',
};

/**
 * Standard paragraph container for inline phrased content.
 */
export const paragraphNode: NodeSpec = {
  content: 'inline*',
  group: 'block',
  parseDOM: [{ tag: 'p' }],
  toDOM() {
    return ['p', 0];
  },
};

/**
 * Primitive leaf inline node representing text characters.
 */
export const textNode: NodeSpec = {
  group: 'inline',
};

/**
 * Heading node with level attribute 1 through 6.
 */
export const headingNode: NodeSpec = {
  attrs: {
    level: { default: 1 },
  },
  content: 'inline*',
  group: 'block',
  defining: true,
  parseDOM: [
    { tag: 'h1', attrs: { level: 1 } },
    { tag: 'h2', attrs: { level: 2 } },
    { tag: 'h3', attrs: { level: 3 } },
    { tag: 'h4', attrs: { level: 4 } },
    { tag: 'h5', attrs: { level: 5 } },
    { tag: 'h6', attrs: { level: 6 } },
  ],
  toDOM(node) {
    const level = Math.min(Math.max(node.attrs.level || 1, 1), 6);
    return [`h${level}`, 0];
  },
};

/**
 * Bullet / unordered list container.
 */
export const bulletListNode: NodeSpec = {
  content: 'list_item+',
  group: 'block',
  parseDOM: [{ tag: 'ul' }],
  toDOM() {
    return ['ul', 0];
  },
};

/**
 * Ordered list container with start order attribute.
 */
export const orderedListNode: NodeSpec = {
  attrs: {
    order: { default: 1 },
  },
  content: 'list_item+',
  group: 'block',
  parseDOM: [
    {
      tag: 'ol',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          order: el.hasAttribute('start') ? parseInt(el.getAttribute('start')!, 10) : 1,
        };
      },
    },
  ],
  toDOM(node) {
    return node.attrs.order === 1 ? ['ol', 0] : ['ol', { start: node.attrs.order }, 0];
  },
};

/**
 * Individual list item within an ordered or bullet list.
 */
export const listItemNode: NodeSpec = {
  content: 'paragraph block*',
  defining: true,
  parseDOM: [{ tag: 'li' }],
  toDOM() {
    return ['li', 0];
  },
};

/**
 * Standard blockquote container for quoted block content.
 */
export const blockquoteNode: NodeSpec = {
  content: 'block+',
  group: 'block',
  defining: true,
  parseDOM: [{ tag: 'blockquote' }],
  toDOM() {
    return ['blockquote', 0];
  },
};

/**
 * Thematic break / horizontal separator atom.
 */
export const horizontalRuleNode: NodeSpec = {
  group: 'block',
  atom: true,
  parseDOM: [{ tag: 'hr' }],
  toDOM() {
    return ['hr'];
  },
};
