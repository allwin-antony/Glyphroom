import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { PostSettingsTab } from '../src/components/editor/tabs/PostSettingsTab.js';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../src/lib/api.js', () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {
    status = 500;
  },
}));

describe('PostSettingsTab persistent tags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.get.mockImplementation(async (url: string) => {
      if (url === '/posts/coe') return { coes: [] };
      if (url === '/spaces') return { spaces: [] };
      if (url.endsWith('/collaborators')) return { collaborators: [] };
      if (url === '/posts/collaborators/users') return { users: [] };
      return {};
    });
    apiMock.patch.mockResolvedValue({
      post: {
        id: 'post-1',
        title: 'Tagged post',
        slug: 'tagged-post',
        excerpt: '',
        status: 'draft',
        tags: ['existing', 'new-tag'],
      },
    });
  });

  it('loads tags from metadata and persists added/removed tags with post settings', async () => {
    render(
      <MemoryRouter>
        <PostSettingsTab
          postId="post-1"
          postMetadata={{
            id: 'post-1',
            title: 'Tagged post',
            slug: 'tagged-post',
            status: 'draft',
            tags: ['existing'],
          }}
        />
      </MemoryRouter>
    );

    expect(screen.getByText('#existing')).toBeDefined();
    expect(screen.queryByText('#engineering')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Add tag and press Enter...'), {
      target: { value: 'new-tag' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('Add tag and press Enter...'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /Save Post Settings/i }));

    await waitFor(() => {
      expect(apiMock.patch).toHaveBeenCalledWith('/posts/post-1', expect.objectContaining({
        tags: ['existing', 'new-tag'],
      }));
    });
  });
});
