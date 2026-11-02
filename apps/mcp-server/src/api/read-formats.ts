export type ReadFormat = 'markdown' | 'summary' | 'prosemirror_json';

export interface ReadPostOptions {
  format?: ReadFormat;
  includeSuggestions?: boolean;
}

export const SUMMARY_MAX_CHARACTERS = 500;

type JsonRecord = Record<string, any>;

interface PendingSuggestion {
  type: 'insertion' | 'deletion';
  text: string;
}

function apiContractError(message: string, code = 'INVALID_API_RESPONSE'): Error {
  return Object.assign(new Error(message), { status: 502, code });
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw apiContractError(`Glyphroom API returned invalid ${label}.`);
  }
  return value as JsonRecord;
}

function requiredString(record: JsonRecord, key: string): string {
  if (typeof record[key] !== 'string') {
    throw apiContractError(`Glyphroom API response is missing post.${key}.`);
  }
  return record[key];
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  if (maximum <= 1) return value.slice(0, maximum);
  return `${value.slice(0, maximum - 1).trimEnd()}…`;
}

export function summarizeMarkdown(markdown: string): string {
  return truncate(markdown.replace(/\s+/gu, ' ').trim(), SUMMARY_MAX_CHARACTERS);
}

export function extractMarkdownHeadings(markdown: string): string[] {
  const headings: string[] = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let fence: { character: '`' | '~'; length: number } | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (fence) {
      const closing = line.match(/^ {0,3}(`+|~+)\s*$/);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) {
        fence = undefined;
      }
      continue;
    }

    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (opening) {
      fence = {
        character: opening[1][0] as '`' | '~',
        length: opening[1].length,
      };
      continue;
    }

    const atx = line.match(/^ {0,3}#{1,6}[\t ]+(.+?)\s*$/);
    if (atx) {
      const heading = atx[1].replace(/[\t ]+#+[\t ]*$/, '').trim();
      if (heading) headings.push(heading);
      continue;
    }

    if (index > 0 && /^ {0,3}(?:=+|-+)\s*$/.test(line)) {
      const heading = lines[index - 1].trim();
      if (heading) headings.push(heading);
    }
  }

  return headings;
}

function collectPendingSuggestions(documentJson: JsonRecord): PendingSuggestion[] {
  const suggestions = new Map<string, PendingSuggestion>();
  let anonymousId = 0;

  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const node = value as JsonRecord;

    if (typeof node.text === 'string' && Array.isArray(node.marks)) {
      for (const rawMark of node.marks) {
        if (!rawMark || typeof rawMark !== 'object' || Array.isArray(rawMark)) continue;
        const mark = rawMark as JsonRecord;
        if (mark.type !== 'suggestion_insert' && mark.type !== 'suggestion_delete') continue;

        const attrs = mark.attrs && typeof mark.attrs === 'object' && !Array.isArray(mark.attrs)
          ? mark.attrs as JsonRecord
          : {};
        if ((attrs.status ?? 'pending') !== 'pending') continue;

        const type = mark.type === 'suggestion_insert' ? 'insertion' : 'deletion';
        const id = typeof attrs.id === 'string' && attrs.id ? attrs.id : `anonymous-${anonymousId++}`;
        const key = `${type}:${id}`;
        const current = suggestions.get(key);
        if (current) current.text += node.text;
        else suggestions.set(key, { type, text: node.text });
      }
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child);
    }
  };

  visit(documentJson);
  return [...suggestions.values()];
}

function renderSuggestionAppendix(documentJson: JsonRecord): string {
  const suggestions = collectPendingSuggestions(documentJson);
  const heading = '--- PENDING SUGGESTIONS (NOT APPLIED) ---';
  if (suggestions.length === 0) return `${heading}\nNone.`;

  const items = suggestions.map((suggestion) => suggestion.type === 'insertion'
    ? `- Proposed insertion (not applied): ${JSON.stringify(suggestion.text)}`
    : `- Proposed deletion (not applied; original text remains): ${JSON.stringify(suggestion.text)}`
  );
  return `${heading}\n${items.join('\n')}`;
}

