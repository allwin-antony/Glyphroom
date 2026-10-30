import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { personalAccessTokens, users } from '../db/schema.js';
import type { AuthService, SessionPayload } from '../services/auth.js';
import type { UserRole } from '../services/permissions.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionPayload;
    isPatAuth?: boolean;
    patId?: string;
    patScopes?: string[];
  }
}

export interface AuthPluginOptions {
  authService: AuthService;
  db?: Database;
}

export const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, options) => {
  const { authService, db } = options;

  await fastify.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET || 'cookie-secret-key-32-chars-long-min',
  });

  // Extract session or Bearer PAT on every request if present
  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    // 1. Session Cookie authentication
    const sessionCookie = request.cookies['blogger_session'];
    if (sessionCookie) {
      const payload = authService.verifySessionToken(sessionCookie);
      if (payload) {
        request.user = payload;
        return;
      }
    }

    // 2. Bearer Token (PAT) authentication for MCP clients and API integrations
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ') && db) {
      const tokenSecret = authHeader.slice(7).trim();
      if (tokenSecret.startsWith('eb_pat_')) {
        const tokenHash = crypto.createHash('sha256').update(tokenSecret).digest('hex');
        const [pat] = await db
          .select({
            id: personalAccessTokens.id,
            userId: personalAccessTokens.userId,
            scopes: personalAccessTokens.scopes,
            expiresAt: personalAccessTokens.expiresAt,
            revokedAt: personalAccessTokens.revokedAt,
            userRole: users.role,
            userEmail: users.email,
            userFullName: users.fullName,
            userIsActive: users.isActive,
          })
          .from(personalAccessTokens)
          .innerJoin(users, eq(personalAccessTokens.userId, users.id))
          .where(eq(personalAccessTokens.tokenHash, tokenHash))
          .limit(1);

        if (pat && !pat.revokedAt && pat.userIsActive) {
          const now = new Date();
          if (!pat.expiresAt || pat.expiresAt > now) {
            request.user = {
              userId: pat.userId,
              email: pat.userEmail,
              role: pat.userRole,
              fullName: pat.userFullName,
              issuedAt: Math.floor(Date.now() / 1000),
              expiresAt: pat.expiresAt ? Math.floor(pat.expiresAt.getTime() / 1000) : Math.floor(Date.now() / 1000) + 86400,
            };
            request.isPatAuth = true;
            request.patId = pat.id;
            request.patScopes = pat.scopes;

            // Touch lastUsedAt asynchronously
            db.update(personalAccessTokens)
              .set({ lastUsedAt: now })
              .where(eq(personalAccessTokens.id, pat.id))
              .catch(() => {});
          }
        }
      }
    }
  });

  // Helper hook to enforce authentication
  fastify.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }

    // If authenticated via Bearer PAT, CSRF check is bypassed (standard API client behavior)
    if (request.isPatAuth) {
      return;
    }

    // CSRF check for state-changing browser cookie requests
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
    if (isMutation) {
      const csrfHeader = request.headers['x-csrf-token'] as string | undefined;
      const sessionCookie = request.cookies['blogger_session'];
      if (!sessionCookie || !csrfHeader || !authService.verifyCsrfToken(sessionCookie, csrfHeader)) {
        reply.status(403).send({ error: 'Forbidden', message: 'Invalid or missing CSRF token' });
        return;
      }
    }
  });

  // Helper hook to enforce specific roles
  fastify.decorate('requireRole', (allowedRoles: UserRole[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required' });
        return;
      }
      if (!allowedRoles.includes(request.user.role)) {
        reply.status(403).send({ error: 'Forbidden', message: 'Insufficient role permissions' });
        return;
      }
    };
  });
};

(authPlugin as any)[Symbol.for('skip-override')] = true;
