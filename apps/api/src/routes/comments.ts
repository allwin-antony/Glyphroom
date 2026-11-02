import type { OutboxService } from '../plugins/outbox.js';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, desc, and, inArray } from 'drizzle-orm';
import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { exportDerivedMarkdown, normalizeHeadingText } from '@glyphroom/shared';
import type { Database } from '../db/index.js';
import { posts, postVersions, comments, users } from '../db/schema.js';
import type { PermissionService } from '../services/permissions.js';
import type { AuditService } from '../services/audit.js';
import type { NotificationService } from '../services/notifications.js';
import { projectPostContent } from './posts.js';

const CreateCommentSchema = z.object({
  content: z.string().min(1),
  parentId: z.string().uuid().nullish(),
  yjsAnchorStart: z.record(z.unknown()).nullish(),
  yjsAnchorEnd: z.record(z.unknown()).nullish(),
  anchorHeading: z.string().max(500).optional(),
  isReviewComment: z.boolean().optional(),
});

// Keep labels aligned with MCP's clean Markdown headings, including fence handling.
function markdownHeadingLabels(markdown: string): string[] {
  const headings: string[] = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let fence: { character: string; length: number } | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      const closing = line.match(/^ {0,3}(`+|~+)\s*$/);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = undefined;
      continue;
    }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (opening) {
      fence = { character: opening[1][0], length: opening[1].length };
      continue;
    }
    const atx = line.match(/^ {0,3}#{1,6}[\t ]+(.+?)\s*$/);
    if (atx) {
      const heading = atx[1].replace(/[\t ]+#+[\t ]*$/, '').trim();
      if (heading) headings.push(heading);
    } else if (index > 0 && /^ {0,3}(?:=+|-+)\s*$/.test(line)) {
      const heading = lines[index - 1].trim();
      if (heading) headings.push(heading);
    }
  }
  return headings;
}

export const commentRoutes: FastifyPluginAsync<{
  db: Database;
  permissionService: PermissionService;
  auditService: AuditService;
  notificationService?: NotificationService;
  outboxService?: OutboxService;
}> = async (fastify, options) => {
  const { db, permissionService, auditService, notificationService, outboxService } = options;

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
        { ...post, postId: post.id }
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
      { ...post, postId: post.id }
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
    let parentComment: typeof comments.$inferSelect | undefined;
    if (data.parentId) {
      const [parent] = await db.select().from(comments).where(and(eq(comments.id, data.parentId), eq(comments.postId, id))).limit(1);
      if (!parent || parent.parentId !== null) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Cannot reply to a nested comment (max 1-level nesting)' });
      }
      parentComment = parent;
    }

    let yjsAnchorStart = data.yjsAnchorStart;
    let yjsAnchorEnd = data.yjsAnchorEnd;
    if (data.anchorHeading !== undefined) {
      if (yjsAnchorStart != null || yjsAnchorEnd != null) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Use either anchorHeading or explicit anchor coordinates, not both' });
      }
      const target = normalizeHeadingText(data.anchorHeading.replace(/[\t ]+#+[\t ]*$/, ''));
      if (!target) {
        return reply.status(400).send({ error: 'Bad Request', code: 'ANCHOR_HEADING_NOT_FOUND', message: 'A non-empty visible heading label is required' });
      }

      const stateError = {
        error: 'Conflict', code: 'ANCHOR_STATE_UNAVAILABLE',
        message: 'Heading anchor state unavailable or inconsistent with visible content'
      };
      const projection = await projectPostContent(db, permissionService, post, user);
      if (!projection.ok) {
        return reply.status(projection.statusCode).send(projection.statusCode === 409 ? stateError : projection.error);
      }
      const { contentSource, derivedMarkdown } = projection.content;
      let selectedState = post.yjsState;
      if (contentSource !== 'working') {
        const versionId = contentSource === 'submitted' ? projection.content.submittedVersionId : post.publishedVersionId;
        if (!versionId) return reply.status(409).send(stateError);
        const predicates = [eq(postVersions.id, versionId), eq(postVersions.postId, post.id)];
        if (contentSource === 'submitted') predicates.push(eq(postVersions.triggerReason, 'review_submission'));
        else predicates.push(inArray(postVersions.triggerReason, ['review_submission', 'publication']));
        const [version] = await db.select({
          yjsStateSnapshot: postVersions.yjsStateSnapshot,
          markdownSnapshot: postVersions.markdownSnapshot
        }).from(postVersions).where(and(...predicates)).limit(1);
        if (!version || version.markdownSnapshot !== derivedMarkdown) return reply.status(409).send(stateError);
        selectedState = version.yjsStateSnapshot;
      }
      if (!(selectedState instanceof Uint8Array) || selectedState.length === 0) return reply.status(409).send(stateError);

      const ydoc = new Y.Doc();
      try {
        Y.decodeUpdate(selectedState);
        Y.applyUpdate(ydoc, selectedState);
        if (ydoc.store.pendingStructs || ydoc.store.pendingDs) throw new Error('Incomplete anchor state');
        const root = ydoc.share.has('prosemirror') ? 'prosemirror' : ydoc.share.has('default') ? 'default' : null;
        if (!root) throw new Error('Incoherent anchor state');
        const json = yDocToProsemirrorJSON(ydoc, root) as any;
        if (exportDerivedMarkdown(json) !== derivedMarkdown) {
          throw new Error('Incoherent anchor state');
        }
        const fragment = ydoc.getXmlFragment(root);

        const visibleMatches = markdownHeadingLabels(derivedMarkdown).filter((label) => normalizeHeadingText(label) === target);
        if (visibleMatches.length !== 1) {
          return reply.status(400).send({
            error: 'Bad Request',
            code: visibleMatches.length > 1 ? 'ANCHOR_HEADING_AMBIGUOUS' : 'ANCHOR_HEADING_NOT_FOUND',
            message: visibleMatches.length > 1 ? 'Heading label is ambiguous in visible content' : 'Heading label not found in visible content'
          });
        }

        const headingMatches: Array<{ startNode: Y.XmlText; endNode: Y.XmlText }> = [];
        let marker = 'GLYPHROOM_COMMENT_ANCHOR_TARGET';
        while (derivedMarkdown.includes(marker)) marker += '_';

        const content = Array.isArray(json?.content) ? json.content : [];
        for (let i = 0; i < fragment.length; i++) {
          const item = fragment.get(i);
          if (item instanceof Y.XmlElement && item.nodeName === 'heading') {
            const nodeJson = content[i];
            if (!nodeJson) continue;
            const nodeLabels = markdownHeadingLabels(exportDerivedMarkdown(nodeJson));
            if (nodeLabels.length !== 1 || normalizeHeadingText(nodeLabels[0]) !== target) continue;

            const cloned = JSON.parse(JSON.stringify(json));
            if (cloned.content && cloned.content[i]) {
              cloned.content[i].content = [{ type: 'text', text: marker }];
              if (markdownHeadingLabels(exportDerivedMarkdown(cloned)).includes(marker)) {
                const textChildren = item.toArray().filter((c) => c instanceof Y.XmlText) as Y.XmlText[];
                if (textChildren.length > 0) {
                  headingMatches.push({
                    startNode: textChildren[0],
                    endNode: textChildren[textChildren.length - 1],
                  });
                }
              }
            }
          }
        }

        if (headingMatches.length !== 1) {
          return reply.status(400).send({
            error: 'Bad Request',
            code: headingMatches.length > 1 ? 'ANCHOR_HEADING_AMBIGUOUS' : 'ANCHOR_HEADING_NOT_FOUND',
            message: headingMatches.length > 1 ? 'Heading label is ambiguous in visible content' : 'Heading label not found in visible content'
          });
        }

        const match = headingMatches[0];
        yjsAnchorStart = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(match.startNode, 0));
        yjsAnchorEnd = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(match.endNode, match.endNode.length));
      } catch {
        return reply.status(409).send(stateError);
      } finally {
        ydoc.destroy();
      }
    }

    const [newComment] = await db
      .insert(comments)
      .values({
        postId: id,
        authorId: user.userId,
        parentId: data.parentId,
        content: data.content,
        yjsAnchorStart,
        yjsAnchorEnd,
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

    if (parentComment && parentComment.authorId !== user.userId && notificationService) {
      await notificationService.create({
        userId: parentComment.authorId,
        type: 'comment_reply',
        title: 'New reply to your comment',
        body: data.content,
        entityType: 'comment',
        entityId: newComment.id,
        href: `/posts/${id}`,
      });
    } else if (!data.parentId && post.authorId !== user.userId && notificationService) {
      await notificationService.create({
        userId: post.authorId,
        type: 'comment_created',
        title: 'New comment on your post',
        body: data.content,
        entityType: 'comment',
        entityId: newComment.id,
        href: `/posts/${id}`,
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
      { ...post, postId: post.id }
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