function appendSuggestions(markdown: string, documentJson: JsonRecord): string {
  const appendix = renderSuggestionAppendix(documentJson);
  return markdown ? `${markdown}\n\n${appendix}` : appendix;
}

function appendSuggestionsToSummary(summary: string, documentJson: JsonRecord): string {
  const separator = '\n\n';
  const appendixBudget = Math.floor(SUMMARY_MAX_CHARACTERS * 0.6);
  const appendix = truncate(renderSuggestionAppendix(documentJson), appendixBudget);
  const summaryBudget = SUMMARY_MAX_CHARACTERS - appendix.length - (summary ? separator.length : 0);
  const boundedSummary = truncate(summary, Math.max(0, summaryBudget));
  return boundedSummary ? `${boundedSummary}${separator}${appendix}` : appendix;
}

function requireDocumentJson(post: JsonRecord): JsonRecord {
  if (!post.documentJson || typeof post.documentJson !== 'object' || Array.isArray(post.documentJson)) {
    throw apiContractError(
      'The authorized content snapshot is unavailable in ProseMirror JSON format.',
      'FORMAT_UNAVAILABLE'
    );
  }
  return post.documentJson as JsonRecord;
}

export function formatPostForRead(
  rawPost: unknown,
  options: ReadPostOptions = {}
): {
  id: string;
  title: string;
  slug: string;
  status: string;
  author: { id: string; name: string };
  content: string;
  format: ReadFormat;
  headings: string[];
  tags: string[];
  publishedAt: string | null;
  updatedAt: string;
} {
  const post = asRecord(rawPost, 'post payload');
  const format = options.format ?? 'markdown';
  const includeSuggestions = options.includeSuggestions ?? false;
  const markdown = requiredString(post, 'derivedMarkdown');
  const author = post.author && typeof post.author === 'object' && !Array.isArray(post.author)
    ? post.author as JsonRecord
    : undefined;
  const authorId = author?.id ?? post.authorId;
  const authorName = author?.name ?? post.authorName;

  if (typeof authorId !== 'string' || typeof authorName !== 'string') {
    throw apiContractError('Glyphroom API response is missing the post author identity.');
  }
  if (!Array.isArray(post.tags) || post.tags.some((tag: unknown) => typeof tag !== 'string')) {
    throw apiContractError('Glyphroom API response contains invalid post tags.');
  }
  if (post.publishedAt !== null && typeof post.publishedAt !== 'string') {
    throw apiContractError('Glyphroom API response contains invalid post.publishedAt.');
  }

  let content: string;
  if (format === 'prosemirror_json') {
    content = JSON.stringify(requireDocumentJson(post));
  } else if (format === 'summary') {
    const summary = summarizeMarkdown(markdown);
    content = includeSuggestions
      ? appendSuggestionsToSummary(summary, requireDocumentJson(post))
      : summary;
  } else {
    content = includeSuggestions
      ? appendSuggestions(markdown, requireDocumentJson(post))
      : markdown;
  }

  return {
    id: requiredString(post, 'id'),
    title: requiredString(post, 'title'),
    slug: requiredString(post, 'slug'),
    status: requiredString(post, 'status'),
    author: { id: authorId, name: authorName },
    content,
    format,
    headings: extractMarkdownHeadings(markdown),
    tags: [...post.tags],
    publishedAt: post.publishedAt,
    updatedAt: requiredString(post, 'updatedAt'),
  };
}

/**
 * Keeps the guardrail outside format-specific content. Escaping '<' prevents
 * untrusted text from prematurely closing or opening the envelope while the
 * enclosed value remains ordinary, parseable JSON.
 */
export function wrapUntrustedJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new Error('Unable to serialize untrusted content.');
  }
  return `<UNTRUSTED_CONTENT>\n${serialized.replace(/</g, '\\u003c')}\n</UNTRUSTED_CONTENT>`;
}
