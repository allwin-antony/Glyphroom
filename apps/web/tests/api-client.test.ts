import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, setCsrfToken, getCsrfToken, ApiError } from '../src/lib/api.js';

describe('Web API Client & CSRF Injection', () => {
  beforeEach(() => {
    setCsrfToken(null);
    vi.restoreAllMocks();
  });

  it('attaches credentials: include to all requests', async () => {
    let capturedInit: RequestInit | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      capturedInit = init;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await api.get('/auth/me');
    expect(capturedInit?.credentials).toBe('include');
  });

  it('attaches x-csrf-token header on mutating methods when token is present', async () => {
    setCsrfToken('test-csrf-token-123');
    let capturedHeaders: Headers | undefined;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await api.post('/posts', { title: 'Test Post' });
    expect(capturedHeaders?.get('x-csrf-token')).toBe('test-csrf-token-123');
  });

  it('does not attach x-csrf-token header on GET requests', async () => {
    setCsrfToken('test-csrf-token-123');
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

  it('automatically captures csrfToken from response body', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(
        JSON.stringify({ user: { id: 'u1' }, csrfToken: 'new-csrf-token-abc' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    await api.post('/auth/login', { email: 'admin@enterprise-blogger.local', password: 'p' });
    expect(getCsrfToken()).toBe('new-csrf-token-abc');
  });

  it('throws ApiError with payload on non-2xx status', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', message: 'Invalid credentials' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    });

    await expect(api.post('/auth/login', { email: 'wrong@mail.com', password: 'bad' }))
      .rejects.toThrow('Invalid credentials');
  });
});
