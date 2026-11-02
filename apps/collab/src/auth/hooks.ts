import type { onAuthenticatePayload, onLoadDocumentPayload } from '@hocuspocus/server';
import { z } from 'zod';

export interface UserContext {
  id: string;
  role: 'admin' | 'moderator' | 'author' | 'reader';
  name: string;
  permissions: Array<'admin' | 'edit' | 'review' | 'view'>;
}

export interface CollabAuthenticationRequest {
  documentName: string;
  token?: string;
  authorization?: string;
  cookie?: string;
}

export interface CollabAuthOptions {
  allowedOrigins?: string[];
  apiUrl?: string;
  timeoutMs?: number;
  /** Explicit test-only identity injection. Never populated from env or WS input. */
  authenticate?: (request: CollabAuthenticationRequest) => Promise<UserContext>;
}

export class CollabAuthenticationError extends Error {
  readonly reason: string;
  constructor(message: string, public readonly statusCode: 401 | 403 | 503) {
    super(message);
    this.name = 'CollabAuthenticationError';
    this.reason = message;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AccessResponse = z.object({
  success: z.literal(true),
  postId: z.string().regex(UUID),
  user: z.object({
    id: z.string().regex(UUID),
    role: z.enum(['admin', 'moderator', 'author', 'reader']),
    name: z.string().min(1),
  }),
  capabilities: z.object({ edit: z.boolean() }),
});

function header(data: onAuthenticatePayload, name: string): string | undefined {
  const headers = data.requestHeaders as any;
  const value = headers?.get?.(name) ?? headers?.[name] ?? (data as any).request?.headers?.[name];
  return typeof value === 'string' ? value : undefined;
}

function requireEditor(user: UserContext): void {
  if (!user || typeof user.id !== 'string' || !user.id || !Array.isArray(user.permissions)
    || (!user.permissions.includes('edit') && !user.permissions.includes('admin'))) {
    // readOnly still sends the full working CRDT. Pure viewers/reviewers cannot join.
    throw new CollabAuthenticationError('Forbidden: Document edit access required', 403);
  }
}

export function createAuthHooks(options: CollabAuthOptions = {}) {
  if (options.authenticate && process.env.NODE_ENV === 'production') {
    throw new Error('Test collaboration authenticator cannot be used in production');
  }
  const allowedOrigins = options.allowedOrigins ??
    (process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : []);
  const apiUrl = options.apiUrl ?? process.env.GLYPHROOM_API_URL;
  const timeoutMs = options.timeoutMs ?? 5000;

  return {
    async onAuthenticate(data: onAuthenticatePayload) {
      const origin = header(data, 'origin');
      if (origin && !allowedOrigins.includes('*') && !allowedOrigins.includes(origin)) {
        throw new CollabAuthenticationError('Forbidden: Invalid origin', 403);
      }
      if (data.token != null && typeof data.token !== 'string') {
        throw new CollabAuthenticationError('Unauthorized: Invalid credentials', 401);
      }
      const token = data.token || undefined;
      const authorization = header(data, 'authorization');
      const sessions = (header(data, 'cookie') ?? '').split(';').map((s) => s.trim())
        .filter((s) => s.startsWith('blogger_session=') && s.length > 'blogger_session='.length);
      if (sessions.length > 1) throw new CollabAuthenticationError('Unauthorized: Invalid credentials', 401);
      const cookie = sessions[0];
      if (!token && !authorization && !cookie) {
        throw new CollabAuthenticationError('Unauthorized: Missing session or PAT credentials', 401);
      }

      let user: UserContext;
      if (options.authenticate) {
        user = await options.authenticate({ documentName: data.documentName, token, authorization, cookie });
      } else {
        if (!data.documentName.startsWith('post-') || !UUID.test(data.documentName.slice(5))) {
          throw new CollabAuthenticationError('Forbidden: Canonical post room required', 403);
        }
        // A provider may send a real PAT as its auth token; browser providers
        // leave token empty and use the HttpOnly session cookie on the WS upgrade.
        const bearer = token ? `Bearer ${token}` : authorization;
        if (bearer && !/^Bearer eb_pat_[^\s]+$/.test(bearer)) {
          throw new CollabAuthenticationError('Unauthorized: Invalid credentials', 401);
        }
        if (!apiUrl) throw new CollabAuthenticationError('Service unavailable: Collaboration authorization unavailable', 503);
        let response: Response;
        let access: z.infer<typeof AccessResponse>;
        try {
          const url = new URL(apiUrl);
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid API URL');
          const result = await fetch(`${apiUrl.replace(/\/+$/, '')}/api/v1/posts/${data.documentName.slice(5)}/collab-access`, {
            headers: bearer ? { authorization: bearer } : { cookie: cookie! },
            signal: AbortSignal.timeout(timeoutMs),
            redirect: 'error',
          });
          response = result;
          if (response.status === 401) throw new CollabAuthenticationError('Unauthorized: Invalid credentials', 401);
          if (response.status === 403 || response.status === 404) {
            throw new CollabAuthenticationError('Forbidden: Document edit access required', 403);
          }
          if (!response.ok) throw new Error('Authorization dependency failed');
          access = AccessResponse.parse(await response.json());
        } catch (error) {
          if (error instanceof CollabAuthenticationError) throw error;
          throw new CollabAuthenticationError('Service unavailable: Collaboration authorization unavailable', 503);
        }
        if (access.postId !== data.documentName.slice(5) || !access.capabilities.edit) {
          throw new CollabAuthenticationError('Forbidden: Document edit access required', 403);
        }
        user = { ...access.user, permissions: ['edit'] };
      }

      requireEditor(user);
      data.connectionConfig.readOnly = false;
      if (!data.context) data.context = {};
      data.context.user = user;
      data.context.documentName = data.documentName;
      return { user, documentName: data.documentName };
    },

    async onLoadDocument(data: onLoadDocumentPayload) {
      const user = data.context?.user as UserContext | undefined;
      if (!user) throw new CollabAuthenticationError('Unauthorized: No user session found', 401);
      requireEditor(user);
      if (data.context.documentName && data.context.documentName !== data.documentName) {
        throw new CollabAuthenticationError('Forbidden: Document edit access required', 403);
      }
    },
  };
}
