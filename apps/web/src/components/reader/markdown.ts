// Conservative, read-only Markdown parser for the shared export grammar.
//
// Produces a tree of presentation blocks rendered by MarkdownRenderer.
// Mirrors the grammar emitted by packages/shared/src/export/markdown.ts
// (exportDerivedMarkdown): headings, inline emphasis/code/strike, links,
// images, fenced code blocks (including longer fences), ordered/unordered
// and task lists, quotes/alerts, tables (escaped pipes), Mermaid diagrams,
// display/inline math, status-block HTML comments, attachments, horizontal
// rules and plain text.
//
// Nothing here executes code or inserts raw HTML. Inline content is parsed
// into InlineNode trees that are rendered as escaped React text.

import { isAllowedUrl } from './security.js';

export interface InlineNode {
  type:
    | 'text'
    | 'strong'
    | 'em'
    | 'strike'
    | 'code'
    | 'link'
    | 'image'
    | 'inlineMath';
  content: string;
  href?: string;
  src?: string;
  alt?: string;
}

export interface StatusAttrs {
  ragStatus: 'green' | 'amber' | 'red';
  milestoneTitle: string;
  completionPercent: number;
  targetDate: string;
  blockers: string;
}

export interface BlockNode {
  type:
    | 'heading'
    | 'paragraph'
    | 'codeBlock'
    | 'mermaid'
    | 'mathDisplay'
    | 'bulletList'
    | 'orderedList'
    | 'taskList'
    | 'alert'
    | 'blockquote'
    | 'table'
    | 'hr'
    | 'statusBlock'
    | 'text';
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  id?: string;
  lang?: string;
  code?: string;
  tex?: string;
  alertType?: string;
  items?: InlineNode[][]; // bullet/ordered list items (each item = inline nodes)
  taskItems?: { checked: boolean; inlines: InlineNode[] }[];
  rows?: string[][]; // table cells (raw text, pipes already unescaped)
  attrs?: StatusAttrs;
  text?: string;
}

interface ListItem {
  ordered: boolean;
  checked: boolean | null;
  inlines: InlineNode[];
}

// One or more asterisks/backticks/tildes fenced block opener: ```, ~~~, ```` etc.
const FENCE_RE = /^(\~\~\~|`{3,})\s*(\w*)/;
const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const ALERT_RE = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](.*)$/i;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
const HR_RE = /^(---|\*\*\*|___)\s*$/;
const STATUS_BLOCK_RE = /^<!--\s*status-block\s+([\s\S]+?)\s*-->\s*$/;
const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;
const TABLE_DIVIDER_RE = /^\s*\|?\s*:?-{3,}\s*(\|(?:\s*:?-{3,}\s*)*)\|?\s*$/;
const TASK_RE = /^([*\-])\s+\[([ xX])\]\s+(.*)$/s;
const ORDERED_RE = /^(\d+)\.\s+(.*)$/s;
const UNORDERED_RE = /^([*\-])\s+(.*)$/s;

// Inline tokens, tried in alternation order at each scan position:
// strong before em so `**b**` is not split into two `*` tokens.
// image before link so `![alt](src)` is captured as an image.
// inline math `$...$` last (no whitespace/newline inside).
const INLINE_SPLIT =
  /(\*\*[^*]+?\*\*|\*[^*]+?\*|~~[^~]+?~~|`[^`]+?`|!\[[^\]]*\]\([^)]*\)|\[[^\]]*\]\([^)]*\)|\$[^$\n]+\$)/g;
const IMAGE_RE = /^!\[([^\]]*)\]\(([^)]*)\)$/;
const LINK_RE = /^\[([^\]]*)\]\(([^)]*)\)$/;
const MATH_RE = /^\$(.+)\$$/;

