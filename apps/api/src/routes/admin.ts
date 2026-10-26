import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, ilike, isNull, isNotNull, or, lt, gt } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { personalAccessTokens, users } from '../db/schema.js';
import type { AuditService } from '../services/audit.js';

const RoleSchema = z.enum(['admin', 'moderator', 'author', 'reader']);
const UserStatusSchema = z.enum(['all', 'active', 'inactive']).default('all');
const PatStatusSchema = z.enum(['all', 'active', 'revoked', 'expired']).default('all');

const UpdateRoleSchema = z.object({ role: RoleSchema });
const UpdateStatusSchema = z.object({ isActive: z.boolean() });

function boundedInteger(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 0), maximum) : fallback;
}

export const adminRoutes: FastifyPluginAsync<{
  db: Database;
  auditService: AuditService;
}> = async (fastify, options) => {
  const { db, auditService } = options;
  const adminOnly = [(fastify as any).requireAuth, (fastify as any).requireRole(['admin'])];

  // User directory. Search is intentionally limited to identity fields and never exposes credentials.
  fastify.get('/users', { preHandler: adminOnly }, async (request, reply) => {
    const query = request.query as { q?: string; search?: string; role?: string; status?: string; limit?: string; offset?: string };
    const search = (query.q ?? query.search ?? '').trim();
    let role: string | undefined;
    if (query.role && query.role !== 'all') {
      const roleResult = RoleSchema.safeParse(query.role);
      if (!roleResult.success) return reply.status(400).send({ error: 'Validation failed', message: 'Invalid role filter' });
      role = roleResult.data;
    }
    const statusResult = UserStatusSchema.safeParse(query.status ?? 'all');
    if (!statusResult.success) return reply.status(400).send({ error: 'Validation failed', message: 'Invalid status filter' });
    const status = statusResult.data;
    const limit = boundedInteger(query.limit, 100, 100);
    const offset = boundedInteger(query.offset, 0, 1_000_000);

    const filters = [];
    if (search) filters.push(or(ilike(users.email, `%${search}%`), ilike(users.fullName, `%${search}%`))!);
    if (role) filters.push(eq(users.role, role as 'admin' | 'moderator' | 'author' | 'reader'));
    if (status === 'active') filters.push(eq(users.isActive, true));
    if (status === 'inactive') filters.push(eq(users.isActive, false));

    const result = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        isActive: users.isActive,
        ssoProvider: users.ssoProvider,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(users.fullName, users.email)
      .limit(limit)
      .offset(offset);

    return reply.send({ users: result, pagination: { limit, offset, returned: result.length } });
  });

  fastify.patch('/users/:id/role', { preHandler: adminOnly }, async (request, reply) => {
    const parsed = UpdateRoleSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.format() });
    const { id } = request.params as { id: string };
    const [existing] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, id)).limit(1);
    if (!existing) return reply.status(404).send({ error: 'Not Found', message: 'User not found' });

    const [updated] = await db.update(users).set({ role: parsed.data.role, updatedAt: new Date() }).where(eq(users.id, id)).returning({
      id: users.id, email: users.email, fullName: users.fullName, role: users.role, isActive: users.isActive,
    });
    const actor = request.user!;
    await auditService.appendLog({
      actorUserId: actor.userId, actorType: 'human', action: 'admin_user_role_updated', entityType: 'users', entityId: id,
      metadata: { previousRole: existing.role, role: parsed.data.role }, ipAddress: request.ip,
    });
    return reply.send({ user: updated });
  });

  const updateStatus = async (request: any, reply: any, forcedStatus?: boolean) => {
    const parsed = forcedStatus === undefined ? UpdateStatusSchema.safeParse(request.body) : { success: true as const, data: { isActive: forcedStatus } };
    if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.format() });
    const { id } = request.params as { id: string };
    const [existing] = await db.select({ id: users.id, isActive: users.isActive }).from(users).where(eq(users.id, id)).limit(1);
    if (!existing) return reply.status(404).send({ error: 'Not Found', message: 'User not found' });

    const [updated] = await db.update(users).set({ isActive: parsed.data.isActive, updatedAt: new Date() }).where(eq(users.id, id)).returning({
      id: users.id, email: users.email, fullName: users.fullName, role: users.role, isActive: users.isActive,
    });
    const actor = request.user!;
    await auditService.appendLog({
      actorUserId: actor.userId, actorType: 'human',
      action: parsed.data.isActive ? 'admin_user_activated' : 'admin_user_deactivated',
      entityType: 'users', entityId: id, metadata: { previousIsActive: existing.isActive, isActive: parsed.data.isActive }, ipAddress: request.ip,
    });
    return reply.send({ user: updated });
  };

  fastify.patch('/users/:id/status', { preHandler: adminOnly }, (request, reply) => updateStatus(request, reply));
  fastify.post('/users/:id/activate', { preHandler: adminOnly }, (request, reply) => updateStatus(request, reply, true));
  fastify.post('/users/:id/deactivate', { preHandler: adminOnly }, (request, reply) => updateStatus(request, reply, false));

  // Enterprise PAT inventory. Token hashes and secrets are never returned.
  fastify.get('/pats', { preHandler: adminOnly }, async (request, reply) => {
    const query = request.query as { q?: string; status?: string; limit?: string; offset?: string };
    const search = (query.q ?? '').trim();
    const statusResult = PatStatusSchema.safeParse(query.status ?? 'all');
    if (!statusResult.success) return reply.status(400).send({ error: 'Validation failed', message: 'Invalid PAT status filter' });
    const status = statusResult.data;
    const limit = boundedInteger(query.limit, 100, 100);
    const offset = boundedInteger(query.offset, 0, 1_000_000);
    const filters = [];
    if (search) filters.push(or(ilike(personalAccessTokens.name, `%${search}%`), ilike(users.email, `%${search}%`), ilike(users.fullName, `%${search}%`))!);
    if (status === 'active') filters.push(isNull(personalAccessTokens.revokedAt), or(isNull(personalAccessTokens.expiresAt), gt(personalAccessTokens.expiresAt, new Date()))!);
    if (status === 'revoked') filters.push(isNotNull(personalAccessTokens.revokedAt));
    if (status === 'expired') filters.push(lt(personalAccessTokens.expiresAt, new Date()), isNull(personalAccessTokens.revokedAt));

    const tokens = await db
      .select({
        id: personalAccessTokens.id,
        name: personalAccessTokens.name,
        scopes: personalAccessTokens.scopes,
        lastUsedAt: personalAccessTokens.lastUsedAt,
        expiresAt: personalAccessTokens.expiresAt,
        revokedAt: personalAccessTokens.revokedAt,
        createdAt: personalAccessTokens.createdAt,
        userId: users.id,
        userEmail: users.email,
        userFullName: users.fullName,
        userIsActive: users.isActive,
      })
      .from(personalAccessTokens)
      .innerJoin(users, eq(personalAccessTokens.userId, users.id))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(personalAccessTokens.createdAt), desc(personalAccessTokens.id))
      .limit(limit)
      .offset(offset);

    return reply.send({ tokens, pagination: { limit, offset, returned: tokens.length } });
  });

  const revokePat = async (request: any, reply: any) => {
    const { id } = request.params as { id: string };
    const [token] = await db.select({ id: personalAccessTokens.id, revokedAt: personalAccessTokens.revokedAt }).from(personalAccessTokens).where(eq(personalAccessTokens.id, id)).limit(1);
    if (!token) return reply.status(404).send({ error: 'Not Found', message: 'Token not found' });
    if (token.revokedAt) return reply.status(409).send({ error: 'Conflict', message: 'Token is already revoked' });
    await db.update(personalAccessTokens).set({ revokedAt: new Date() }).where(eq(personalAccessTokens.id, id));
    const actor = request.user!;
    await auditService.appendLog({ actorUserId: actor.userId, actorType: 'human', action: 'admin_pat_revoked', entityType: 'personal_access_tokens', entityId: id, ipAddress: request.ip });
    return reply.send({ success: true, message: 'Token revoked successfully' });
  };

  fastify.delete('/pats/:id', { preHandler: adminOnly }, revokePat);
  fastify.post('/pats/:id/revoke', { preHandler: adminOnly }, revokePat);
};
