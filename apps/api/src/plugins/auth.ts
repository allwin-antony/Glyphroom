import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import type { AuthService, SessionPayload } from '../services/auth.js';
import type { UserRole } from '../services/permissions.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionPayload;
  }
}

export interface AuthPluginOptions {
  authService: AuthService;
}

export const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, options) => {
  const { authService } = options;

  await fastify.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET || 'cookie-secret-key-32-chars-long-min',
  });

  // Extract session on every request if present
  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    const sessionCookie = request.cookies['blogger_session'];
    if (sessionCookie) {
      const payload = authService.verifySessionToken(sessionCookie);
      if (payload) {
        request.user = payload;
      }
    }
  });

  // Helper hook to enforce authentication
  fastify.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }

    // CSRF check for state-changing requests if session is active
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