/** Parse inline markdown into a sequence of InlineNode trees. */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let lastIndex = 0;
  INLINE_SPLIT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_SPLIT.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) nodes.push({ type: 'text', content: before });
    const token = match[1];
    lastIndex = INLINE_SPLIT.lastIndex;

    const img = token.match(IMAGE_RE);
    if (img) {
      const src = isAllowedUrl(img[2]) ? img[2] : '';
      nodes.push({ type: 'image', content: img[1], src, alt: img[1] });
      continue;
    }
    const lnk = token.match(LINK_RE);
    if (lnk) {
      const href = isAllowedUrl(lnk[2]) ? lnk[2] : '';
      nodes.push({ type: 'link', content: lnk[1], href });
      continue;
    }
    const math = token.match(MATH_RE);
    if (math) {
      nodes.push({ type: 'inlineMath', content: math[1] });
      continue;
    }
    if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      nodes.push({ type: 'strong', content: token.slice(2, -2) });
      continue;
    }
    if (token.startsWith('~~') && token.endsWith('~~') && token.length > 4) {
      nodes.push({ type: 'strike', content: token.slice(2, -2) });
      continue;
    }
    if (token.startsWith('*') && token.endsWith('*') && token.length > 2) {
      nodes.push({ type: 'em', content: token.slice(1, -1) });
      continue;
    }
    if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
      nodes.push({ type: 'code', content: token.slice(1, -1) });
      continue;
    }
    // Fallback: unknown token stays readable text.
    nodes.push({ type: 'text', content: token });
  }
  const rest = text.slice(lastIndex);
  if (rest) nodes.push({ type: 'text', content: rest });
  return nodes;
}

function parseListItem(line: string): ListItem | null {
  const m = line.match(TASK_RE);
  if (m) return { ordered: false, checked: m[2].toLowerCase() === 'x', inlines: parseInline(m[3]) };
  const m2 = line.match(ORDERED_RE);
  if (m2) return { ordered: true, checked: null, inlines: parseInline(m2[2]) };
  const m3 = line.match(UNORDERED_RE);
  if (m3) return { ordered: false, checked: null, inlines: parseInline(m3[2]) };
  return null;
}

function parseTableRow(line: string): string[] {
  const inner = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '');
  // Split on pipes that are not escaped (`\|`), then unescape them back to `|`.
  // Implemented without a lookbehind regex for broader transform compatibility.
  const cells: string[] = [];
  let cur = '';
  let k = 0;
  while (k < inner.length) {
    if (inner[k] === '\\' && k + 1 < inner.length) {
      cur += inner.slice(k, k + 2);
      k += 2;
      continue;
    }
    if (inner[k] === '|') {
      cells.push(cur);
      cur = '';
      k++;
      continue;
    }
    cur += inner[k];
    k++;
  }
  cells.push(cur);
  return cells.map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

const RAG_STATUSES = ['green', 'amber', 'red'] as const;

function parseStatusAttrs(input: string): StatusAttrs {
  const attrs: Partial<StatusAttrs> = {};
  const attrRe = /([a-zA-Z]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(input)) !== null) {
    const key = match[1] as keyof StatusAttrs;
    const val = match[2];
    if (key === 'ragStatus') {
      attrs.ragStatus = RAG_STATUSES.includes(val as 'green') ? (val as 'green') : 'green';
    } else if (key === 'milestoneTitle') {
      attrs.milestoneTitle = val;
    } else if (key === 'completionPercent') {
      const n = Number(val);
      attrs.completionPercent = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
    } else if (key === 'targetDate') {
      attrs.targetDate = val;
    } else if (key === 'blockers') {
      attrs.blockers = val;
    }
  }
  return {
    ragStatus: (attrs.ragStatus ?? 'green') as 'green' | 'amber' | 'red',
    milestoneTitle: attrs.milestoneTitle ?? '',
    completionPercent: attrs.completionPercent ?? 0,
    targetDate: attrs.targetDate ?? '',
    blockers: attrs.blockers ?? '',
  };
}

export interface ParseResult {
  blocks: BlockNode[];
  headingCount: number;
}

