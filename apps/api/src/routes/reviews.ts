import type { OutboxService } from '../plugins/outbox.js';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, desc, and } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { posts, postReviews, postVersions, users } from '../db/schema.js';
import type { PermissionService } from '../services/permissions.js';
import type { AuditService } from '../services/audit.js';
import type { NotificationService } from '../services/notifications.js';

const SubmitReviewSchema = z.object({
  decision: z.enum(['approved', 'changes_requested']),
  notes: z.string().optional(),
});

export const reviewRoutes: FastifyPluginAsync<{
  db: Database;
  permissionService: PermissionService;
  auditService: AuditService;
  notificationService: NotificationService;
  outboxService?: OutboxService;
}> = async (fastify, options) => {
  const { db, permissionService, auditService, notificationService, outboxService } = options;

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
        submittedVersionId: postReviews.submittedVersionId,
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
      {
        postId: post.id,
        authorId: post.authorId,
        status: post.status,
        spaceId: post.spaceId,
        visibility: post.visibility,
        isPromoted: post.isPromoted,
      }
    );

    if (!permissionService.canReview(permission, false)) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'You do not have review permissions for this post',
      });
    }

    if (post.status !== 'in_review') {
      return reply.status(409).send({
        error: 'Invalid transition',
        message: `A review can only be submitted for a post in_review (current status: ${post.status})`,
      });
    }

    const parseResult = SubmitReviewSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }

    const { decision, notes } = parseResult.data;

    let submittedVersion: any = null;
    if (post.submittedVersionId) {
      const [v] = await db
        .select()
        .from(postVersions)
        .where(and(eq(postVersions.id, post.submittedVersionId), eq(postVersions.postId, id)))
        .limit(1);
      submittedVersion = v;
    }

    if (!submittedVersion) {
      const [v] = await db
        .select()
        .from(postVersions)
        .where(and(eq(postVersions.postId, id), eq(postVersions.triggerReason, 'review_submission')))
        .orderBy(desc(postVersions.versionNumber))
        .limit(1);
      submittedVersion = v;
    }

    if (!submittedVersion) {
      return reply.status(409).send({
        error: 'Invalid transition',
        message: 'The submitted review checkpoint could not be found',
      });
    }

    const { review } = await db.transaction(async (tx) => {
      const [newReview] = await tx
        .insert(postReviews)
        .values({
          postId: id,
          reviewerId: user.userId,
          submittedVersionId: submittedVersion.id,
          decision,
          notes,
          resolvedAt: new Date(),
        })
        .returning();

      await tx
        .update(posts)
        .set({
          status: decision === 'approved' ? 'approved' : 'draft',
          submittedVersionId: decision === 'approved' ? submittedVersion.id : null,
          updatedAt: new Date(),
        })
        .where(eq(posts.id, id));

      return { review: newReview };
    });

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'post_reviewed',
      entityType: 'post_reviews',
      entityId: review.id,
      metadata: { postId: id, decision },
      ipAddress: request.ip,
    });

    if (outboxService) {
      await outboxService.enqueue(db, 'post:reviewed', {
        postId: id,
        reviewerId: user.userId,
        decision: decision as 'approved' | 'changes_requested',
        submittedVersionId: submittedVersion.id,
        notes: notes || null,
      });
    }

    await notificationService.create({
      userId: post.authorId,
      type: 'review_decision',
      title: decision === 'approved' ? 'Review approved' : 'Changes requested',
      body: `${post.title}: ${decision === 'approved' ? 'your review was approved.' : 'the reviewer requested changes.'}`,
      entityType: 'post',
      entityId: id,
      href: `/posts/${id}`,
    });

    return reply.status(201).send({ review });
  });
};
