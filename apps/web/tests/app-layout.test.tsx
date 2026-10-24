import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AppLayout } from '../src/components/layout/AppLayout.js';
import { AuthContext, type AuthContextValue } from '../src/context/AuthContext.js';

describe('AppLayout Shell & Navigation', () => {
  const createMockAuth = (role: 'admin' | 'author' | 'reader' = 'admin'): AuthContextValue => ({
    user: {
      id: 'u1',
      userId: 'u1',
      email: 'user@enterprise-blogger.local',
      fullName: 'Test User',
      role,
    },
    csrfToken: 'csrf-123',
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    refreshSession: vi.fn(),
  });

  it('renders sidebar navigation, topbar, and branding for admin', () => {
    render(
      <MemoryRouter>
        <AuthContext.Provider value={createMockAuth('admin')}>
          <AppLayout />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    expect(screen.getByText('Glyphroom')).toBeDefined();
    expect(screen.getByText('Home')).toBeDefined();
    expect(screen.getByText('Catalog')).toBeDefined();
    expect(screen.getByText('My Work')).toBeDefined();
    expect(screen.getByText('Reviews')).toBeDefined();
    expect(screen.getByText('Admin Console')).toBeDefined();
    expect(screen.getByText('Settings')).toBeDefined();
    expect(screen.getByText('Search posts, commands...')).toBeDefined();
  });

  it('hides Reviews and Admin Console links for reader role', () => {
    render(
      <MemoryRouter>
        <AuthContext.Provider value={createMockAuth('reader')}>
          <AppLayout />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    expect(screen.getByText('Home')).toBeDefined();
    expect(screen.getByText('Catalog')).toBeDefined();
    expect(screen.getByText('My Work')).toBeDefined();
    expect(screen.queryByText('Reviews')).toBeNull();
    expect(screen.queryByText('Admin Console')).toBeNull();
  });

  it('opens and closes CommandSearch dialog via search trigger pill and ESC', () => {
    render(
      <MemoryRouter>
        <AuthContext.Provider value={createMockAuth('admin')}>
          <AppLayout />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    const searchPill = screen.getByText('Search posts, commands...');
    fireEvent.click(searchPill);

    expect(screen.getByPlaceholderText('Type a command or search platform features...')).toBeDefined();
    expect(screen.getByText('Enterprise Search Engine')).toBeDefined();

    // Close via ESC key
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByPlaceholderText('Type a command or search platform features...')).toBeNull();
  });
});
