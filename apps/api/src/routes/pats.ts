import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { eq, and, isNull } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { personalAccessTokens } from '../db/schema.js';
import type { AuditService } from '../services/audit.js';

const CreatePatSchema = z.object({
  name: z.string().min(1).max(255),
  scopes: z.array(z.string()).min(1),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

export const patRoutes: FastifyPluginAsync<{
  db: Database;
  auditService: AuditService;
}> = async (fastify, options) => {
  const { db, auditService } = options;

  // 1. List PATs for current user (active only)
  fastify.get('/', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const user = request.user!;

    const tokens = await db
      .select({
        id: personalAccessTokens.id,
        name: personalAccessTokens.name,
        scopes: personalAccessTokens.scopes,
        lastUsedAt: personalAccessTokens.lastUsedAt,
        expiresAt: personalAccessTokens.expiresAt,
        revokedAt: personalAccessTokens.revokedAt,
        createdAt: personalAccessTokens.createdAt,
      })
      .from(personalAccessTokens)
      .where(
        and(
          eq(personalAccessTokens.userId, user.userId),
          isNull(personalAccessTokens.revokedAt)
        )
      );

    return reply.send({ tokens });
  });

  // 2. Create new PAT
  fastify.post('/', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const user = request.user!;

    const parseResult = CreatePatSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }

    const { name, scopes, expiresInDays } = parseResult.data;

    // Generate cryptographic secret: eb_pat_<64 hex chars>
    const secret = `eb_pat_${crypto.randomBytes(32).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(secret).digest('hex');

    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 86400 * 1000)
      : null;

    const [newToken] = await db
      .insert(personalAccessTokens)
      .values({
        userId: user.userId,
        name,
        tokenHash,
        scopes,
        expiresAt,
      })
      .returning({
        id: personalAccessTokens.id,
        name: personalAccessTokens.name,
        scopes: personalAccessTokens.scopes,
        expiresAt: personalAccessTokens.expiresAt,
        createdAt: personalAccessTokens.createdAt,
      });

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'pat_created',
      entityType: 'personal_access_tokens',
      entityId: newToken.id,
      metadata: { name, scopes, expiresAt },
      ipAddress: request.ip,
    });

    return reply.status(201).send({
      token: newToken,
      secret, // Note: Returned ONLY once upon creation!
    });
  });

  // 3. Revoke PAT
  fastify.delete('/:id', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const [token] = await db
      .select()
      .from(personalAccessTokens)
      .where(
        user.role === 'admin'
          ? eq(personalAccessTokens.id, id)
          : and(eq(personalAccessTokens.id, id), eq(personalAccessTokens.userId, user.userId))
      )
      .limit(1);

    if (!token) {
      return reply.status(404).send({ error: 'Not Found', message: 'Token not found or access denied' });
    }

    await db
      .update(personalAccessTokens)
      .set({ revokedAt: new Date() })
      .where(eq(personalAccessTokens.id, id));

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'pat_revoked',
      entityType: 'personal_access_tokens',
      entityId: id,
      ipAddress: request.ip,
    });

    return reply.send({ success: true, message: 'Token revoked successfully' });
  });
};
