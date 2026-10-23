import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, and, desc, or } from 'drizzle-orm';
import * as Y from 'yjs';
import type { Database } from '../db/index.js';
import { posts, postViewCounts } from '../db/schema.js';
import type { PermissionService } from '../services/permissions.js';
import type { AuditService } from '../services/audit.js';

const CreatePostSchema = z.object({
  title: z.string().min(1).max(500),
  slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/),
  excerpt: z.string().optional(),
  coeId: z.string().uuid().optional(),
});

const UpdatePostSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/).optional(),
  excerpt: z.string().optional(),
  coeId: z.string().uuid().nullable().optional(),
});

export const postRoutes: FastifyPluginAsync<{
  db: Database;
  permissionService: PermissionService;
  auditService: AuditService;
}> = async (fastify, options) => {
  const { db, permissionService, auditService } = options;

  // 1. List Posts with visibility rules
  fastify.get('/', async (request, reply) => {
    const user = request.user;

    // If user is admin or moderator: can see all posts (or drafts if querying)
    // If regular author: can see published posts + their own drafts
    // If reader or unauthenticated: can ONLY see published posts
    let queryResult;

    if (!user || user.role === 'reader') {
      queryResult = await db
        .select()
        .from(posts)
        .where(eq(posts.status, 'published'))
        .orderBy(desc(posts.publishedAt), desc(posts.createdAt));
    } else if (user.role === 'admin' || user.role === 'moderator') {
      queryResult = await db
        .select()
        .from(posts)
        .orderBy(desc(posts.createdAt));
    } else {
      queryResult = await db
        .select()
        .from(posts)
        .where(
          or(
            eq(posts.status, 'published'),
            eq(posts.authorId, user.userId)
          )
        )
        .orderBy(desc(posts.createdAt));
    }

    return reply.send({ posts: queryResult });
  });

  // 2. Get Post by ID
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const [post] = await db
      .select()
      .from(posts)
      .where(eq(posts.id, id))
      .limit(1);

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
      return reply.status(403).send({ error: 'Forbidden', message: 'You do not have access to view this post' });
    }

    return reply.send({ post, userPermission: permission });
  });

  // 3. Create Post (Requires Author, Moderator, or Admin)
  fastify.post('/', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const user = request.user!;
    if (user.role === 'reader') {
      return reply.status(403).send({ error: 'Forbidden', message: 'Reader role cannot create posts' });
    }

    const parseResult = CreatePostSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }

    const { title, slug, excerpt, coeId } = parseResult.data;

    // Check slug collision
    const [existing] = await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, slug)).limit(1);
    if (existing) {
      return reply.status(409).send({ error: 'Conflict', message: 'A post with this slug already exists' });
    }

    // Initialize canonical Yjs binary document state
    const ydoc = new Y.Doc();
    const yjsState = Buffer.from(Y.encodeStateAsUpdate(ydoc));

    const [newPost] = await db
      .insert(posts)
      .values({
        title,
        slug,
        excerpt,
        coeId,
        authorId: user.userId,
        status: 'draft',
        yjsState,
      })
      .returning();

    // Initialize post view count
    await db.insert(postViewCounts).values({
      postId: newPost.id,
      totalViews: 0n,
    });

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'post_created',
      entityType: 'post',
      entityId: newPost.id,
      metadata: { title, slug },
      ipAddress: request.ip,
    });

    return reply.status(201).send({ post: newPost });
  });

  // 4. Update Post Metadata
  fastify.patch('/:id', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) {
      return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });
    }

    const permission = await permissionService.resolvePostPermission(
      { id: user.userId, role: user.role },
      { postId: post.id, authorId: post.authorId, status: post.status }
    );

    if (!permissionService.canEdit(permission)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'You do not have permission to edit this post' });
    }

    const parseResult = UpdatePostSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }

    const updates = parseResult.data;
    const [updatedPost] = await db
      .update(posts)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id))
      .returning();

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'post_metadata_updated',
      entityType: 'post',
      entityId: id,
      metadata: updates,
      ipAddress: request.ip,
    });

    return reply.send({ post: updatedPost });
  });

  // 5. Submit Post for Review
  fastify.post('/:id/submit-review', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) {
      return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });
    }

    const permission = await permissionService.resolvePostPermission(
      { id: user.userId, role: user.role },
      { postId: post.id, authorId: post.authorId, status: post.status }
    );

    if (!permissionService.canEdit(permission)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'You do not have permission to submit this post for review' });
    }

    const [updatedPost] = await db
      .update(posts)
      .set({
        status: 'in_review',
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id))
      .returning();

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'post_submitted_for_review',
      entityType: 'post',
      entityId: id,
      ipAddress: request.ip,
    });

    return reply.send({ post: updatedPost });
  });

  // 6. Publish Post (Requires Admin or Non-Author Moderator)
  fastify.post('/:id/publish', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) {
      return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });
    }

    const isAuthor = post.authorId === user.userId;
    const permission = await permissionService.resolvePostPermission(
      { id: user.userId, role: user.role },
      { postId: post.id, authorId: post.authorId, status: post.status }
    );

    if (!permissionService.canPublish(user.role, permission, isAuthor)) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: isAuthor
          ? 'Author cannot self-publish without independent moderator or admin approval'
          : 'Insufficient permissions to publish this post',
      });
    }

    const [publishedPost] = await db
      .update(posts)
      .set({
        status: 'published',
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id))
      .returning();

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'post_published',
      entityType: 'post',
      entityId: id,
      ipAddress: request.ip,
    });

    return reply.send({ post: publishedPost });
  });
};
