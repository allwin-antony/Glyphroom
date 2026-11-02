import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { MyWorkView } from '../src/views/MyWorkView.js';
import { ReviewQueueView } from '../src/views/ReviewQueueView.js';
import { HomeView } from '../src/views/HomeView.js';
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

const mockPosts = [
  {
    id: 'post-1',
    slug: 'distributed-patterns',
    title: 'Distributed Systems Patterns',
    status: 'published' as const,
    authorId: 'author-alice',
    authorName: 'Alice Author',
    coeName: 'Architecture',
    createdAt: '2026-10-24T10:00:00.000Z',
    updatedAt: '2026-10-24T10:00:00.000Z',
  },
  {
    id: 'post-2',
    slug: 'crdt-testing',
    title: 'CRDT Fuzz Testing',
    status: 'draft' as const,
    authorId: 'author-alice',
    authorName: 'Alice Author',
    coeName: 'Engineering',
    createdAt: '2026-10-24T11:00:00.000Z',
    updatedAt: '2026-10-24T11:00:00.000Z',
  },
  {
    id: 'post-3',
    slug: 'security-rfc',
    title: 'Zero Trust Authentication RFC',
    status: 'in_review' as const,
    authorId: 'author-bob',
    authorName: 'Bob Author',
    coeName: 'Security',
    workingMarkdown: '# Zero Trust RFC\n\nSecurity architecture proposal.',
    createdAt: '2026-10-24T12:00:00.000Z',
    updatedAt: '2026-10-24T12:00:00.000Z',
  },
];