/** Parse a full Markdown document into presentation blocks. */
export function parseMarkdown(markdown: string): ParseResult {
  const lines = markdown.split('\n');
  const blocks: BlockNode[] = [];
  let headingCount = 0;
  let i = 0;
  const n = lines.length;

  let paraLines: string[] = [];
  const flushPara = () => {
    if (paraLines.length) {
      blocks.push({ type: 'paragraph', text: paraLines.join(' ') });
      paraLines = [];
    }
  };

  let listItems: ListItem[] = [];
  const flushList = () => {
    if (listItems.length === 0) return;
    const ordered = listItems.every((it) => it.ordered);
    const allTasks = listItems.every((it) => it.checked !== null);
    if (ordered) {
      blocks.push({ type: 'orderedList', items: listItems.map((it) => it.inlines) });
    } else if (allTasks) {
      blocks.push({
        type: 'taskList',
        taskItems: listItems.map((it) => ({ checked: it.checked!, inlines: it.inlines })),
      });
    } else {
      blocks.push({ type: 'bulletList', items: listItems.map((it) => it.inlines) });
    }
    listItems = [];
  };

  while (i < n) {
    const line = lines[i];

    // --- Fenced code / Mermaid blocks (``` or ~~~ or longer fences) ---
    const fence = line.match(FENCE_RE);
    if (fence) {
      const lang = (fence[2] || '').toLowerCase();
      const opener = fence[1];
      const closerLen = opener.length;
      const content: string[] = [];
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (lines[j].startsWith(opener) && lines[j].trim().length === closerLen) {
          closed = true;
          break;
        }
        content.push(lines[j]);
        j++;
      }
      flushPara();
      flushList();
      // Malformed fence opener with no readable body: keep the raw opener line
      // as plain text so malformed syntax stays readable and never silently
      // disappears (renderer invariant, markdown.ts L13-14). Closed fences and
      // unclosed fences with a non-empty body keep their existing behavior.
      if (!closed && content.every((l) => l.trim() === '')) {
        blocks.push({ type: 'text', text: line });
      } else if (lang === 'mermaid') {
        blocks.push({ type: 'mermaid', code: content.join('\n') });
      } else {
        blocks.push({ type: 'codeBlock', lang, code: content.join('\n') });
      }
      i = closed ? j + 1 : n;
      continue;
    }

    // --- Display math $$ ... $$ ---
    if (line.trim() === '$$') {
      const content: string[] = [];
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (lines[j].trim() === '$$') {
          closed = true;
          break;
        }
        content.push(lines[j]);
        j++;
      }
      flushPara();
      flushList();
      blocks.push({ type: 'mathDisplay', tex: content.join('\n') });
      i = closed ? j + 1 : n;
      continue;
    }

    // --- Headings (levels 1-6; ids match Table of Contents scheme) ---
    const h = line.match(HEADING_RE);
    if (h) {
      flushPara();
      flushList();
      const level = h[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: 'heading', level, id: `heading-${headingCount++}`, text: h[2] });
      i++;
      continue;
    }

    // --- Status block HTML comment (exact serialization, not arbitrary HTML) ---
    const sb = line.match(STATUS_BLOCK_RE);
    if (sb) {
      flushPara();
      flushList();
      blocks.push({ type: 'statusBlock', attrs: parseStatusAttrs(sb[1]) });
      i++;
      continue;
    }

    // --- Alerts > [!TYPE] ---
    const al = line.match(ALERT_RE);
    if (al) {
      const alertType = ((al[1] || 'NOTE').toUpperCase() as 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION') || 'NOTE';
      const bodyLines = [al[2].trim()];
      let j = i + 1;
      while (j < n && BLOCKQUOTE_RE.test(lines[j])) {
        bodyLines.push(lines[j].match(BLOCKQUOTE_RE)![1]);
        j++;
      }
      flushPara();
      flushList();
      blocks.push({ type: 'alert', alertType, text: bodyLines.join(' ') });
      i = j;
      continue;
    }

    // --- Blockquote > ---
    if (BLOCKQUOTE_RE.test(line)) {
      const body: string[] = [];
      let j = i;
      while (j < n && BLOCKQUOTE_RE.test(lines[j])) {
        body.push(lines[j].match(BLOCKQUOTE_RE)![1]);
        j++;
      }
      flushPara();
      flushList();
      blocks.push({ type: 'blockquote', text: body.join(' ') });
      i = j;
      continue;
    }

    // --- Horizontal rule ---
    if (HR_RE.test(line.trim())) {
      flushPara();
      flushList();
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // --- Table (header row, divider row, body rows) ---
    if (TABLE_ROW_RE.test(line)) {
      const next = lines[i + 1];
      if (next && TABLE_DIVIDER_RE.test(next)) {
        const rows: string[][] = [parseTableRow(line)];
        let j = i + 2;
        while (j < n && TABLE_ROW_RE.test(lines[j])) {
          rows.push(parseTableRow(lines[j]));
          j++;
        }
        flushPara();
        flushList();
        blocks.push({ type: 'table', rows });
        i = j;
        continue;
      }
    }

    // --- List items ---
    const li = parseListItem(line);
    if (li) {
      flushPara();
      listItems.push(li);
      i++;
      continue;
    }
    if (listItems.length > 0) flushList();

    // --- Blank line ends paragraph ---
    if (!line.trim()) {
      flushPara();
      i++;
      continue;
    }

    // --- Paragraph prose ---
    paraLines.push(line);
    i++;
  }

  flushPara();
  flushList();

  return { blocks, headingCount };
}
