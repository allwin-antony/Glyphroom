import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/index.js';
import { notifications } from '../db/schema.js';

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const notificationRoutes: FastifyPluginAsync<{ db: Database }> = async (fastify, { db }) => {
  fastify.get('/', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: 'Validation failed', details: parsed.error.format() });
    const { page, limit } = parsed.data;
    const userId = request.user!.userId;
    const offset = (page - 1) * limit;
    const [rows, [{ count }], [{ unreadCount }]] = await Promise.all([
      db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)` }).from(notifications).where(eq(notifications.userId, userId)),
      db.select({ unreadCount: sql<number>`count(*)` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
    ]);
    return reply.send({ notifications: rows, pagination: { page, limit, total: Number(count), totalPages: Math.ceil(Number(count) / limit) }, unreadCount: Number(unreadCount) });
  });

  fastify.post('/:id/read', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [updated] = await db.update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, request.user!.userId)))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'Not Found', message: 'Notification not found' });
    return reply.send({ notification: updated });
  });

  fastify.post('/read-all', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, request.user!.userId), isNull(notifications.readAt)));
    return reply.send({ success: true });
  });
};
