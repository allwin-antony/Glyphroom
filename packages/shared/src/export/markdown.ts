import { Node as ProseMirrorNode } from 'prosemirror-model';
import { MARK_SUGGESTION_INSERT, MARK_SUGGESTION_DELETE } from '../schema/marks/constants.js';
import { ProseMirrorNodeJSON, nodeFromJSON } from '../schema/json.js';
import { blogSchema } from '../schema/index.js';

/**
 * Derives a clean Markdown representation of a document for public reader view,
 * search indexing, or publishing.
 *
 * Rules:
 * - Pending insertions (`suggestion_insert` with `status: 'pending'`): DROPPED completely.
 * - Pending deletions (`suggestion_delete` with `status: 'pending'`): RETAINED as original text (mark stripped).
 * - Accepted insertions: RETAINED as normal text.
 * - Accepted deletions: DROPPED (already deleted).
 * - Standard marks (strong, em, link, code) are serialized to markdown equivalents.
 * - Raw JSON inputs are normalized via nodeFromJSON(blogSchema, input) for uniform AST handling.
 * - Blocks containing only pending insertions export cleanly as empty without dangling syntax prefixes.
 */
export function exportDerivedMarkdown(input: ProseMirrorNode | ProseMirrorNodeJSON): string {
  if (!input || typeof input !== 'object') {
    return '';
  }
  if (input instanceof ProseMirrorNode) {
    return serializeNodeToMarkdown(input);
  }
  try {
    const node = nodeFromJSON(blogSchema, input);
    return serializeNodeToMarkdown(node);
  } catch {
    return serializeJsonToMarkdown(input);
  }
}

function serializeNodeToMarkdown(node: ProseMirrorNode): string {
  switch (node.type.name) {
    case 'doc': {
      const parts: string[] = [];
      node.forEach((child) => {
        const text = serializeNodeToMarkdown(child);
        if (text) parts.push(text);
      });
      return parts.join('\n\n');
    }

    case 'paragraph': {
      let content = '';
      node.forEach((child) => {
        content += serializeInlineNode(child);
      });
      return content;
    }

    case 'heading': {
      const level = node.attrs.level || 1;
      const prefix = '#'.repeat(level) + ' ';
      let content = '';
      node.forEach((child) => {
        content += serializeInlineNode(child);
      });
      if (!content.trim()) {
        return '';
      }
      return prefix + content;
    }

    case 'blockquote': {
      const inner = serializeBlockChildren(node);
      if (!inner.trim()) {
        return '';
      }
      return inner
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    }

    case 'callout_alert':
    case 'alert': {
      const inner = serializeBlockChildren(node);
      if (!inner.trim()) {
        return '';
      }
      const rawType = node.attrs.alertType || node.attrs.type || 'NOTE';
      const type = typeof rawType === 'string' ? rawType.toUpperCase() : 'NOTE';
      const header = `> [!${type}]`;
      const body = inner
        ? '\n' +
          inner
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n')
        : '';
      return header + body;
    }

    case 'code_block': {
      const lang = node.attrs.language || '';
      return `\`\`\`${lang}\n${node.textContent}\n\`\`\``;
    }

    case 'mermaid_block': {
      return `\`\`\`mermaid\n${node.textContent}\n\`\`\``;
    }

    case 'math_display': {
      return `$$\n${node.attrs.tex || ''}\n$$`;
    }

    case 'bullet_list': {
      const items: string[] = [];
      node.forEach((child) => {
        const item = serializeListItem(child, '- ');
        if (item) items.push(item);
      });
      return items.join('\n');
    }

    case 'ordered_list': {
      const items: string[] = [];
      const start = node.attrs.order || 1;
      let idx = start;
      node.forEach((child) => {
        const item = serializeListItem(child, `${idx}. `);
        if (item) {
          items.push(item);
          idx++;
        }
      });
      return items.join('\n');
    }

    case 'horizontal_rule': {
      return '---';
    }

    case 'table': {
      return serializeTableNode(node);
    }

    default:
      return node.textContent || '';
  }
}

function serializeBlockChildren(node: ProseMirrorNode): string {
  const parts: string[] = [];
  node.forEach((child) => {
    const text = serializeNodeToMarkdown(child);
    if (text) parts.push(text);
  });
  return parts.join('\n\n');
}

function serializeListItem(itemNode: ProseMirrorNode, prefix: string): string {
  const parts: string[] = [];
  itemNode.forEach((child) => {
    const text = serializeNodeToMarkdown(child);
    if (text) parts.push(text);
  });
  const content = parts.join('\n');
  if (!content.trim()) {
    return '';
  }
  return prefix + content;
}