const completeCollection = (posts: typeof mockPosts | any[]) => ({
  posts,
  pagination: { page: 1, limit: 100, total: posts.length, totalPages: posts.length ? 1 : 0, hasNextPage: false },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

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

describe('Phase F & G: My Work Dashboard & Moderator Review Queue Suite', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('MyWorkView Component', () => {
    it('fetches posts and segments them into Drafts, In Review, and Published tabs', async () => {
      (api.get as any).mockResolvedValueOnce(completeCollection(mockPosts));

      render(
        <AuthContext.Provider value={createMockAuth('author', 'author-alice')}>
          <MemoryRouter>
            <MyWorkView />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      // Verify Header
      expect(screen.getByText('My Work Dashboard')).toBeDefined();

      // Check tab counts for Alice
      await waitFor(() => {
        expect(screen.getByText(/Drafts \(1\)/i)).toBeDefined();
        expect(screen.getByText(/Published \(1\)/i)).toBeDefined();
      });

      // Draft post should be listed
      expect(screen.getByText('CRDT Fuzz Testing')).toBeDefined();
    });

    it('submits a draft post for editorial review', async () => {
      (api.get as any).mockResolvedValue(completeCollection(mockPosts));
      (api.post as any).mockResolvedValueOnce({ post: { ...mockPosts[1], status: 'in_review' } });

      render(
        <AuthContext.Provider value={createMockAuth('author', 'author-alice')}>
          <MemoryRouter>
            <MyWorkView />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByText('CRDT Fuzz Testing')).toBeDefined();
      });

      const submitBtn = screen.getByText('Submit');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/posts/post-2/submit-review');
      });
    });

    it('opens confirmation modal and deletes a post when Delete is clicked', async () => {
      (api.get as any).mockResolvedValue(completeCollection(mockPosts));
      (api.delete as any).mockResolvedValueOnce({ success: true });

      render(
        <AuthContext.Provider value={createMockAuth('author', 'author-alice')}>
          <MemoryRouter>
            <MyWorkView />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByText('CRDT Fuzz Testing')).toBeDefined();
      });

      const deleteBtn = screen.getByTitle('Delete Post');
      fireEvent.click(deleteBtn);

      // Confirmation dialog opens
      expect(screen.getByText(/Are you sure you want to delete/i)).toBeDefined();

      const confirmBtn = screen.getByText('Confirm Delete');
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(api.delete).toHaveBeenCalledWith('/posts/post-2');
      });
    });

    it('collects every authorized page and exposes more than 24 actual rows through the local pager', async () => {
      const draftRows = Array.from({ length: 101 }, (_, index) => ({
        ...mockPosts[1], id: `draft-${index}`, slug: `draft-${index}`, title: `Draft ${index}`,
      }));
      const aliceInReview = { ...mockPosts[2], authorId: 'author-alice' };
      const completeRows = [mockPosts[0], ...draftRows, aliceInReview];
      (api.get as any).mockImplementation(async (url: string) => {
        const page = Number(new URLSearchParams(url.split('?')[1]).get('page')) || 1;
        if (page === 1) return { posts: completeRows.slice(0, 100), pagination: { page: 1, limit: 100, total: 103, totalPages: 2, hasNextPage: true } };
        return { posts: completeRows.slice(100), pagination: { page: 2, limit: 100, total: 103, totalPages: 2, hasNextPage: false } };
      });

      render(
        <AuthContext.Provider value={createMockAuth('author', 'author-alice')}>
          <MemoryRouter>
            <MyWorkView />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Drafts \(101\)/i)).toBeDefined();
        expect(screen.getByText(/In Review \(1\)/i)).toBeDefined();
        expect(screen.getByText(/Published \(1\)/i)).toBeDefined();
      });

      // The complete collection was fetched page by page (limit 100 each), not just the first 24.
      expect(api.get).toHaveBeenCalledTimes(2);
      const calls = api.get.mock.calls.map((c) => c[0]);
      expect(calls[0]).toEqual('/posts?page=1&limit=100');
      expect(calls[1]).toEqual('/posts?page=2&limit=100');

      expect(screen.getByText('Draft 0')).toBeDefined();
      expect(screen.queryByText('Draft 24')).toBeNull();
      fireEvent.click(screen.getByLabelText('Next page'));
      await waitFor(() => expect(screen.getByText('Draft 24')).toBeDefined());
      expect(screen.queryByText('Draft 0')).toBeNull();
      expect(screen.getByText(/page 2 of 5/i)).toBeDefined();
    });

    it('hides incomplete rows and counts after a partial failure and supports retry', async () => {
      (api.get as any).mockImplementation(async (url: string) => {
        const page = Number(new URLSearchParams(url.split('?')[1]).get('page')) || 1;
        if (page === 1) return { posts: [mockPosts[1]], pagination: { page: 1, limit: 100, total: 2, totalPages: 2, hasNextPage: true } };
        throw new Error('Network down on page 2');
      });

      render(
        <AuthContext.Provider value={createMockAuth('author', 'author-alice')}>
          <MemoryRouter>
            <MyWorkView />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Network down on page 2/)).toBeDefined();
      });
      expect(screen.getByText(/Drafts \(—\)/i)).toBeDefined();
      expect(screen.queryByText('CRDT Fuzz Testing')).toBeNull();
      expect(screen.queryByText('No articles found in this category.')).toBeNull();

      (api.get as any).mockResolvedValueOnce(completeCollection([mockPosts[1]]));
      fireEvent.click(screen.getByText('Try again'));
      await waitFor(() => expect(screen.getByText(/Drafts \(1\)/i)).toBeDefined());
      expect(screen.getByText('CRDT Fuzz Testing')).toBeDefined();
    });

    it('invalidates overlapping reloads and does not fetch another page after unmount', async () => {
      const olderReload = deferred<any>();
      const newerReload = deferred<any>();
      const unmountedReload = deferred<any>();
      const submit = deferred<any>();
      const deletion = deferred<any>();
      const newestPost = { ...mockPosts[1], id: 'newest-post', slug: 'newest-post', title: 'Newest reload result' };
      const stalePost = { ...mockPosts[1], id: 'stale-post', slug: 'stale-post', title: 'Stale reload result' };

      (api.get as any)
        .mockResolvedValueOnce(completeCollection([mockPosts[1]]))
        .mockImplementationOnce(() => olderReload.promise)
        .mockImplementationOnce(() => newerReload.promise)
        .mockImplementationOnce(() => unmountedReload.promise);
      (api.post as any).mockReturnValueOnce(submit.promise).mockResolvedValueOnce({ success: true });
      (api.delete as any).mockReturnValueOnce(deletion.promise);

      const { unmount } = render(
        <AuthContext.Provider value={createMockAuth('author', 'author-alice')}>
          <MemoryRouter>
            <MyWorkView />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => expect(screen.getByText('CRDT Fuzz Testing')).toBeDefined());
      fireEvent.click(screen.getByText('Submit'));
      fireEvent.click(screen.getByTitle('Delete Post'));
      fireEvent.click(screen.getByText('Confirm Delete'));

      await act(async () => submit.resolve({ success: true }));
      await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
      const olderSignal = api.get.mock.calls[1][1].signal as AbortSignal;

      await act(async () => deletion.resolve({ success: true }));
      await waitFor(() => expect(api.get).toHaveBeenCalledTimes(3));
      expect(olderSignal.aborted).toBe(true);

      await act(async () => olderReload.resolve(completeCollection([stalePost])));
      expect(screen.getByText('Loading your workspace documents...')).toBeDefined();
      expect(screen.queryByText('Stale reload result')).toBeNull();

      await act(async () => newerReload.resolve(completeCollection([newestPost])));
      await waitFor(() => expect(screen.getByText('Newest reload result')).toBeDefined());
      expect(screen.queryByText('Stale reload result')).toBeNull();

      fireEvent.click(screen.getByText('Submit'));
      await waitFor(() => expect(api.get).toHaveBeenCalledTimes(4));
      const unmountedSignal = api.get.mock.calls[3][1].signal as AbortSignal;
      unmount();
      expect(unmountedSignal.aborted).toBe(true);

      await act(async () => unmountedReload.resolve({
        posts: [newestPost],
        pagination: { page: 1, limit: 100, total: 101, totalPages: 2, hasNextPage: true },
      }));
      expect(api.get).toHaveBeenCalledTimes(4);
    });

    it.each(['submit', 'delete'] as const)('does not start a reload when a pending %s resolves after unmount', async (action) => {
      const mutation = deferred<any>();
      (api.get as any).mockResolvedValueOnce(completeCollection([mockPosts[1]]));
      if (action === 'submit') (api.post as any).mockReturnValueOnce(mutation.promise);
      else (api.delete as any).mockReturnValueOnce(mutation.promise);

      const { unmount } = render(
        <AuthContext.Provider value={createMockAuth('author', 'author-alice')}>
          <MemoryRouter>
            <MyWorkView />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => expect(screen.getByText('CRDT Fuzz Testing')).toBeDefined());
      if (action === 'submit') {
        fireEvent.click(screen.getByText('Submit'));
        expect(api.post).toHaveBeenCalledTimes(1);
      } else {
        fireEvent.click(screen.getByTitle('Delete Post'));
        fireEvent.click(screen.getByText('Confirm Delete'));
        expect(api.delete).toHaveBeenCalledTimes(1);
      }

      expect(api.get).toHaveBeenCalledTimes(1);
      unmount();
      await act(async () => mutation.resolve({ success: true }));
      expect(api.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('ReviewQueueView Component', () => {
    it('lists posts currently in review', async () => {
      (api.get as any).mockResolvedValueOnce({ posts: [mockPosts[2]], pagination: { page: 1, limit: 24, total: 1, totalPages: 1, hasNextPage: false } });

      render(
        <AuthContext.Provider value={createMockAuth('moderator', 'mod-charlie')}>
          <MemoryRouter>
            <ReviewQueueView />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      expect(screen.getByText('Moderator Review Queue')).toBeDefined();

      await waitFor(() => {
        expect(screen.getByText('Zero Trust Authentication RFC')).toBeDefined();
        expect(screen.getByText('Bob Author')).toBeDefined();
      });
    });

    it('opens review workspace modal and approves a submission', async () => {
      const submittedVersionId = '11111111-2222-3333-4444-555555555555';
      (api.get as any).mockImplementation(async (url: string) => url.startsWith('/posts?') ? { posts: [mockPosts[2]], pagination: { page: 1, limit: 24, total: 1, totalPages: 1, hasNextPage: false } } : {
        userPermission: 'review', post: { ...mockPosts[2], submittedVersionId, submittedVersion: {
          id: submittedVersionId, versionNumber: 1, triggerReason: 'review_submission',
          markdownSnapshot: '# Zero Trust RFC\n\nSecurity architecture proposal.', createdAt: '2026-11-01T00:00:00Z',
        } },
      });
      (api.post as any).mockResolvedValueOnce({ review: { id: 'rev-1', decision: 'approved' } });

      render(
        <AuthContext.Provider value={createMockAuth('moderator', 'mod-charlie')}>
          <MemoryRouter>
            <ReviewQueueView />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(screen.getByText('Review Post')).toBeDefined();
      });

      // Click to open review modal
      const reviewBtn = screen.getByText('Review Post');
      fireEvent.click(reviewBtn);

      // Verify modal content
      expect(screen.getByText('Editorial Review Workspace')).toBeDefined();
      expect(await screen.findByText(/Zero Trust RFC/i)).toBeDefined();

      // Enter review notes
      const notesArea = screen.getByPlaceholderText(/Provide constructive feedback/i);
      fireEvent.change(notesArea, { target: { value: 'Approved for publication.' } });

      // Click Approve Submission
      const approveBtn = screen.getByText('Approve Submission');
      fireEvent.click(approveBtn);

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/posts/post-3/reviews', {
          decision: 'approved',
          notes: 'Approved for publication.',
          submittedVersionId,
        }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
      });
    });

    it('requests both review statuses with page+limit, uses server totals, and reaches page 2', async () => {
      const page1 = Array.from({ length: 24 }, (_, i) => ({
        id: `ir-${i}`, slug: `ir-${i}`, title: `In Review ${i}`, status: 'in_review' as const, authorId: 'author-a', authorName: 'Author A', coeName: 'Security', createdAt: '2026-10-24T10:00:00.000Z', updatedAt: '2026-10-24T10:00:00.000Z',
      }));
      const page2 = Array.from({ length: 6 }, (_, i) => ({
        id: `ap-${i}`, slug: `ap-${i}`, title: `Approved ${i}`, status: 'approved' as const, authorId: 'author-a', authorName: 'Author A', coeName: 'Engineering', createdAt: '2026-10-24T10:00:00.000Z', updatedAt: '2026-10-24T10:00:00.000Z',
      }));
      (api.get as any).mockImplementation(async (url: string) => {
        if (!url.startsWith('/posts?')) return { posts: [], pagination: { page: 1, limit: 24, total: 0, totalPages: 0, hasNextPage: false } };
        const requestedPage = Number(new URLSearchParams(url.split('?')[1]).get('page')) || 1;
        if (requestedPage === 1) return { posts: page1, pagination: { page: 1, limit: 24, total: 30, totalPages: 2, hasNextPage: true } };
        return { posts: page2, pagination: { page: 2, limit: 24, total: 30, totalPages: 2, hasNextPage: false } };
      });

      render(
        <AuthContext.Provider value={createMockAuth('moderator', 'mod-charlie')}>
          <MemoryRouter>
            <ReviewQueueView />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => expect(screen.getByText('In Review 0')).toBeDefined());

      // Server status union + page + limit are requested, not a plain first page filtered client-side.
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining('status=in_review&status=approved&page=1&limit=24'),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );

      // Server totals are reflected in the pager.
      await waitFor(() => expect(screen.getByText(/30 submissions/, { exact: false })).toBeDefined());
      await waitFor(() => expect(screen.getByText(/page 1 of 2/, { exact: false })).toBeDefined());

      // Rows beyond the first 24 are reachable via the pager.
      fireEvent.click(screen.getByText('Next'));
      await waitFor(() => expect(screen.getByText('Approved 0')).toBeDefined());
      expect(screen.queryByText('In Review 0')).toBeNull();
      expect(api.get).toHaveBeenLastCalledWith(
        expect.stringContaining('page=2&limit=24'),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('clamps an emptied invalid page directly to the server last page', async () => {
      const queuePost = (page: number, title: string) => ({
        ...mockPosts[2], id: `queue-${page}`, slug: `queue-${page}`, title,
      });
      let pageOneRequests = 0;
      (api.get as any).mockImplementation(async (url: string) => {
        const page = Number(new URLSearchParams(url.split('?')[1]).get('page')) || 1;
        if (page === 1) {
          pageOneRequests += 1;
          return pageOneRequests === 1
            ? { posts: [queuePost(1, 'Initial page 1')], pagination: { page: 1, limit: 24, total: 73, totalPages: 4, hasNextPage: true } }
            : { posts: [queuePost(1, 'Remaining page 1')], pagination: { page: 1, limit: 24, total: 1, totalPages: 1, hasNextPage: false } };
        }
        if (page === 2) return { posts: [queuePost(2, 'Queue page 2')], pagination: { page: 2, limit: 24, total: 73, totalPages: 4, hasNextPage: true } };
        if (page === 3) return { posts: [queuePost(3, 'Queue page 3')], pagination: { page: 3, limit: 24, total: 73, totalPages: 4, hasNextPage: true } };
        return { posts: [], pagination: { page: 4, limit: 24, total: 1, totalPages: 1, hasNextPage: false } };
      });

      render(
        <AuthContext.Provider value={createMockAuth('moderator', 'mod-charlie')}>
          <MemoryRouter>
            <ReviewQueueView />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => expect(screen.getByText('Initial page 1')).toBeDefined());
      fireEvent.click(screen.getByText('Next'));
      await waitFor(() => expect(screen.getByText('Queue page 2')).toBeDefined());
      fireEvent.click(screen.getByText('Next'));
      await waitFor(() => expect(screen.getByText('Queue page 3')).toBeDefined());
      fireEvent.click(screen.getByText('Next'));

      await waitFor(() => expect(screen.getByText('Remaining page 1')).toBeDefined());
      expect(screen.queryByText('Review Queue is Clear!')).toBeNull();
      expect(screen.getByText(/page 1 of 1/i)).toBeDefined();
      const requestedPages = api.get.mock.calls.map((call) =>
        Number(new URLSearchParams(call[0].split('?')[1]).get('page'))
      );
      expect(requestedPages).toEqual([1, 2, 3, 4, 1]);
    });

    it('distinguishes an empty queue from a load failure and clears the error on retry', async () => {
      (api.get as any).mockRejectedValue(new Error('Service unavailable'));

      render(
        <AuthContext.Provider value={createMockAuth('moderator', 'mod-charlie')}>
          <MemoryRouter>
            <ReviewQueueView />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      await waitFor(() => expect(screen.getByText('Unable to load review queue')).toBeDefined());
      expect(screen.queryByText('Review Queue is Clear!')).toBeNull();

      (api.get as any).mockResolvedValueOnce({ posts: [], pagination: { page: 1, limit: 24, total: 0, totalPages: 0, hasNextPage: false } });
      fireEvent.click(screen.getByText('Try again'));
      await waitFor(() => expect(screen.getByText('Review Queue is Clear!')).toBeDefined());
    });
  });

  describe('HomeView Component', () => {
    it('shows accurate authorized totals and includes approved in the review count', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/posts') return Promise.resolve({ posts: Array.from({ length: 24 }, (_, index) => ({ ...mockPosts[0], id: `preview-${index}` })) });
        if (url.includes('status=published&limit=1')) return Promise.resolve({ posts: [], pagination: { page: 1, limit: 1, total: 7, totalPages: 7, hasNextPage: true } });
        if (url.includes('status=in_review&status=approved&limit=1')) return Promise.resolve({ posts: [], pagination: { page: 1, limit: 1, total: 6, totalPages: 6, hasNextPage: true } });
        if (url.includes('status=draft&limit=1')) return Promise.resolve({ posts: [], pagination: { page: 1, limit: 1, total: 25, totalPages: 25, hasNextPage: true } });
        return Promise.resolve({ posts: [], pagination: { page: 1, limit: 1, total: 0, totalPages: 0, hasNextPage: false } });
      });

      render(
        <AuthContext.Provider value={createMockAuth('moderator', 'mod-charlie')}>
          <MemoryRouter>
            <HomeView />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      // Published total comes from the authorized count query, not the truncated preview.
      await waitFor(() => expect(screen.getByText('7 Stories')).toBeDefined());
      // Review count comes from one status-union query.
      await waitFor(() => expect(screen.getByText('6 Pending')).toBeDefined());
      await waitFor(() => expect(screen.getByText(/Review Queue \(6\)/)).toBeDefined());
      // Draft total is complete even though all 24 preview rows are newer non-drafts.
      await waitFor(() => expect(screen.getByText('25 Drafts')).toBeDefined());
      expect(api.get).toHaveBeenCalledWith('/posts?status=in_review&status=approved&limit=1');
    });

    it('does not derive a count from an incomplete one-row response', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/posts') return Promise.resolve({ posts: [mockPosts[0]] });
        if (url.includes('status=draft&limit=1')) return Promise.resolve({ posts: [mockPosts[1]] });
        return Promise.resolve({ posts: [], pagination: { page: 1, limit: 1, total: 0, totalPages: 0, hasNextPage: false } });
      });

      render(
        <AuthContext.Provider value={createMockAuth('moderator', 'mod-charlie')}>
          <MemoryRouter>
            <HomeView />
          </MemoryRouter>
        </AuthContext.Provider>
      );

      const draftMetric = screen.getByText('Your Drafts').parentElement!;
      await waitFor(() => expect(within(draftMetric).getByText('—')).toBeDefined());
      expect(screen.queryByText('1 Drafts')).toBeNull();
      await waitFor(() => expect(screen.getByText(/Some counts are temporarily unavailable/i)).toBeDefined());
    });
  });
});
