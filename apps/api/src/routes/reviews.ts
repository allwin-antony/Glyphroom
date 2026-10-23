import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { posts, postReviews, users } from '../db/schema.js';
import type { PermissionService } from '../services/permissions.js';
import type { AuditService } from '../services/audit.js';

const SubmitReviewSchema = z.object({
  decision: z.enum(['approved', 'changes_requested']),
  notes: z.string().optional(),
});

export const reviewRoutes: FastifyPluginAsync<{
  db: Database;
  permissionService: PermissionService;
  auditService: AuditService;
}> = async (fastify, options) => {
  const { db, permissionService, auditService } = options;

  // 1. List reviews for a post
  fastify.get('/:id/reviews', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
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

    const reviews = await db
      .select({
        id: postReviews.id,
        decision: postReviews.decision,
        notes: postReviews.notes,
        createdAt: postReviews.createdAt,
        resolvedAt: postReviews.resolvedAt,
        reviewerId: postReviews.reviewerId,
        reviewerName: users.fullName,
      })
      .from(postReviews)
      .innerJoin(users, eq(postReviews.reviewerId, users.id))
      .where(eq(postReviews.postId, id))
      .orderBy(desc(postReviews.createdAt));

    return reply.send({ reviews });
  });

  // 2. Submit Review Decision (Enforce reviewer != author)
  fastify.post('/:id/reviews', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) {
      return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });
    }

    // Strict constraint from docs/DATA_MODEL.md: reviewer must not be author
    if (post.authorId === user.userId) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Author cannot review their own post (chk_reviewer_not_author)',
      });
    }

    const permission = await permissionService.resolvePostPermission(
      { id: user.userId, role: user.role },
      { postId: post.id, authorId: post.authorId, status: post.status }
    );

    if (!permissionService.canReview(permission, false)) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You do not have review permissions for this post',
      });
    }

    const parseResult = SubmitReviewSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }

    const { decision, notes } = parseResult.data;

    const [review] = await db
      .insert(postReviews)
      .values({
        postId: id,
        reviewerId: user.userId,
        decision,
        notes,
        resolvedAt: new Date(),
      })
      .returning();

    // If approved, update post status to approved
    if (decision === 'approved') {
      await db
        .update(posts)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(eq(posts.id, id));
    }

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'post_reviewed',
      entityType: 'post_reviews',
      entityId: review.id,
      metadata: { postId: id, decision },
      ipAddress: request.ip,
    });

    return reply.status(201).send({ review });
  });
};
