import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { MyWorkView } from '../src/views/MyWorkView.js';
import { ReviewQueueView } from '../src/views/ReviewQueueView.js';
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
    vi.clearAllMocks();
  });

  describe('MyWorkView Component', () => {
    it('fetches posts and segments them into Drafts, In Review, and Published tabs', async () => {
      (api.get as any).mockResolvedValueOnce({ posts: mockPosts });

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
      (api.get as any).mockResolvedValue({ posts: mockPosts });
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
  });

  describe('ReviewQueueView Component', () => {
    it('lists posts currently in review', async () => {
      (api.get as any).mockResolvedValueOnce({ posts: mockPosts });

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
      (api.get as any).mockResolvedValue({ posts: mockPosts });
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
      expect(screen.getByText(/Zero Trust RFC/i)).toBeDefined();

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
        });
      });
    });
  });
});
