import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/index.js';
import type { AuthService } from '../services/auth.js';
import type { AuditService } from '../services/audit.js';

const LocalLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const SsoCallbackSchema = z.object({
  provider: z.enum(['oidc', 'entra', 'okta', 'keycloak', 'saml']),
  sub: z.string().min(1),
  email: z.string().email(),
  name: z.string().optional(),
  roles: z.array(z.string()).optional(),
  groups: z.array(z.string()).optional(),
});

export const authRoutes: FastifyPluginAsync<{
  db: Database;
  authService: AuthService;
  auditService: AuditService;
}> = async (fastify, options) => {
  const { authService, auditService } = options;

  // 1. Break-glass Local Admin Login
  fastify.post('/login', async (request, reply) => {
    const parseResult = LocalLoginSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }

    const { email, password } = parseResult.data;
    const user = await authService.verifyLocalLogin(email, password);

    if (!user) {
      await auditService.appendLog({
        actorType: 'human',
        action: 'auth_login_failed',
        metadata: { email, reason: 'invalid_credentials' },
        ipAddress: request.ip,
      });
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid credentials' });
    }

    const sessionToken = authService.createSessionToken(user);
    const csrfToken = authService.generateCsrfToken(sessionToken);

    reply.setCookie('blogger_session', sessionToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 86400,
    });

    await auditService.appendLog({
      actorUserId: user.id,
      actorType: 'human',
      action: 'auth_local_login_success',
      entityType: 'user',
      entityId: user.id,
      ipAddress: request.ip,
    });

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
      csrfToken,
    });
  });

  // 2. Day-1 Enterprise SSO Callback (JIT Provisioning)
  fastify.post('/sso/callback', async (request, reply) => {
    const parseResult = SsoCallbackSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }

    const { provider, sub, email, name, roles, groups } = parseResult.data;

    try {
      const user = await authService.handleSsoCallback(
        provider,
        { sub, email, name, roles, groups },
        'author'
      );

      const sessionToken = authService.createSessionToken(user);
      const csrfToken = authService.generateCsrfToken(sessionToken);

      reply.setCookie('blogger_session', sessionToken, {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 86400,
      });

      await auditService.appendLog({
        actorUserId: user.id,
        actorType: 'human',
        action: 'auth_sso_login_success',
        entityType: 'user',
        entityId: user.id,
        metadata: { provider, ssoSubject: sub },
        ipAddress: request.ip,
      });

      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          ssoProvider: user.ssoProvider,
        },
        csrfToken,
      });
    } catch (err: any) {
      return reply.status(403).send({ error: 'Forbidden', message: err.message || 'SSO authentication failed' });
    }
  });

  // 3. Current User Profile (/me)
  fastify.get('/me', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Not authenticated' });
    }

    const sessionCookie = request.cookies['blogger_session'];
    const csrfToken = sessionCookie ? authService.generateCsrfToken(sessionCookie) : null;

    return reply.send({
      user: request.user,
      csrfToken,
    });
  });

  // 4. Logout
  fastify.post('/logout', async (request, reply) => {
    const userId = request.user?.userId;
    reply.clearCookie('blogger_session', { path: '/' });

    if (userId) {
      await auditService.appendLog({
        actorUserId: userId,
        actorType: 'human',
        action: 'auth_logout',
        entityType: 'user',
        entityId: userId,
        ipAddress: request.ip,
      });
    }

    return reply.send({ success: true, message: 'Logged out successfully' });
  });
};
