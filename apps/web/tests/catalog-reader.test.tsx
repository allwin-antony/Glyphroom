import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { CatalogView, type CatalogPost } from '../src/views/CatalogView.js';
import { ReaderView } from '../src/views/ReaderView.js';
import { AuthContext, type AuthContextValue } from '../src/context/AuthContext.js';
import { api } from '../src/lib/api.js';

// Mock API module
vi.mock('../src/lib/api.js', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockPosts: CatalogPost[] = [
  {
    id: 'post-1',
    slug: 'distributed-systems-patterns',
    title: 'Distributed Systems Patterns in 2026',
    excerpt: 'High availability patterns for distributed microservices.',
    status: 'published',
    authorId: 'author-alice',
    authorName: 'Alice Author',
    coeName: 'Architecture',
    publishedMarkdown: '# Distributed Systems Patterns in 2026\n\nHigh availability patterns.',
    publishedAt: '2026-10-24T10:00:00.000Z',
    createdAt: '2026-10-24T09:00:00.000Z',
    updatedAt: '2026-10-24T10:00:00.000Z',
  },
  {
    id: 'post-2',
    slug: 'crdt-convergence-deep-dive',
    title: 'Automated CRDT Convergence & Myers Diff',
    excerpt: 'Verifying zero keystroke loss across concurrent clients.',
    status: 'published',
    authorId: 'author-bob',
    authorName: 'Bob Builder',
    coeName: 'Engineering',
    publishedMarkdown: '# Automated CRDT Convergence\n\nMyers diff suggestions.',
    publishedAt: '2026-10-23T14:00:00.000Z',
    createdAt: '2026-10-23T12:00:00.000Z',
    updatedAt: '2026-10-23T14:00:00.000Z',
  },
  {
    id: 'post-3',
    slug: 'secret-draft-spec',
    title: 'Draft Security Model Specification',
    excerpt: 'Zero trust security model draft.',
    status: 'draft',
    authorId: 'author-alice',
    authorName: 'Alice Author',
    coeName: 'Security',
    workingMarkdown: '# Draft Security Model\n\nDraft content.',
    createdAt: '2026-10-24T12:00:00.000Z',
    updatedAt: '2026-10-24T12:00:00.000Z',
  },
];

const createMockAuth = (
  role: 'admin' | 'moderator' | 'author' | 'reader' = 'author',
  userId = 'author-alice'
): AuthContextValue => ({
  user: {
    id: userId,
    userId,
    email: 'alice@corp.com',
    fullName: 'Alice Author',
    role,
  },
  csrfToken: 'mock-csrf-token',
  isLoading: false,
  isAuthenticated: true,
  login: vi.fn(),
  logout: vi.fn(),
  refreshSession: vi.fn(),
});

describe('Phase C & E: Knowledge Catalog & Reader View Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('CatalogView Component', () => {
    it('fetches and renders publications list', async () => {
      (api.get as any).mockResolvedValueOnce({ posts: mockPosts });

      render(
        <AuthContext.Provider value={createMockAuth()}>
          <MemoryRouter>
            <CatalogView />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      // Verify Header
      expect(screen.getByText('Catalog')).toBeDefined();

      // Wait for posts to load
      await waitFor(() => {
        expect(screen.getByText('Distributed Systems Patterns in 2026')).toBeDefined();
        expect(screen.getByText('Automated CRDT Convergence & Myers Diff')).toBeDefined();
      });

      // Verify COE badges
      expect(screen.getAllByText('Architecture').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Engineering').length).toBeGreaterThan(0);
    });

    it('filters posts by search keyword', async () => {
      (api.get as any).mockResolvedValueOnce({ posts: mockPosts });

      render(
        <AuthContext.Provider value={createMockAuth()}>
          <MemoryRouter>
            <CatalogView />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByText('Distributed Systems Patterns in 2026')).toBeDefined();
      });

      // Type in search box
      (api.get as any).mockResolvedValueOnce({
        posts: [mockPosts[1]], // only Bob's CRDT post matches
      });

      const searchInput = screen.getByPlaceholderText(/Search by title/i);
      fireEvent.change(searchInput, { target: { value: 'CRDT' } });

      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith('/posts?search=CRDT');
      });
    });

    it('toggles view mode between grid and list', async () => {
      (api.get as any).mockResolvedValueOnce({ posts: mockPosts });

      render(
        <AuthContext.Provider value={createMockAuth()}>
          <MemoryRouter>
            <CatalogView />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByText('Distributed Systems Patterns in 2026')).toBeDefined();
      });

      const listBtn = screen.getByLabelText('List view');
      fireEvent.click(listBtn);

      expect(localStorage.getItem('glyphroom_catalog_view')).toBe('list');
    });

    it('displays empty state when no posts match', async () => {
      (api.get as any).mockResolvedValueOnce({ posts: [] });

      render(
        <AuthContext.Provider value={createMockAuth()}>
          <MemoryRouter>
            <CatalogView />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByText(/No matching publications found/i)).toBeDefined();
      });
    });
  });

  describe('ReaderView Component', () => {
    it('fetches post by slug and renders headings and content', async () => {
      const mockPostDetails = {
        ...mockPosts[0],
        derivedMarkdown: '# Distributed Systems Patterns in 2026\n\nHigh availability patterns for distributed microservices.\n\n## 1. Resilience Patterns\n\nCircuit breakers and retries.',
      };

      (api.get as any).mockImplementation((url: string) => {
        if (url.includes('/comments')) {
          return Promise.resolve({
            comments: [
              {
                id: 'comment-1',
                postId: 'post-1',
                authorId: 'user-2',
                authorName: 'Bob Reviewer',
                content: 'Great overview of circuit breakers!',
                createdAt: '2026-10-24T11:00:00.000Z',
              },
            ],
          });
        }
        return Promise.resolve({ post: mockPostDetails, userPermission: 'edit' });
      });

      render(
        <AuthContext.Provider value={createMockAuth('author', 'author-alice')}>
          <MemoryRouter initialEntries={['/posts/distributed-systems-patterns']}>
            <Routes>
              <Route path="/posts/:slug" element={<ReaderView />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getAllByText('Distributed Systems Patterns in 2026').length).toBeGreaterThan(0);
        expect(screen.getByText('1. Resilience Patterns')).toBeDefined();
      });

      // Verify Edit button is visible for author
      expect(screen.getByTitle(/Open in Collaborative Editor Studio/i)).toBeDefined();

      // Verify comment rendered
      expect(screen.getByText('Great overview of circuit breakers!')).toBeDefined();
    });

    it('toggles comfort preferences bar and typeface', async () => {
      const mockPostDetails = {
        ...mockPosts[0],
        derivedMarkdown: '# Title\n\nBody text.',
      };

      (api.get as any).mockImplementation((url: string) => {
        if (url.includes('/comments')) {
          return Promise.resolve({ comments: [] });
        }
        return Promise.resolve({ post: mockPostDetails, userPermission: 'view' });
      });

      render(
        <AuthContext.Provider value={createMockAuth('reader', 'reader-charlie')}>
          <MemoryRouter initialEntries={['/posts/distributed-systems-patterns']}>
            <Routes>
              <Route path="/posts/:slug" element={<ReaderView />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByTitle('Reading Preferences')).toBeDefined();
      });

      const comfortBtn = screen.getByTitle('Reading Preferences');
      fireEvent.click(comfortBtn);

      // Verify Serif button appears in drawer
      const serifBtn = screen.getByText('Serif');
      expect(serifBtn).toBeDefined();
      fireEvent.click(serifBtn);

      // Verify Sepia button
      const sepiaBtn = screen.getByText('Sepia Paper');
      expect(sepiaBtn).toBeDefined();
      fireEvent.click(sepiaBtn);
      expect(screen.getByText('Sepia Active')).toBeDefined();
    });

    it('submits a new peer comment successfully', async () => {
      const mockPostDetails = {
        ...mockPosts[0],
        derivedMarkdown: '# Title\n\nBody.',
      };

      (api.get as any).mockImplementation((url: string) => {
        if (url.includes('/comments')) {
          return Promise.resolve({ comments: [] });
        }
        return Promise.resolve({ post: mockPostDetails, userPermission: 'view' });
      });

      (api.post as any).mockResolvedValueOnce({
        comment: {
          id: 'new-comment-99',
          postId: 'post-1',
          authorId: 'author-alice',
          authorName: 'Alice Author',
          content: 'Adding a peer note regarding latency SLAs.',
          createdAt: new Date().toISOString(),
        },
      });

      render(
        <AuthContext.Provider value={createMockAuth('author', 'author-alice')}>
          <MemoryRouter initialEntries={['/posts/distributed-systems-patterns']}>
            <Routes>
              <Route path="/posts/:slug" element={<ReaderView />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Leave feedback/i)).toBeDefined();
      });

      const commentInput = screen.getByPlaceholderText(/Leave feedback/i);
      fireEvent.change(commentInput, { target: { value: 'Adding a peer note regarding latency SLAs.' } });

      const postBtn = screen.getByText('Post Note');
      fireEvent.click(postBtn);

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/posts/post-1/comments', {
          content: 'Adding a peer note regarding latency SLAs.',
        });
        expect(screen.getByText('Adding a peer note regarding latency SLAs.')).toBeDefined();
      });
    });

    it('toggles between Flow and Notebook Blocks in ReaderView', async () => {
      const mockPostDetails = {
        ...mockPosts[0],
        derivedMarkdown: '# Architecture Overview\n\nSystem paragraph.\n\n```typescript\nconst a = 1;\n```',
      };

      (api.get as any).mockImplementation((url: string) => {
        if (url.includes('/comments')) {
          return Promise.resolve({ comments: [] });
        }
        return Promise.resolve({ post: mockPostDetails, userPermission: 'view' });
      });

      render(
        <AuthContext.Provider value={createMockAuth('reader', 'reader-charlie')}>
          <MemoryRouter initialEntries={['/posts/distributed-systems-patterns']}>
            <Routes>
              <Route path="/posts/:slug" element={<ReaderView />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByTitle('Notebook Block Cards (.ipynb Mode)')).toBeDefined();
      });

      // Default is Notebook Blocks: verify Block Title and cells appear
      expect(screen.getAllByText('Block Title').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Text Cell').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Code Cell').length).toBeGreaterThan(0);

      // Toggle to Flow mode
      const flowBtn = screen.getByTitle('Continuous Article Flow');
      fireEvent.click(flowBtn);

      // Toggle back to Blocks
      const blocksBtn = screen.getByTitle('Notebook Block Cards (.ipynb Mode)');
      fireEvent.click(blocksBtn);
      expect(screen.getAllByText('Block Title').length).toBeGreaterThan(0);
    });
  });
});
