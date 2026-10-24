import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { AuthProvider, useAuth } from '../src/context/AuthContext.js';
import { setCsrfToken } from '../src/lib/api.js';

describe('AuthContext Session Management', () => {
  beforeEach(() => {
    setCsrfToken(null);
    vi.restoreAllMocks();
  });

  it('bootstraps active session from /auth/me on mount', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (url.includes('/auth/me')) {
        return new Response(
          JSON.stringify({
            user: {
              userId: 'user-123',
              email: 'admin@enterprise-blogger.local',
              fullName: 'Enterprise Admin',
              role: 'admin',
            },
            csrfToken: 'csrf-bootstrap-456',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.id).toBe('user-123');
    expect(result.current.user?.userId).toBe('user-123');
    expect(result.current.user?.email).toBe('admin@enterprise-blogger.local');
    expect(result.current.user?.role).toBe('admin');
    expect(result.current.csrfToken).toBe('csrf-bootstrap-456');
  });

  it('handles unauthenticated state gracefully when /auth/me returns 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (url.includes('/auth/me')) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized', message: 'No session' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.csrfToken).toBeNull();
  });

  it('authenticates user via login and clears session via logout', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      if (url.includes('/auth/me')) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/auth/login')) {
        return new Response(
          JSON.stringify({
            user: {
              id: 'user-789',
              email: 'admin@enterprise-blogger.local',
              fullName: 'Enterprise Admin',
              role: 'admin',
            },
            csrfToken: 'csrf-login-789',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/auth/logout')) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not found', { status: 404 });
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.login('admin@enterprise-blogger.local', 'admin2026!');
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.id).toBe('user-789');
    expect(result.current.user?.userId).toBe('user-789');
    expect(result.current.csrfToken).toBe('csrf-login-789');

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.csrfToken).toBeNull();
  });
});
