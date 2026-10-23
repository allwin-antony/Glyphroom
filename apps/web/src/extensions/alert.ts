import { Node, mergeAttributes } from '@tiptap/core';

export const Alert = Node.create({
  name: 'alert',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      type: {
        default: 'note',
        parseHTML: (element) => element.getAttribute('data-alert-type') || 'note',
        renderHTML: (attributes) => ({
          'data-alert-type': attributes.type,
          class: `enterprise-alert enterprise-alert-${attributes.type}`,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div.enterprise-alert',
        getAttrs: (element) => {
          if (typeof element === 'string') return false;
          return {
            type: element.getAttribute('data-alert-type') || 'note',
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes), 0];
  },
});
