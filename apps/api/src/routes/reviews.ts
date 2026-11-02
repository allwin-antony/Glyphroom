import type { OutboxService } from '../plugins/outbox.js';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, desc, and } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { posts, postReviews, postVersions, users } from '../db/schema.js';
import { PermissionService } from '../services/permissions.js';
import type { AuditService } from '../services/audit.js';
import type { NotificationService } from '../services/notifications.js';

const SubmitReviewSchema = z.object({
  decision: z.enum(['approved', 'changes_requested']),
  submittedVersionId: z.string().uuid(),
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

    if (!z.string().uuid().safeParse(id).success) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid post ID' });
    const outcome = await db.transaction(async (tx) => {
      // A decision can insert a note and withdraw the pin in the same commit.
      // Hold the post stable through the notes read so those states never mix.
      const [post] = await tx.select().from(posts).where(eq(posts.id, id)).limit(1).for('share');
      if (!post) return { statusCode: 404, body: { error: 'Not Found', message: 'Post not found' } };
      const [account] = await tx.select({ id: users.id, role: users.role, isActive: users.isActive }).from(users)
        .where(eq(users.id, user.userId)).limit(1);
      if (!account?.isActive) return { statusCode: 401, body: { error: 'Unauthorized', message: 'Authentication required' } };
      const permission = await new PermissionService(tx as unknown as Database).resolvePostPermission(account, { ...post, postId: post.id });
      const editor = permissionService.canEdit(permission);
      const activeReview = post.status === 'in_review' || post.status === 'approved';
      if (!editor && (!activeReview || !permissionService.canReview(permission, user.userId === post.authorId))) {
        return { statusCode: 403, body: { error: 'Forbidden', message: 'Access denied' } };
      }
      if (!editor) {
        const [pin] = post.submittedVersionId ? await tx.select({ id: postVersions.id }).from(postVersions).where(and(
          eq(postVersions.id, post.submittedVersionId), eq(postVersions.postId, post.id),
          eq(postVersions.triggerReason, 'review_submission'),
        )).limit(1) : [];
        if (!pin) return { statusCode: 409, body: { error: 'Conflict', message: 'Review checkpoint unavailable' } };
      }
      const reviews = await tx.select({
        id: postReviews.id, decision: postReviews.decision, notes: postReviews.notes,
        createdAt: postReviews.createdAt, resolvedAt: postReviews.resolvedAt, reviewerId: postReviews.reviewerId,
        submittedVersionId: postReviews.submittedVersionId, reviewerName: users.fullName,
      }).from(postReviews).innerJoin(users, eq(postReviews.reviewerId, users.id))
        .where(and(eq(postReviews.postId, post.id), editor ? undefined : eq(postReviews.submittedVersionId, post.submittedVersionId!)))
        .orderBy(desc(postReviews.createdAt));
      return { statusCode: 200, body: { reviews } };
    });
    return reply.status(outcome.statusCode).send(outcome.body);
  });

  // 2. Submit Review Decision (Enforce reviewer != author)
  fastify.post('/:id/reviews', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    if (!z.string().uuid().safeParse(id).success) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid post ID' });
    const denied = (statusCode: number, error: string, message: string) => ({ ok: false as const, statusCode, body: { error, message } });
    let outcome;
    try {
      outcome = await db.transaction(async (tx) => {
        // Serialize against submissions, other decisions, and publication. The
        // displayed ID must still be the active pin when the decision commits.
        const [post] = await tx.select().from(posts).where(eq(posts.id, id)).limit(1).for('update');
        if (!post) return denied(404, 'Not Found', 'Post not found');
        if (post.authorId === user.userId) return denied(403, 'Forbidden', 'Author cannot review their own post (chk_reviewer_not_author)');
        const [account] = await tx.select({ id: users.id, role: users.role, isActive: users.isActive }).from(users)
          .where(eq(users.id, user.userId)).limit(1);
        if (!account?.isActive) return denied(401, 'Unauthorized', 'Authentication required');
        const permission = await new PermissionService(tx as unknown as Database).resolvePostPermission(account, { ...post, postId: post.id });
        if (!permissionService.canReview(permission, false) || (request.isPatAuth && !request.patScopes?.includes('post:review'))) {
          return denied(403, 'Forbidden', 'You do not have review permissions for this post');
        }
        if (post.status !== 'in_review') return denied(409, 'Invalid transition', 'A review can only be submitted for a post in_review');
        const parsed = SubmitReviewSchema.safeParse(request.body);
        if (!parsed.success) return denied(400, 'Validation failed', 'A decision and displayed submittedVersionId are required');
        const { decision, notes, submittedVersionId } = parsed.data;
        if (!post.submittedVersionId || post.submittedVersionId !== submittedVersionId) {
          return denied(409, 'Conflict', 'Review checkpoint changed or unavailable. Reload before deciding.');
        }
        const [submitted] = await tx.select({ id: postVersions.id, markdown: postVersions.markdownSnapshot }).from(postVersions)
          .where(and(eq(postVersions.id, submittedVersionId), eq(postVersions.postId, post.id), eq(postVersions.triggerReason, 'review_submission'))).limit(1);
        if (!submitted || typeof submitted.markdown !== 'string') return denied(409, 'Conflict', 'Review checkpoint unavailable');

        const [review] = await tx.insert(postReviews).values({ postId: post.id, reviewerId: user.userId,
          submittedVersionId: submitted.id, decision, notes, resolvedAt: new Date() }).returning();
        await tx.update(posts).set({ status: decision === 'approved' ? 'approved' : 'draft',
          submittedVersionId: decision === 'approved' ? submitted.id : null, updatedAt: new Date() }).where(eq(posts.id, post.id));
        await outboxService?.enqueue(tx, 'post:reviewed', { postId: post.id, reviewerId: user.userId, decision,
          submittedVersionId: submitted.id, notes: notes ?? null });
        return { ok: true as const, review, post };
      });
    } catch {
      request.log.warn({ postId: id }, 'Review decision transaction failed');
      return reply.status(503).send({ error: 'Service Unavailable', message: 'Unable to save the review decision' });
    }
    if (!outcome.ok) return reply.status(outcome.statusCode).send(outcome.body);
    const { review, post } = outcome;
    const decision = review.decision;

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'post_reviewed',
      entityType: 'post_reviews',
      entityId: review.id,
      metadata: { postId: id, decision },
      ipAddress: request.ip,
    }).catch(() => request.log.warn({ postId: id }, 'Review committed; audit delivery failed'));

    await notificationService.create({
      userId: post.authorId,
      type: 'review_decision',
      title: decision === 'approved' ? 'Review approved' : 'Changes requested',
      body: `${post.title}: ${decision === 'approved' ? 'your review was approved.' : 'the reviewer requested changes.'}`,
      entityType: 'post',
      entityId: id,
      href: `/posts/${id}`,
    }).catch(() => request.log.warn({ postId: id }, 'Review committed; notification delivery failed'));

    return reply.status(201).send({ review });
  });
};
