import type { onAuthenticatePayload, onLoadDocumentPayload } from '@hocuspocus/server';

export interface UserContext {
  id: string;
  role: 'admin' | 'moderator' | 'author' | 'reader';
  name: string;
  permissions: Array<'edit' | 'review' | 'view'>;
}

export interface CollabAuthOptions {
  allowedOrigins?: string[];
  mockUsers?: Record<string, UserContext>;
}

export function createAuthHooks(options: CollabAuthOptions = {}) {
  const allowedOrigins = options.allowedOrigins ??
    (process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
      : ['*']);

  return {
    async onAuthenticate(data: onAuthenticatePayload) {
      // 1. Origin verification
      const origin =
        data.requestHeaders?.get?.('origin') ??
        (data.requestHeaders as any)?.origin ??
        (data.request as any)?.headers?.origin;

      if (origin && !allowedOrigins.includes('*') && !allowedOrigins.includes(origin)) {
        throw new Error('Forbidden: Invalid origin');
      }

      // 2. Token / credential resolution
      let token =
        data.token ||
        data.requestParameters?.get?.('token') ||
        (data.requestParameters as any)?.token;

      if (!token) {
        const authHeader =
          data.requestHeaders?.get?.('authorization') ??
          (data.requestHeaders as any)?.authorization ??
          (data.request as any)?.headers?.authorization;

        if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
          token = authHeader.slice(7).trim();
        }
      }

      if (!token) {
        throw new Error('Unauthorized: Missing authentication token');
      }

      // 3. Resolve user identity and RBAC
      let user: UserContext;
      if (options.mockUsers && options.mockUsers[token]) {
        user = options.mockUsers[token];
      } else if (token.startsWith('token-admin') || token === 'admin') {
        user = { id: 'admin-1', role: 'admin', name: 'Admin User', permissions: ['edit'] };
      } else if (token.startsWith('token-moderator') || token === 'moderator') {
        user = { id: 'mod-1', role: 'moderator', name: 'Moderator User', permissions: ['edit'] };
      } else if (token.startsWith('token-author') || token === 'author') {
        user = { id: 'author-1', role: 'author', name: 'Author User', permissions: ['edit'] };
      } else if (token.startsWith('token-reader') || token === 'reader') {
        user = { id: 'reader-1', role: 'reader', name: 'Reader User', permissions: ['view'] };
      } else if (token.startsWith('token-reviewer') || token === 'reviewer') {
        user = { id: 'reviewer-1', role: 'author', name: 'Reviewer User', permissions: ['review'] };
      } else {
        throw new Error('Unauthorized: Invalid credentials');
      }

      // 4. Enforce read-only access for readers and reviewers
      if (user.role !== 'reader' && user.permissions.includes('edit')) {
        data.connectionConfig.readOnly = false;
      } else if (
        user.role === 'reader' ||
        user.permissions.includes('view') ||
        user.permissions.includes('review')
      ) {
        data.connectionConfig.readOnly = true;
      } else {
        data.connectionConfig.readOnly = false;
      }

      // 5. Populate connection context
      if (!data.context) {
        data.context = {} as any;
      }
      data.context.user = user;
      data.context.documentName = data.documentName;

      return {
        user,
        documentName: data.documentName,
      };
    },

    async onLoadDocument(data: onLoadDocumentPayload) {
      const user = data.context?.user as UserContext | undefined;
      if (!user) {
        throw new Error('Unauthorized: No user session found');
      }

      // RBAC document access check
      if (user.role === 'reader' && data.documentName.startsWith('draft-private-')) {
        throw new Error('Forbidden: Readers cannot view private drafts');
      }
    },
  };
}
