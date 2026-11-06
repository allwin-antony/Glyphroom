import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SpaceView } from '../src/views/SpaceView.js';
import { AuthContext, type AuthContextValue } from '../src/context/AuthContext.js';
import { api } from '../src/lib/api.js';

vi.mock('../src/lib/api.js', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const auth: AuthContextValue = {
  user: { userId: 'author-1', id: 'author-1', email: 'author@example.com', fullName: 'Author', role: 'author' },
  csrfToken: 'csrf',
  isLoading: false,
  isAuthenticated: true,
  login: vi.fn(),
  logout: vi.fn(),
  refreshSession: vi.fn(),
};

describe('SpaceView pagination', () => {
  beforeEach(() => vi.resetAllMocks());

  it('loads all pages from the server-filtered space collection', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/spaces/space-1') {
        return { space: { id: 'space-1', name: 'Architecture', description: '', isMember: true } } as any;
      }
      if (url === '/spaces/space-1/members') return { members: [] } as any;
      if (url.includes('page=1')) {
        return {
          posts: [{ id: 'post-1', slug: 'page-1', title: 'Page 1', status: 'draft', visibility: 'space', isPromoted: false, createdAt: '', updatedAt: '' }],
          pagination: { hasNextPage: true },
        } as any;
      }
      return {
        posts: [{ id: 'post-2', slug: 'page-2', title: 'Page 2', status: 'draft', visibility: 'space', isPromoted: false, createdAt: '', updatedAt: '' }],
        pagination: { hasNextPage: false },
      } as any;
    });

    render(
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={['/spaces/space-1']}>
          <Routes><Route path="/spaces/:idOrSlug" element={<SpaceView />} /></Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('Page 1')).toBeDefined();
      expect(screen.getByText('Page 2')).toBeDefined();
    });

    expect(api.get).toHaveBeenCalledWith('/posts?spaceId=space-1&page=1&limit=100');
    expect(api.get).toHaveBeenCalledWith('/posts?spaceId=space-1&page=2&limit=100');
    expect(screen.getByText('Pages & Documentation')).toHaveTextContent('2');
  });
});
