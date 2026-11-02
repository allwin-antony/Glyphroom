import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import mermaid from 'mermaid';
import { exportDerivedMarkdown } from '@enterprise-blogger/shared';
import { MarkdownRenderer } from '../src/components/reader/MarkdownRenderer.js';
import { MermaidBlock } from '../src/components/reader/presenters/MermaidBlock.js';
import { ReaderView } from '../src/views/ReaderView.js';
import { ReaderPreview } from '../src/components/ReaderPreview.js';
import { parseMarkdown, parseInline } from '../src/components/reader/markdown.js';
import { AuthContext, type AuthContextValue } from '../src/context/AuthContext.js';
import { api } from '../src/lib/api.js';

vi.mock('../src/lib/api.js', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mocks for libraries jsdom cannot fully render (Mermaid SVG layout, KaTeX).
// Focused mocks; browser verification of Mermaid/KaTeX remains a later gate.
// ---------------------------------------------------------------------------

vi.mock('mermaid', () => {
  const render = vi.fn(async (_id: string, _code: string) => ({
    svg: `<svg id="${_id}"><rect width="100" height="100"/></svg>`,
  }));
  const initialize = vi.fn();
  return {
    default: { initialize, render },
    initialize,
    render,
  };
});

vi.mock('katex', () => ({
  default: {
    renderToString: vi.fn((tex: string) => `<span class="katex" data-tex="${escapeXml(tex)}">${escapeXml(tex)}</span>`),
  },
}));

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const createMockAuth = (role: 'admin' | 'moderator' | 'author' | 'reader' = 'reader', userId = 'reader-user'): AuthContextValue => ({
  user: { id: userId, userId, email: `${userId}@corp.com`, fullName: 'Reader User', role },
  csrfToken: 'mock-csrf-token',
  isLoading: false,
  isAuthenticated: true,
  login: vi.fn(),
  logout: vi.fn(),
  refreshSession: vi.fn(),
});

const renderReaderView = (post: any) => {
  cleanup();
  (api.get as any).mockImplementation((url: string) => {
    if (url.includes('/comments')) return Promise.resolve({ comments: [] });
    return Promise.resolve({ post, userPermission: 'view' });
  });
  return render(
    <AuthContext.Provider value={createMockAuth('reader', 'reader-user')}>
      <MemoryRouter initialEntries={['/posts/slug-one']}>
        <Routes>
          <Route path="/posts/:slug" element={<ReaderView />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
};

const headingId = (n: number) => `#heading-${n}`;

// Robust text presence: substring on container textContent, immune to
// "text broken up by multiple elements" for inline/nested markup.
const hasText = (container: HTMLElement, text: string) => container.textContent?.includes(text) === true;

// ---------------------------------------------------------------------------
describe('Rich Reader / Preview unified renderer (export grammar)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseMarkdown - shared export grammar structure', () => {
    it('parses headings with ids matching the TOC scheme across H1-H6', () => {
      const { blocks } = parseMarkdown('# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6');
      expect(blocks.map((b) => b.type)).toEqual(['heading', 'heading', 'heading', 'heading', 'heading', 'heading']);
      expect(blocks.map((b) => b.text)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
      expect(blocks.map((b) => b.level)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(blocks.map((b) => b.id)).toEqual([
        'heading-0',
        'heading-1',
        'heading-2',
        'heading-3',
        'heading-4',
        'heading-5',
      ]);
    });

    it('does not parse more than 6 hashes as a heading', () => {
      const { blocks } = parseMarkdown('####### Not a heading');
      expect(blocks[0].type).toBe('paragraph');
      expect(blocks[0].text).toBe('####### Not a heading');
    });

    it('parses inline emphasis, code and strike', () => {
      const nodes = parseInline('**strong** *em* ~~strike~~ `code`');
      expect(nodes.map((n) => `${n.type}:${n.content}`)).toEqual([
        'strong:strong',
        'text: ',
        'em:em',
        'text: ',
        'strike:strike',
        'text: ',
        'code:code',
      ]);
    });

    it('parses protocol-validated links and drops unsafe URLs', () => {
      const nodes = parseInline(
        '[site](https://example.com) [relative](/api/v1/x) [bad](javascript:alert(1)) [worse](data:text/html,<x>)',
      );
      // Note: parseInline returns nodes; unsafe URLs are rendered as text (link type with no href).
      expect(nodes.find((n) => n.type === 'link' && n.content === 'site')?.href).toBe('https://example.com');
      expect(nodes.find((n) => n.type === 'link' && n.content === 'bad')?.href).toBe('');
      expect(nodes.find((n) => n.type === 'link' && n.content === 'worse')?.href).toBe('');
    });

    it('parses images only for allowlisted sources', () => {
      const nodes = parseInline(
        '![logo](https://example.com/logo.png) ![evil](javascript:alert(1))',
      );
      expect(nodes.find((n) => n.type === 'image' && n.content === 'logo')?.src).toBe('https://example.com/logo.png');
      expect(nodes.find((n) => n.type === 'image' && n.content === 'evil')?.src).toBe('');
    });

    it('parses raw HTML text nodes (escaped, not executed)', () => {
      const nodes = parseInline("<script>alert('xss')</script>");
      expect(nodes.map((n) => n.content)).toContain("<script>alert('xss')</script>");
    });

    it('parses fenced code blocks including longer fences and language', () => {
      const { blocks } = parseMarkdown('```ts\nconst x = 1;\n```');
      expect(blocks[0].type).toBe('codeBlock');
      expect(blocks[0].code).toBe('const x = 1;');
      expect(blocks[0].lang).toBe('ts');

      const { blocks: longBlocks } = parseMarkdown('````\nlonger fence\n````');
      expect(longBlocks[0].type).toBe('codeBlock');
      expect(longBlocks[0].code).toBe('longer fence');
      expect(longBlocks[0].lang).toBe('');
    });

    it('parses ordered, unordered and task lists', () => {
      const md = '- apple\n- banana\n\n1. first\n2. second\n\n- [x] done\n- [ ] pending';
      const { blocks } = parseMarkdown(md);
      const types = blocks.map((b) => b.type);
      expect(types).toContain('bulletList');
      expect(types).toContain('orderedList');
      expect(types).toContain('taskList');
    });

    it('parses tables including escaped pipes without breaking structure', () => {
      const md = '| Col 1 | Col 2 |\n| --- | --- |\n| a\\|b | c |\n| d | e\\|f |';
      const { blocks } = parseMarkdown(md);
      expect(blocks[0].type).toBe('table');
      const rows = blocks[0].rows!;
      expect(rows[0]).toEqual(['Col 1', 'Col 2']);
      expect(rows[1]).toEqual(['a|b', 'c']);
      expect(rows[2]).toEqual(['d', 'e|f']);
    });

    it('parses alerts > [!TYPE]', () => {
      const { blocks } = parseMarkdown('> [!WARNING]\n> careful here');
      expect(blocks[0].type).toBe('alert');
      expect(blocks[0].alertType).toBe('WARNING');
    });

    it('parses a horizontal rule', () => {
      const { blocks } = parseMarkdown('text\n\n---\n\nmore');
      expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'hr', 'paragraph']);
    });

    it('parses an empty markdown document as nothing', () => {
      const { blocks } = parseMarkdown('');
      expect(blocks).toEqual([]);
      const { blocks: blocks2 } = parseMarkdown('   \n\n  ');
      expect(blocks2).toEqual([]);
    });

    it('parses a status block with validated/clamped attributes', () => {
      const md =
        '<!-- status-block ragStatus="red" milestoneTitle="Launch" completionPercent="110" targetDate="2026-12-01" blockers="one;two" -->';
      const { blocks } = parseMarkdown(md);
      expect(blocks[0].type).toBe('statusBlock');
      expect(blocks[0].attrs?.ragStatus).toBe('red');
      expect(blocks[0].attrs?.completionPercent).toBe(100);
      expect(blocks[0].attrs?.milestoneTitle).toBe('Launch');
      expect(blocks[0].attrs?.blockers).toBe('one;two');

      const { blocks: blocks2 } = parseMarkdown(
        '<!-- status-block ragStatus="bogus" milestoneTitle="X" -->',
      );
      expect(blocks2[0].attrs?.ragStatus).toBe('green');
    });
  });

  describe('MarkdownRenderer - shared export grammar rendering', () => {
    it('renders headings with stable ids matching the TOC scheme across H1-H6', () => {
      const md = '# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6';
      const { container } = render(<MarkdownRenderer markdown={md} mode="flow" />);
      for (let i = 0; i < 6; i++) {
        expect(container.querySelector(headingId(i))).not.toBeNull();
      }
      expect(container.querySelector('h1#heading-0')).not.toBeNull();
      expect(container.querySelector('h2#heading-1')).not.toBeNull();
      expect(container.querySelector('h3#heading-2')).not.toBeNull();
      expect(container.querySelector('h4#heading-3')).not.toBeNull();
      expect(container.querySelector('h5#heading-4')).not.toBeNull();
      expect(container.querySelector('h6#heading-5')).not.toBeNull();
      expect(hasText(container, 'H1')).toBe(true);
      expect(hasText(container, 'H2')).toBe(true);
      expect(hasText(container, 'H3')).toBe(true);
      expect(hasText(container, 'H4')).toBe(true);
      expect(hasText(container, 'H5')).toBe(true);
      expect(hasText(container, 'H6')).toBe(true);
    });

    it('renders inline emphasis, code and strike as escaped React text', () => {
      const { container } = render(<MarkdownRenderer markdown="**strong** *em* ~~strike~~ `code`" mode="flow" />);
      expect(hasText(container, 'strong')).toBe(true);
      expect(hasText(container, 'em')).toBe(true);
      expect(hasText(container, 'strike')).toBe(true);
      expect(hasText(container, 'code')).toBe(true);
      expect(container.innerHTML).not.toContain('**');
      expect(container.innerHTML).not.toContain('~~');
      expect(container.innerHTML).not.toContain('<script');
    });

    it('renders protocol-validated links and drops unsafe URLs', () => {
      const { container, getAllByRole, queryByRole } = render(
        <MarkdownRenderer
          markdown="[site](https://example.com) [relative](/api/v1/x) [bad](javascript:alert(1)) [worse](data:text/html,<x>)"
          mode="flow"
        />,
      );
      const links = getAllByRole('link');
      expect(links.map((l) => l.textContent)).toContain('site');
      expect(links.map((l) => l.getAttribute('href'))).toContain('https://example.com');
      expect(links.map((l) => l.getAttribute('href'))).toContain('/api/v1/x');
      expect(hasText(container, 'bad')).toBe(true);
      expect(hasText(container, 'worse')).toBe(true);
      expect(queryByRole('link', { name: 'bad' })).toBeNull();
      expect(queryByRole('link', { name: 'worse' })).toBeNull();
      expect(container.innerHTML).not.toMatch(/javascript:/i);
      expect(container.innerHTML).not.toMatch(/data:/i);
    });

    it('renders images only for allowlisted sources, falls back to alt text', () => {
      const { container, getByAltText, queryByAltText } = render(
        <MarkdownRenderer markdown="![logo](https://example.com/logo.png) ![evil](javascript:alert(1))" mode="flow" />,
      );
      expect(getByAltText('logo')).toBeDefined();
      expect(getByAltText('logo').getAttribute('src')).toBe('https://example.com/logo.png');
      expect(queryByAltText('evil')).toBeNull();
      expect(hasText(container, 'evil')).toBe(true);
    });

    it('renders raw HTML as inert escaped text (no execution)', () => {
      const { container } = render(
        <MarkdownRenderer markdown="<script>alert('xss')</script><img src=x onerror=alert(1)>" mode="flow" />,
      );
      expect(container.innerHTML).not.toContain('<script>');
      expect(container.innerHTML).not.toContain('<img');
      expect(hasText(container, "alert('xss')")).toBe(true);
    });

    it('renders an alert > [!TYPE]', () => {
      const { container } = render(<MarkdownRenderer markdown={"> [!WARNING]\n> careful here"} mode="flow" />);
      expect(hasText(container, 'Warning')).toBe(true);
      expect(hasText(container, 'careful here')).toBe(true);
      expect(container.querySelector('.enterprise-alert-warning')).toBeDefined();
    });

    it('renders a horizontal rule', () => {
      const { container } = render(<MarkdownRenderer markdown={"text\n\n---\n\nmore"} mode="flow" />);
      expect(container.querySelector('hr')).toBeDefined();
    });

    it('renders block mode cards preserving labels', () => {
      const { container, getAllByText } = render(
        <MarkdownRenderer markdown={"# Title\n\nA paragraph.\n\n```\ncode\n```"} mode="block" />,
      );
      expect(getAllByText('Block Title').length).toBeGreaterThan(0);
      expect(getAllByText('Text Cell').length).toBeGreaterThan(0);
      expect(getAllByText('Code Cell').length).toBeGreaterThan(0);
      expect(hasText(container, 'Title')).toBe(true);
      expect(hasText(container, 'A paragraph.')).toBe(true);
    });

    it('renders an empty markdown document as nothing', () => {
      const { container } = render(<MarkdownRenderer markdown="" mode="flow" />);
      expect(container.textContent).toBe('');
      expect(container.querySelector('h1, h2, h3, h4, h5, h6, p, pre, table, svg')).toBeNull();
    });
  });

  describe('MarkdownRenderer - rich blocks (Mermaid, math, status)', () => {
    it('renders Mermaid diagrams with strict sanitization and unique ids', async () => {
      const code = "graph TD\n  A-->B\n";
      const { container } = render(<MermaidBlock code={code} />);
      await waitFor(() => {
        expect(container.querySelector('svg')).not.toBeNull();
      });
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('id')).toMatch(/^mermaid-/);
      expect(vi.mocked(mermaid.render)).toHaveBeenCalledWith(
        expect.stringMatching(/^mermaid-/),
        code
      );
      expect(container.innerHTML).not.toMatch(/<script/i);
      expect(container.innerHTML).not.toMatch(/javascript:/i);
    });

    it('shows a safe error instead of raw SVG when Mermaid rendering fails', async () => {
      vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('syntax error'));
      const { container } = render(<MermaidBlock code="graph TD\n bad\n" />);
      await waitFor(() => {
        expect(container.innerHTML).toContain('Diagram Syntax Error');
      });
      expect(container.innerHTML).not.toMatch(/<svg/i);
      expect(container.innerHTML).not.toMatch(/<script/i);
    });

    it('strips executable script from Mermaid SVG output (no raw-SVG fallback)', async () => {
      vi.mocked(mermaid.render).mockResolvedValueOnce({ svg: '<svg><script>bad()</script><rect width="10"/></svg>' } as any);
      const { container } = render(<MermaidBlock code="graph TD\nA-->B\n" />);
      await waitFor(() => {
        expect(container.querySelector('svg')).toBeDefined();
      });
      expect(container.innerHTML).not.toContain('bad()');
      expect(container.innerHTML).not.toMatch(/<script/i);
    });

    it('renders display math with KaTeX trust:false', () => {
      const { container } = render(<MarkdownRenderer markdown={"$$\nE = mc^2\n$$"} mode="flow" />);
      expect(hasText(container, 'E = mc^2')).toBe(true);
      expect(container.querySelector('.katex')).toBeDefined();
    });

    it('renders inline math $...$', () => {
      const { container } = render(<MarkdownRenderer markdown="inline $x^2$ here" mode="flow" />);
      expect(hasText(container, 'x^2')).toBe(true);
    });

    it('renders a status block with validated/clamped attributes and escaped text', () => {
      const { container } = render(
        <MarkdownRenderer
          markdown='<!-- status-block ragStatus="red" milestoneTitle="Launch" completionPercent="110" targetDate="2026-12-01" blockers="one;two" -->'
          mode="flow"
        />,
      );
      expect(hasText(container, 'Launch')).toBe(true);
      expect(hasText(container, 'Blocked')).toBe(true);
      expect(hasText(container, '100%')).toBe(true);
      expect(hasText(container, 'Target: 2026-12-01')).toBe(true);
      expect(hasText(container, 'Active Blockers (2)')).toBe(true);
      const { container: c2 } = render(
        <MarkdownRenderer markdown='<!-- status-block ragStatus="bogus" milestoneTitle="X" -->' mode="flow" />,
      );
      expect(hasText(c2, 'On Track')).toBe(true);
    });
  });

  describe('ReaderView - source authority and labelling', () => {
    it('uses derivedMarkdown as authoritative and keeps empty markdown empty', async () => {
      const { getByText, queryByText } = renderReaderView({
        id: 'p1', slug: 'slug-one', title: 'T', status: 'published',
        authorId: 'a', authorName: 'Author',
        derivedMarkdown: '',
        publishedMarkdown: '# PUBLISHED MUST NOT LEAK',
        workingMarkdown: '# WORKING MUST NOT LEAK',
        createdAt: '2026-10-24T09:00:00.000Z',
        updatedAt: '2026-10-24T10:00:00.000Z',
      });
      await waitFor(() => {
        expect(getByText('T')).toBeDefined();
      });
      expect(queryByText('# PUBLISHED MUST NOT LEAK')).toBeNull();
      expect(queryByText('# WORKING MUST NOT LEAK')).toBeNull();
      expect(queryByText('PUBLISHED MUST NOT LEAK')).toBeNull();
      expect(queryByText('WORKING MUST NOT LEAK')).toBeNull();
      expect(api.get).toHaveBeenCalledWith('/posts/slug-one');
    });

    it('displays source label from contentSource', async () => {
      const base = {
        id: 'p1', slug: 'slug-one', title: 'T', status: 'published',
        authorId: 'a', authorName: 'Author',
        derivedMarkdown: '# Title\n\nbody',
        createdAt: '2026-10-24T09:00:00.000Z',
        updatedAt: '2026-10-24T10:00:00.000Z',
      };
      for (const [source, expectedLabel] of [
        ['working', 'Working Snapshot'],
        ['submitted', 'Submitted Version'],
        ['published', 'Published Version'],
      ] as const) {
        const { getByText } = renderReaderView({ ...base, contentSource: source });
        await waitFor(() => {
          expect(getByText(expectedLabel)).toBeDefined();
        });
      }
      const { getByText: gDraft } = renderReaderView({ ...base, status: 'draft', contentSource: undefined });
      await waitFor(() => {
        expect(gDraft(/Working Snapshot \(draft\)/)).toBeDefined();
      });
      const { getByText: gPub, queryByText: qPub } = renderReaderView({ ...base, status: 'published', contentSource: undefined });
      await waitFor(() => {
        expect(gPub('T')).toBeDefined();
        expect(qPub(/Working Snapshot/)).toBeNull();
        expect(qPub(/Submitted Version/)).toBeNull();
      });
    });

    it('renders rich derived markdown (headings/anchors preserved)', async () => {
      const { getAllByText, getByText, container } = renderReaderView({
        id: 'p1', slug: 'slug-one', title: 'Distributed Systems', status: 'published',
        authorId: 'a', authorName: 'Author',
        derivedMarkdown: '# Distributed Systems\n\n## 1. Resilience Patterns\n\nCircuit breakers.\n',
        createdAt: '2026-10-24T09:00:00.000Z',
        updatedAt: '2026-10-24T10:00:00.000Z',
      });
      await waitFor(() => {
        expect(getAllByText('Distributed Systems').length).toBeGreaterThan(0);
        expect(getByText('1. Resilience Patterns')).toBeDefined();
        expect(getByText('Circuit breakers.')).toBeDefined();
      });
      expect(container.querySelector(headingId(0))).toBeDefined();
      expect(container.querySelector(headingId(1))).toBeDefined();
    });

    it('supports H1-H6 consistently in ReaderView outline / TOC', async () => {
      const derivedMarkdown = [
        '# Level One',
        '## Level Two',
        '### Level Three',
        '#### Level Four',
        '##### Level Five',
        '###### Level Six',
      ].join('\n\n');
      const { getByTitle, getByText } = renderReaderView({
        id: 'p1', slug: 'slug-one', title: 'TOC Parity', status: 'published',
        authorId: 'a', authorName: 'Author',
        derivedMarkdown,
        createdAt: '2026-10-24T09:00:00.000Z',
        updatedAt: '2026-10-24T10:00:00.000Z',
      });
      await waitFor(() => {
        expect(getByTitle('Table of Contents')).toBeDefined();
      });
      expect(getByText('Outline (6)')).toBeDefined();
    });

    it('sanitizes raw HTML and unsafe URLs in ReaderView', async () => {
      const { container, queryByRole } = renderReaderView({
        id: 'p1', slug: 'slug-one', title: 'T', status: 'published',
        authorId: 'a', authorName: 'Author',
        derivedMarkdown: 'Click <script>alert(1)</script> [evil](javascript:alert(1))',
        createdAt: '2026-10-24T09:00:00.000Z',
        updatedAt: '2026-10-24T10:00:00.000Z',
      });
      await waitFor(() => {
        expect(hasText(container, 'Click')).toBe(true);
      });
      expect(container.innerHTML).not.toContain('<script>');
      expect(container.innerHTML).not.toMatch(/javascript:/i);
      expect(hasText(container, 'evil')).toBe(true);
      expect(queryByRole('link', { name: 'evil' })).toBeNull();
    });
  });

  describe('ReaderPreview - derived markdown projection', () => {
    it('shows empty state for empty derived markdown', () => {
      const { getByText } = render(<ReaderPreview prosemirrorDocJSON={null} title="Empty" />);
      expect(getByText('Draft is empty.')).toBeDefined();
    });

    it('renders actual exporter output for a rich document', () => {
      const doc = {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Report' }] },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'See the ' },
              { type: 'text', marks: [{ type: 'strong' }], text: 'table' },
              { type: 'text', text: '.' },
            ],
          },
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  { type: 'tableHeader', content: [{ type: 'text', text: 'A' }] },
                  { type: 'tableHeader', content: [{ type: 'text', text: 'B' }] },
                ],
              },
              {
                type: 'tableRow',
                content: [
                  { type: 'tableCell', content: [{ type: 'text', text: '1' }] },
                  { type: 'tableCell', content: [{ type: 'text', text: '2' }] },
                ],
              },
            ],
          },
        ],
      };
      const md = exportDerivedMarkdown(doc);
      expect(md).toContain('# Report');
      expect(md).toContain('| A | B |');

      const { container, queryByText } = render(<ReaderPreview prosemirrorDocJSON={doc} title="Report" />);
      expect(hasText(container, 'Report')).toBe(true);
      expect(hasText(container, 'See the table.')).toBe(true);
      expect(queryByText('Draft is empty.')).toBeNull();
    });
  });
});
