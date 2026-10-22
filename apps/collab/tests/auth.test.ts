import { describe, it, expect } from 'vitest';
import { createAuthHooks, type UserContext } from '../src/auth/hooks.js';

describe('Auth Hooks & RBAC Suite', () => {
  describe('Origin Allow-List Verification', () => {
    it('allows requests when origin matches configured allow-list', async () => {
      const auth = createAuthHooks({
        allowedOrigins: ['https://blog.corp.internal', 'http://localhost:3000'],
      });

      const payload: any = {
        requestHeaders: new Headers({
          origin: 'https://blog.corp.internal',
        }),
        token: 'token-author-123',
        connectionConfig: { readOnly: false, isAuthenticated: false },
        context: {},
        documentName: 'post-1',
      };

      await expect(auth.onAuthenticate(payload)).resolves.toBeDefined();
    });

    it('rejects requests from disallowed origins with 4403 Forbidden error', async () => {
      const auth = createAuthHooks({
        allowedOrigins: ['https://blog.corp.internal'],
      });

      const payload: any = {
        requestHeaders: new Headers({
          origin: 'https://malicious-site.com',
        }),
        token: 'token-admin-123',
        connectionConfig: { readOnly: false, isAuthenticated: false },
        context: {},
        documentName: 'post-1',
      };

      await expect(auth.onAuthenticate(payload)).rejects.toThrow('Forbidden: Invalid origin');
    });

    it('permits all origins when wildcard "*" is configured', async () => {
      const auth = createAuthHooks({ allowedOrigins: ['*'] });

      const payload: any = {
        requestHeaders: new Headers({
          origin: 'https://any-domain.example.com',
        }),
        token: 'token-author-456',
        connectionConfig: { readOnly: false, isAuthenticated: false },
        context: {},
        documentName: 'post-1',
      };

      await expect(auth.onAuthenticate(payload)).resolves.toBeDefined();
    });
  });

  describe('Token and Credential Validation', () => {
    it('rejects requests missing an authentication token', async () => {
      const auth = createAuthHooks();

      const payload: any = {
        requestHeaders: new Headers(),
        token: undefined,
        requestParameters: new URLSearchParams(),
        connectionConfig: { readOnly: false, isAuthenticated: false },
        context: {},
        documentName: 'post-1',
      };

      await expect(auth.onAuthenticate(payload)).rejects.toThrow(
        'Unauthorized: Missing authentication token',
      );
    });

    it('extracts token from Bearer authorization header if not provided in payload', async () => {
      const auth = createAuthHooks();

      const payload: any = {
        requestHeaders: new Headers({
          authorization: 'Bearer token-author-789',
        }),
        token: undefined,
        connectionConfig: { readOnly: false, isAuthenticated: false },
        context: {},
        documentName: 'post-1',
      };

      await auth.onAuthenticate(payload);
      expect(payload.context.user.role).toBe('author');
      expect(payload.connectionConfig.readOnly).toBe(false);
    });

    it('extracts token from query string parameters', async () => {
      const auth = createAuthHooks();

      const payload: any = {
        requestHeaders: new Headers(),
        token: undefined,
        requestParameters: new URLSearchParams('token=token-admin-999'),
        connectionConfig: { readOnly: false, isAuthenticated: false },
        context: {},
        documentName: 'post-1',
      };

      await auth.onAuthenticate(payload);
      expect(payload.context.user.role).toBe('admin');
      expect(payload.connectionConfig.readOnly).toBe(false);
    });

    it('rejects invalid or unknown credentials with 4401 Unauthorized', async () => {
      const auth = createAuthHooks();

      const payload: any = {
        token: 'invalid-random-token-xyz',
        connectionConfig: { readOnly: false, isAuthenticated: false },
        context: {},
        documentName: 'post-1',
      };

      await expect(auth.onAuthenticate(payload)).rejects.toThrow(
        'Unauthorized: Invalid credentials',
      );
    });
  });

  describe('RBAC Roles & Read-Only Enforcement', () => {
    it('sets readOnly: false for authors and admins with edit permissions', async () => {
      const auth = createAuthHooks();

      const authorPayload: any = {
        token: 'token-author-alice',
        connectionConfig: { readOnly: true, isAuthenticated: false },
        context: {},
        documentName: 'post-doc',
      };
      await auth.onAuthenticate(authorPayload);
      expect(authorPayload.connectionConfig.readOnly).toBe(false);
      expect(authorPayload.context.user.role).toBe('author');

      const adminPayload: any = {
        token: 'token-admin-bob',
        connectionConfig: { readOnly: true, isAuthenticated: false },
        context: {},
        documentName: 'post-doc',
      };
      await auth.onAuthenticate(adminPayload);
      expect(adminPayload.connectionConfig.readOnly).toBe(false);
      expect(adminPayload.context.user.role).toBe('admin');
    });

    it('enforces readOnly: true for reader role', async () => {
      const auth = createAuthHooks();

      const readerPayload: any = {
        token: 'token-reader-carol',
        connectionConfig: { readOnly: false, isAuthenticated: false },
        context: {},
        documentName: 'post-doc',
      };
      await auth.onAuthenticate(readerPayload);
      expect(readerPayload.connectionConfig.readOnly).toBe(true);
      expect(readerPayload.context.user.role).toBe('reader');
    });

    it('enforces readOnly: true for reviewer permissions', async () => {
      const auth = createAuthHooks();

      const reviewerPayload: any = {
        token: 'token-reviewer-dave',
        connectionConfig: { readOnly: false, isAuthenticated: false },
        context: {},
        documentName: 'post-doc',
      };
      await auth.onAuthenticate(reviewerPayload);
      expect(reviewerPayload.connectionConfig.readOnly).toBe(true);
      expect(reviewerPayload.context.user.permissions).toContain('review');
    });

    it('honors custom mockUsers dictionary', async () => {
      const customUser: UserContext = {
        id: 'usr-vip-1',
        name: 'VIP Auditor',
        role: 'moderator',
        permissions: ['edit'],
      };

      const auth = createAuthHooks({
        mockUsers: {
          'vip-secret-token': customUser,
        },
      });

      const payload: any = {
        token: 'vip-secret-token',
        connectionConfig: { readOnly: true, isAuthenticated: false },
        context: {},
        documentName: 'post-vip',
      };

      await auth.onAuthenticate(payload);
      expect(payload.context.user).toEqual(customUser);
      expect(payload.connectionConfig.readOnly).toBe(false);
    });
  });

  describe('onLoadDocument Lifecycle RBAC', () => {
    it('throws error if user context is missing from connection session', async () => {
      const auth = createAuthHooks();

      const payload: any = {
        context: {},
        documentName: 'post-1',
      };

      await expect(auth.onLoadDocument(payload)).rejects.toThrow(
        'Unauthorized: No user session found',
      );
    });

    it('forbids reader role from accessing private drafts', async () => {
      const auth = createAuthHooks();

      const payload: any = {
        context: {
          user: { id: 'r1', role: 'reader', permissions: ['view'] },
        },
        documentName: 'draft-private-confidential-post',
      };

      await expect(auth.onLoadDocument(payload)).rejects.toThrow(
        'Forbidden: Readers cannot view private drafts',
      );
    });

    it('permits authors to load private drafts', async () => {
      const auth = createAuthHooks();

      const payload: any = {
        context: {
          user: { id: 'a1', role: 'author', permissions: ['edit'] },
        },
        documentName: 'draft-private-confidential-post',
      };

      await expect(auth.onLoadDocument(payload)).resolves.toBeUndefined();
    });
  });
});
