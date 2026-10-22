import { NodeSpec } from 'prosemirror-model';

export type AlertType = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION';

export const VALID_ALERT_TYPES: readonly AlertType[] = [
  'NOTE',
  'TIP',
  'IMPORTANT',
  'WARNING',
  'CAUTION',
] as const;

export function normalizeAlertType(val: unknown): AlertType {
  if (typeof val === 'string') {
    const upper = val.toUpperCase().trim() as AlertType;
    if (VALID_ALERT_TYPES.includes(upper)) {
      return upper;
    }
  }
  return 'NOTE';
}

/**
 * GitHub-style Callout Alert node (> [!NOTE], [!WARNING], etc.)
 */
export const calloutAlertNode: NodeSpec = {
  attrs: {
    alertType: { default: 'NOTE' },
  },
  content: 'block+',
  group: 'block',
  defining: true,
  isolating: true,
  parseDOM: [
    {
      tag: 'div.callout-alert',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        const rawType = el.getAttribute('data-alert-type') || el.className.match(/callout-alert-(\w+)/)?.[1];
        return {
          alertType: normalizeAlertType(rawType),
        };
      },
      contentElement: '.callout-alert-content',
    },
    {
      tag: 'blockquote.callout-alert',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        const rawType = el.getAttribute('data-alert-type');
        return {
          alertType: normalizeAlertType(rawType),
        };
      },
      contentElement: '.callout-alert-content',
    },
  ],
  toDOM(node) {
    const alertType = normalizeAlertType(node.attrs.alertType);
    return [
      'div',
      {
        class: `callout-alert callout-alert-${alertType.toLowerCase()}`,
        'data-alert-type': alertType,
      },
      [
        'div',
        { class: 'callout-alert-header' },
        ['span', { class: 'callout-alert-title' }, alertType],
      ],
      ['div', { class: 'callout-alert-content' }, 0],
    ];
  },
};
