import type { OutboxService } from '../plugins/outbox.js';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, desc, and } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { posts, comments, users } from '../db/schema.js';
import type { PermissionService } from '../services/permissions.js';
import type { AuditService } from '../services/audit.js';

const CreateCommentSchema = z.object({
  content: z.string().min(1),
  parentId: z.string().uuid().nullish(),
  yjsAnchorStart: z.record(z.unknown()).nullish(),
  yjsAnchorEnd: z.record(z.unknown()).nullish(),
  isReviewComment: z.boolean().optional(),
});

export const commentRoutes: FastifyPluginAsync<{
  db: Database;
  permissionService: PermissionService;
  auditService: AuditService;
  outboxService?: OutboxService;
}> = async (fastify, options) => {
  const { db, permissionService, auditService, outboxService } = options;

  // 1. List comments for a post
  fastify.get('/:id/comments', async (request, reply) => {
    const { id } = request.params as { id: string };

    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) {
      return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });
    }

    const permission = request.user
      ? await permissionService.resolvePostPermission(
          { id: request.user.userId, role: request.user.role },
          { postId: post.id, authorId: post.authorId, status: post.status }
        )
      : post.status === 'published'
      ? 'view'
      : 'none';

    if (!permissionService.canView(permission)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Access denied' });
    }

    const postComments = await db
      .select({
        id: comments.id,
        postId: comments.postId,
        parentId: comments.parentId,
        content: comments.content,
        yjsAnchorStart: comments.yjsAnchorStart,
        yjsAnchorEnd: comments.yjsAnchorEnd,
        isReviewComment: comments.isReviewComment,
        status: comments.status,
        createdAt: comments.createdAt,
        authorId: comments.authorId,
        authorName: users.fullName,
      })
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(eq(comments.postId, id))
      .orderBy(comments.createdAt);

    return reply.send({ comments: postComments });
  });

  // 2. Add comment
  fastify.post('/:id/comments', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
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

    const parseResult = CreateCommentSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }

    const data = parseResult.data;

    // 1-level reply nesting check
    if (data.parentId) {
      const [parent] = await db.select().from(comments).where(and(eq(comments.id, data.parentId), eq(comments.postId, id))).limit(1);
      if (!parent || parent.parentId !== null) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Cannot reply to a nested comment (max 1-level nesting)' });
      }
    }

    const [newComment] = await db
      .insert(comments)
      .values({
        postId: id,
        authorId: user.userId,
        parentId: data.parentId,
        content: data.content,
        yjsAnchorStart: data.yjsAnchorStart,
        yjsAnchorEnd: data.yjsAnchorEnd,
        isReviewComment: data.isReviewComment ?? false,
        status: 'open',
      })
      .returning();

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'comment_created',
      entityType: 'comments',
      entityId: newComment.id,
      metadata: { postId: id, isReviewComment: newComment.isReviewComment },
      ipAddress: request.ip,
    });

    if (outboxService) {
      await outboxService.enqueue(db, 'comment:created', {
        commentId: newComment.id,
        postId: id,
        authorId: user.userId,
      });
    }

    return reply.status(201).send({ comment: newComment });
  });

  // 3. Resolve comment
  fastify.patch('/:id/comments/:commentId/resolve', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const { id, commentId } = request.params as { id: string; commentId: string };
    const user = request.user!;

    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) {
      return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });
    }

    const permission = await permissionService.resolvePostPermission(
      { id: user.userId, role: user.role },
      { postId: post.id, authorId: post.authorId, status: post.status }
    );

    if (!permissionService.canEdit(permission)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Insufficient permission to resolve comment' });
    }

    const [updated] = await db
      .update(comments)
      .set({ status: 'resolved' })
      .where(and(eq(comments.id, commentId), eq(comments.postId, id)))
      .returning();

    return reply.send({ comment: updated });
  });
};
