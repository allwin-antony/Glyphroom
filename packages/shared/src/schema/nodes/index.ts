import { NodeSpec } from 'prosemirror-model';
import {
  docNode,
  paragraphNode,
  textNode,
  headingNode,
  bulletListNode,
  orderedListNode,
  listItemNode,
  blockquoteNode,
  horizontalRuleNode,
} from './core.js';
import {
  tableNode,
  tableRowNode,
  tableHeaderNode,
  tableCellNode,
} from './table.js';
import { calloutAlertNode } from './alert.js';
import { mathDisplayNode, mathInlineNode } from './math.js';
import { mermaidBlockNode } from './mermaid.js';
import { codeBlockNode } from './code.js';

export * from './core.js';
export * from './table.js';
export * from './alert.js';
export * from './math.js';
export * from './mermaid.js';
export * from './code.js';

export const blogNodes: Record<string, NodeSpec> = {
  doc: docNode,
  paragraph: paragraphNode,
  text: textNode,
  heading: headingNode,
  bullet_list: bulletListNode,
  ordered_list: orderedListNode,
  list_item: listItemNode,
  blockquote: blockquoteNode,
  horizontal_rule: horizontalRuleNode,
  table: tableNode,
  table_row: tableRowNode,
  table_header: tableHeaderNode,
  table_cell: tableCellNode,
  callout_alert: calloutAlertNode,
  math_display: mathDisplayNode,
  math_inline: mathInlineNode,
  mermaid_block: mermaidBlockNode,
  code_block: codeBlockNode,
};
