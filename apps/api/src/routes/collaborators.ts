import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { posts, postCollaborators, users } from '../db/schema.js';
import type { PermissionService } from '../services/permissions.js';
import type { AuditService } from '../services/audit.js';

const AddCollaboratorSchema = z.object({
  userId: z.string().uuid(),
  permission: z.enum(['edit', 'review', 'view']),
});

export const collaboratorRoutes: FastifyPluginAsync<{
  db: Database;
  permissionService: PermissionService;
  auditService: AuditService;
}> = async (fastify, options) => {
  const { db, permissionService, auditService } = options;

  // 1. List Collaborators for a Post
  fastify.get('/:id/collaborators', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) {
      return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });
    }

    const permission = await permissionService.resolvePostPermission(
      { id: user.userId, role: user.role },
      { postId: post.id, authorId: post.authorId, status: post.status }
    );

    if (!permissionService.canView(permission)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Access denied' });
    }

    const collabs = await db
      .select({
        userId: postCollaborators.userId,
        permission: postCollaborators.permission,
        fullName: users.fullName,
        email: users.email,
        role: users.role,
      })
      .from(postCollaborators)
      .innerJoin(users, eq(postCollaborators.userId, users.id))
      .where(eq(postCollaborators.postId, id));

    return reply.send({ collaborators: collabs });
  });

  // 2. Add or Update Collaborator (Author or Admin Only)
  fastify.post('/:id/collaborators', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) {
      return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });
    }

    // Only post author or system admin can manage collaborators
    const isAuthor = post.authorId === user.userId;
    const isAdmin = user.role === 'admin';
    if (!isAuthor && !isAdmin) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Only the author or system admin can manage collaborators' });
    }

    const parseResult = AddCollaboratorSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }

    const { userId: targetUserId, permission } = parseResult.data;

    // Verify target user exists and is active
    const [targetUser] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
    if (!targetUser || !targetUser.isActive) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Target user does not exist or is inactive' });
    }

    // Upsert collaborator
    const [existing] = await db
      .select()
      .from(postCollaborators)
      .where(and(eq(postCollaborators.postId, id), eq(postCollaborators.userId, targetUserId)))
      .limit(1);

    if (existing) {
      await db
        .update(postCollaborators)
        .set({ permission })
        .where(and(eq(postCollaborators.postId, id), eq(postCollaborators.userId, targetUserId)));
    } else {
      await db.insert(postCollaborators).values({
        postId: id,
        userId: targetUserId,
        permission,
      });
    }

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'collaborator_granted',
      entityType: 'post_collaborators',
      entityId: id,
      metadata: { targetUserId, permission },
      ipAddress: request.ip,
    });

    return reply.status(200).send({ success: true, targetUserId, permission });
  });

  // 3. Remove Collaborator (Author or Admin Only)
  fastify.delete('/:id/collaborators/:userId', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const { id, userId: targetUserId } = request.params as { id: string; userId: string };
    const user = request.user!;

    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) {
      return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });
    }

    const isAuthor = post.authorId === user.userId;
    const isAdmin = user.role === 'admin';
    if (!isAuthor && !isAdmin) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Only author or admin can remove collaborators' });
    }

    await db
      .delete(postCollaborators)
      .where(and(eq(postCollaborators.postId, id), eq(postCollaborators.userId, targetUserId)));

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'collaborator_revoked',
      entityType: 'post_collaborators',
      entityId: id,
      metadata: { targetUserId },
      ipAddress: request.ip,
    });

    return reply.send({ success: true, message: 'Collaborator removed' });
  });
};
