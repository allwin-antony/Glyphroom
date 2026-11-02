import { describe, it, expect } from 'vitest';
import { normalizeMarkdownInput } from '../src/export/markdown.js';

describe('normalizeMarkdownInput', () => {
  it('returns empty string on empty or non-string input', () => {
    expect(normalizeMarkdownInput('')).toBe('');
    expect(normalizeMarkdownInput(null as any)).toBe('');
    expect(normalizeMarkdownInput(undefined as any)).toBe('');
  });

  it('normalizes carriage returns (\\r\\n -> \\n)', () => {
    const raw = '# Title\r\n\r\nParagraph text\r\n';
    expect(normalizeMarkdownInput(raw)).toBe('# Title\n\nParagraph text\n');
  });

  it('unescapes double-escaped newlines when payload has no raw newlines', () => {
    const raw = 'First Post\\n\\nThis draft was generated and created via the Glyphroom MCP tool interface.\\n\\n> [!NOTE]\\n> Created with active PAT authentication.';
    const normalized = normalizeMarkdownInput(raw);
    expect(normalized).toBe(
      'First Post\n\nThis draft was generated and created via the Glyphroom MCP tool interface.\n\n> [!NOTE]\n> Created with active PAT authentication.'
    );
  });

  it('preserves code strings with escaped newlines when raw newlines already exist', () => {
    const raw = '# Code Sample\n\n```javascript\nconst msg = "hello\\nworld";\n```\n';
    expect(normalizeMarkdownInput(raw)).toBe(raw);
  });

  it('unescapes mixed double-escaped paragraph and heading boundaries', () => {
    const raw = '# Section 1\nContent line 1\\n\\n## Section 2\\nContent line 2';
    const normalized = normalizeMarkdownInput(raw);
    expect(normalized).toBe('# Section 1\nContent line 1\n\n## Section 2\nContent line 2');
  });
});

