import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { api, setCsrfToken, getCsrfToken, ApiError } from '../src/lib/api.js';
import { ProtectedRoute } from '../src/components/auth/ProtectedRoute.js';
import { SignInView } from '../src/views/SignInView.js';
import { AuthContext, type AuthContextValue } from '../src/context/AuthContext.js';

describe('Milestone M1 Adversarial Web Shell & Auth Suite', () => {
  beforeEach(() => {
    setCsrfToken(null);
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. ADVERSARIAL API CLIENT & CSRF INJECTION
  // =========================================================================
  describe('API Client Adversarial Edge Cases & CSRF Injection', () => {
    it('injects x-csrf-token on all mutating HTTP verbs (POST, PUT, PATCH, DELETE)', async () => {
      setCsrfToken('sec-csrf-token-999');
      const capturedHeaders: Record<string, Headers> = {};

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        const method = init?.method || 'GET';
        capturedHeaders[method] = new Headers(init?.headers);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      await api.post('/posts', { title: 'T' });
      await api.put('/posts/1', { title: 'T' });
      await api.patch('/posts/1', { title: 'T' });
      await api.delete('/posts/1');

      for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(capturedHeaders[m]?.get('x-csrf-token')).toBe('sec-csrf-token-999');
        expect(capturedHeaders[m]?.get('Accept')).toBe('application/json');
      }
    });

    it('omits x-csrf-token on GET and HEAD requests even when token is cached', async () => {
      setCsrfToken('sec-csrf-token-999');
      let capturedHeaders: Headers | undefined;

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        capturedHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      await api.get('/posts');
      expect(capturedHeaders?.get('x-csrf-token')).toBeNull();
    });

    it('honors skipCsrf: true flag to suppress CSRF header injection on mutation', async () => {
      setCsrfToken('sec-csrf-token-999');
      let capturedHeaders: Headers | undefined;

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        capturedHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      await api.post('/posts', { title: 'Unprotected' }, { skipCsrf: true });
      expect(capturedHeaders?.get('x-csrf-token')).toBeNull();
    });

    it('handles HTTP 204 No Content without crashing JSON parser', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        return new Response(null, { status: 204 });
      });

      const result = await api.delete('/posts/100');
      expect(result).toBeNull();
    });

    it('handles non-JSON text and HTML error responses gracefully in ApiError', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        return new Response('<html>502 Bad Gateway Nginx</html>', {
          status: 502,
          statusText: 'Bad Gateway',
          headers: { 'Content-Type': 'text/html' },
        });
      });

      await expect(api.get('/health')).rejects.toThrow(ApiError);
      try {
        await api.get('/health');
      } catch (err: any) {
        expect(err.status).toBe(502);
        expect(err.data).toBe('<html>502 Bad Gateway Nginx</html>');
      }
    });

    it('VULNERABILITY PROBE: investigates token transmission on absolute external URLs', async () => {
      setCsrfToken('internal-secret-csrf-token');
      let capturedHeaders: Headers | undefined;
      let capturedUrl: string | undefined;

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        capturedUrl = String(url);
        capturedHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      // If an external URL is passed to api.post:
      await api.post('https://analytics.external-corp.com/collect', { metric: 1 });

      expect(capturedUrl).toBe('https://analytics.external-corp.com/collect');
      // Documenting behavior: api.post attaches x-csrf-token and credentials: 'include'
      // to absolute URLs because resolveUrl passes http:// and https:// URLs through.
      expect(capturedHeaders?.get('x-csrf-token')).toBe('internal-secret-csrf-token');
    });
  });

  // =========================================================================
  // 2. PROTECTED ROUTE GUARDS & RBAC BOUNDARIES
  // =========================================================================
  describe('ProtectedRoute Routing & Role-Based Access Guards', () => {
    const createMockAuth = (overrides: Partial<AuthContextValue> = {}): AuthContextValue => ({
      user: null,
      csrfToken: null,
      isLoading: false,
      isAuthenticated: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
      ...overrides,
    });

    it('displays authenticating spinner during session bootstrap (zero content leak)', () => {
      const auth = createMockAuth({ isLoading: true });

      render(
        <MemoryRouter initialEntries={['/admin']}>
          <AuthContext.Provider value={auth}>
            <ProtectedRoute allowedRoles={['admin']}>
              <div data-testid="secret-admin-content">Confidential Admin Panel</div>
            </ProtectedRoute>
          </AuthContext.Provider>
        </MemoryRouter>
      );

      expect(screen.getByText('Authenticating session...')).toBeDefined();
      expect(screen.queryByTestId('secret-admin-content')).toBeNull();
    });

    it('redirects unauthenticated user to /sign-in and preserves return path in state', () => {
      const auth = createMockAuth({ isLoading: false, isAuthenticated: false, user: null });
      let capturedLocation: any;

      const LocationProbe = () => {
        capturedLocation = useLocation();
        return <div>Sign In Page</div>;
      };

      render(
        <MemoryRouter initialEntries={['/my-work']}>
          <AuthContext.Provider value={auth}>
            <Routes>
              <Route
                path="/my-work"
                element={
                  <ProtectedRoute>
                    <div data-testid="protected-work">My Private Drafts</div>
                  </ProtectedRoute>
                }
              />
              <Route path="/sign-in" element={<LocationProbe />} />
            </Routes>
          </AuthContext.Provider>
        </MemoryRouter>
      );

      expect(screen.getByText('Sign In Page')).toBeDefined();
      expect(screen.queryByTestId('protected-work')).toBeNull();
      expect(capturedLocation.pathname).toBe('/sign-in');
      expect(capturedLocation.state?.from?.pathname).toBe('/my-work');
    });

    it('renders 403 Forbidden screen when user role is not permitted', () => {
      const readerAuth = createMockAuth({
        isLoading: false,
        isAuthenticated: true,
        user: {
          id: 'u-reader',
          userId: 'u-reader',
          email: 'reader@enterprise-blogger.local',
          fullName: 'Reader Bob',
          role: 'reader',
        },
      });

      render(
        <MemoryRouter initialEntries={['/admin']}>
          <AuthContext.Provider value={readerAuth}>
            <ProtectedRoute allowedRoles={['admin']}>
              <div data-testid="admin-secrets">Admin Secrets</div>
            </ProtectedRoute>
          </AuthContext.Provider>
        </MemoryRouter>
      );

      expect(screen.getByText('Access Restricted')).toBeDefined();
      expect(screen.getByText('reader')).toBeDefined();
      expect(screen.getByText('admin')).toBeDefined();
      expect(screen.getByText('Return to Dashboard')).toBeDefined();
      expect(screen.queryByTestId('admin-secrets')).toBeNull();
    });

    it('allows author access to general protected routes without role restriction', () => {
      const authorAuth = createMockAuth({
        isLoading: false,
        isAuthenticated: true,
        user: {
          id: 'u-author',
          userId: 'u-author',
          email: 'author@enterprise-blogger.local',
          fullName: 'Author Alice',
          role: 'author',
        },
      });

      render(
        <MemoryRouter initialEntries={['/my-work']}>
          <AuthContext.Provider value={authorAuth}>
            <ProtectedRoute>
              <div data-testid="author-content">Author Dashboard</div>
            </ProtectedRoute>
          </AuthContext.Provider>
        </MemoryRouter>
      );

      expect(screen.getByTestId('author-content')).toBeDefined();
      expect(screen.queryByText('Access Restricted')).toBeNull();
    });

    it('allows moderator access to /reviews with allowedRoles: [moderator, admin]', () => {
      const modAuth = createMockAuth({
        isLoading: false,
        isAuthenticated: true,
        user: {
          id: 'u-mod',
          userId: 'u-mod',
          email: 'mod@enterprise-blogger.local',
          fullName: 'Mod Charlie',
          role: 'moderator',
        },
      });

      render(
        <MemoryRouter initialEntries={['/reviews']}>
          <AuthContext.Provider value={modAuth}>
            <ProtectedRoute allowedRoles={['moderator', 'admin']}>
              <div data-testid="review-queue">Editorial Review Queue</div>
            </ProtectedRoute>
          </AuthContext.Provider>
        </MemoryRouter>
      );

      expect(screen.getByTestId('review-queue')).toBeDefined();
      expect(screen.queryByText('Access Restricted')).toBeNull();
    });
  });

  // =========================================================================
  // 3. BREAK-GLASS SIGN-IN VIEW HARDENING
  // =========================================================================
  describe('SignInView Break-Glass UI & Error Resilience', () => {
    it('validates empty inputs client-side without sending network request', async () => {
      const mockLogin = vi.fn();
      const mockAuth: AuthContextValue = {
        user: null,
        csrfToken: null,
        isLoading: false,
        isAuthenticated: false,
        login: mockLogin,
        logout: vi.fn(),
        refreshSession: vi.fn(),
      };

      render(
        <MemoryRouter>
          <AuthContext.Provider value={mockAuth}>
            <SignInView />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Submit with empty inputs
      const submitBtn = screen.getByRole('button', { name: 'Sign In' });
      fireEvent.click(submitBtn);

      expect(mockLogin).not.toHaveBeenCalled();
    });

    it('disables submit button and shows loading spinner while authentication is pending', async () => {
      let resolveLogin: any;
      const loginPromise = new Promise<any>((resolve) => {
        resolveLogin = resolve;
      });
      const mockLogin = vi.fn().mockReturnValue(loginPromise);

      const mockAuth: AuthContextValue = {
        user: null,
        csrfToken: null,
        isLoading: false,
        isAuthenticated: false,
        login: mockLogin,
        logout: vi.fn(),
        refreshSession: vi.fn(),
      };

      render(
        <MemoryRouter>
          <AuthContext.Provider value={mockAuth}>
            <SignInView />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      // Quick fill
      fireEvent.click(screen.getByRole('button', { name: 'Fill' }));

      // Submit
      const submitBtn = screen.getByRole('button', { name: 'Sign In' });
      fireEvent.click(submitBtn);

      // Should show Authenticating... and be disabled
      expect(screen.getByText('Authenticating...')).toBeDefined();
      expect(submitBtn).toHaveProperty('disabled', true);

      // Resolve login
      resolveLogin({ id: 'u1', email: 'admin@enterprise-blogger.local', role: 'admin' });
      await waitFor(() => {
        expect(mockLogin).toHaveBeenCalled();
      });
    });

    it('differentiates 400 Bad Request validation errors from 401 Invalid Credentials', async () => {
      const mockLogin = vi.fn().mockRejectedValueOnce(
        new ApiError(400, 'Bad Request', null, 'Validation error: Please provide a valid email format.')
      );

      const mockAuth: AuthContextValue = {
        user: null,
        csrfToken: null,
        isLoading: false,
        isAuthenticated: false,
        login: mockLogin,
        logout: vi.fn(),
        refreshSession: vi.fn(),
      };

      render(
        <MemoryRouter>
          <AuthContext.Provider value={mockAuth}>
            <SignInView />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Fill' }));
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain('Validation error: Please provide a valid email format');
      });
    });

    it('handles unexpected network disconnection errors gracefully', async () => {
      const mockLogin = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'));

      const mockAuth: AuthContextValue = {
        user: null,
        csrfToken: null,
        isLoading: false,
        isAuthenticated: false,
        login: mockLogin,
        logout: vi.fn(),
        refreshSession: vi.fn(),
      };

      render(
        <MemoryRouter>
          <AuthContext.Provider value={mockAuth}>
            <SignInView />
          </AuthContext.Provider>
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Fill' }));
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain('Failed to connect to the authentication service');
      });
    });
  });
});