function serializeInlineNode(node: ProseMirrorNode): string {
  // Inspect marks for suggestion rules (applies to both text and math_inline)
  for (const mark of node.marks) {
    if (mark.type.name === MARK_SUGGESTION_INSERT) {
      const status = mark.attrs.status || 'pending';
      if (status === 'pending' || status === 'rejected') {
        // Strip unreviewed or rejected insertions completely
        return '';
      }
      // If accepted, keep text
    }

    if (mark.type.name === MARK_SUGGESTION_DELETE) {
      const status = mark.attrs.status || 'pending';
      if (status === 'pending') {
        // Retain original text for pending deletion (do not strike through in reader export)
        // Continue to format
      } else if (status === 'accepted') {
        // Accepted deletion means the text is deleted
        return '';
      }
    }
  }

  if (node.type.name === 'math_inline') {
    return `$${node.attrs.tex || ''}$`;
  }

  if (!node.isText) {
    return '';
  }

  let text = node.text || '';
  if (!text) {
    return '';
  }

  // Apply standard markdown marks
  for (const mark of node.marks) {
    if (mark.type.name === 'strong') {
      text = `**${text}**`;
    } else if (mark.type.name === 'em') {
      text = `*${text}*`;
    } else if (mark.type.name === 'code') {
      text = `\`${text}\``;
    } else if (mark.type.name === 'link') {
      text = `[${text}](${mark.attrs.href || ''})`;
    }
  }

  return text;
}

function serializeTableNode(tableNode: ProseMirrorNode): string {
  const rows: string[][] = [];

  tableNode.forEach((rowNode) => {
    const rowCells: string[] = [];
    rowNode.forEach((cellNode) => {
      let cellText = '';
      cellNode.forEach((para) => {
        let paraText = '';
        para.forEach((inline) => {
          paraText += serializeInlineNode(inline);
        });
        if (paraText) {
          cellText += (cellText ? ' ' : '') + paraText;
        }
      });
      rowCells.push(cellText.trim());
    });
    rows.push(rowCells);
  });

  if (rows.length === 0) return '';

  const colCount = rows[0].length;
  const header = '| ' + rows[0].join(' | ') + ' |';
  const divider = '| ' + Array(colCount).fill('---').join(' | ') + ' |';
  const bodyRows = rows.slice(1).map((r) => '| ' + r.join(' | ') + ' |');

  return [header, divider, ...bodyRows].join('\n');
}

// Fallback JSON-based serializer
function serializeJsonToMarkdown(json: ProseMirrorNodeJSON): string {
  if (!json || typeof json !== 'object') {
    return '';
  }
  if (json.type === 'doc' && json.content) {
    return json.content.map(serializeJsonToMarkdown).filter(Boolean).join('\n\n');
  }
  if (json.type === 'paragraph' && json.content) {
    return json.content.map(serializeJsonInline).join('');
  }
  if (json.type === 'heading' && json.content) {
    const level = json.attrs?.level || 1;
    const content = json.content.map(serializeJsonInline).join('');
    if (!content.trim()) {
      return '';
    }
    return '#'.repeat(level) + ' ' + content;
  }
  if (json.type === 'blockquote' && json.content) {
    const inner = json.content.map(serializeJsonToMarkdown).filter(Boolean).join('\n\n');
    if (!inner.trim()) {
      return '';
    }
    return inner
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
  }
  if ((json.type === 'alert' || json.type === 'callout_alert') && json.content) {
    const inner = json.content.map(serializeJsonToMarkdown).filter(Boolean).join('\n\n');
    if (!inner.trim()) {
      return '';
    }
    const rawType = json.attrs?.alertType || json.attrs?.type || 'NOTE';
    const type = typeof rawType === 'string' ? rawType.toUpperCase() : 'NOTE';
    return `> [!${type}]\n` + inner.split('\n').map((line) => `> ${line}`).join('\n');
  }
  if (json.type === 'code_block') {
    const lang = json.attrs?.language || '';
    const text = json.content?.map((c) => c.text || '').join('') || '';
    return `\`\`\`${lang}\n${text}\n\`\`\``;
  }
  return json.text || '';
}

function serializeJsonInline(child: ProseMirrorNodeJSON): string {
  if (!child || typeof child !== 'object') {
    return '';
  }
  const marks = child.marks || [];

  for (const mark of marks) {
    if (mark.type === MARK_SUGGESTION_INSERT) {
      const status = mark.attrs?.status || 'pending';
      if (status === 'pending' || status === 'rejected') {
        return '';
      }
    }
    if (mark.type === MARK_SUGGESTION_DELETE) {
      const status = mark.attrs?.status || 'pending';
      if (status === 'accepted') {
        return '';
      }
    }
  }

  if (child.type === 'math_inline') {
    return `$${child.attrs?.tex || ''}$`;
  }

  let text = child.text || '';
  if (!text) {
    return '';
  }

  for (const mark of marks) {
    if (mark.type === 'strong') text = `**${text}**`;
    else if (mark.type === 'em') text = `*${text}*`;
    else if (mark.type === 'code') text = `\`${text}\``;
    else if (mark.type === 'link') text = `[${text}](${mark.attrs?.href || ''})`;
  }

  return text;
}
