import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, and, desc, or } from 'drizzle-orm';
import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { exportDerivedMarkdown } from '@enterprise-blogger/shared';
import type { Database } from '../db/index.js';
import { posts, postViewCounts, postVersions, users, centersOfExcellence } from '../db/schema.js';
import type { PermissionService } from '../services/permissions.js';
import type { AuditService } from '../services/audit.js';
import type { BufferedViewCounter } from '../services/view-counter.js';

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
  viewCounter?: BufferedViewCounter;
}> = async (fastify, options) => {
  const { db, permissionService, auditService, viewCounter } = options;

  // 1. List & Search Posts with strict visibility rules
  fastify.get('/', async (request, reply) => {
    const user = request.user;
    const { search } = request.query as { search?: string };

    const baseSelection = {
      id: posts.id,
      slug: posts.slug,
      title: posts.title,
      excerpt: posts.excerpt,
      status: posts.status,
      authorId: posts.authorId,
      authorName: users.fullName,
      authorEmail: users.email,
      coeId: posts.coeId,
      coeName: centersOfExcellence.name,
      publishedMarkdown: posts.publishedMarkdown,
      workingMarkdown: posts.workingMarkdown,
      publishedAt: posts.publishedAt,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
    };

    let queryResult;

    if (!user || user.role === 'reader') {
      // Readers and public see ONLY published posts
      queryResult = await db
        .select(baseSelection)
        .from(posts)
        .leftJoin(users, eq(posts.authorId, users.id))
        .leftJoin(centersOfExcellence, eq(posts.coeId, centersOfExcellence.id))
        .where(eq(posts.status, 'published'))
        .orderBy(desc(posts.publishedAt), desc(posts.createdAt));
    } else if (user.role === 'admin' || user.role === 'moderator') {
      // Admin/Moderators see all posts
      queryResult = await db
        .select(baseSelection)
        .from(posts)
        .leftJoin(users, eq(posts.authorId, users.id))
        .leftJoin(centersOfExcellence, eq(posts.coeId, centersOfExcellence.id))
        .orderBy(desc(posts.createdAt));
    } else {
      // Authors see published posts + their own drafts
      queryResult = await db
        .select(baseSelection)
        .from(posts)
        .leftJoin(users, eq(posts.authorId, users.id))
        .leftJoin(centersOfExcellence, eq(posts.coeId, centersOfExcellence.id))
        .where(
          or(
            eq(posts.status, 'published'),
            eq(posts.authorId, user.userId)
          )
        )
        .orderBy(desc(posts.createdAt));
    }

    // Apply search filter if query string provided
    if (search && search.trim().length > 0) {
      const q = search.trim().toLowerCase();
      queryResult = queryResult.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          (p.excerpt && p.excerpt.toLowerCase().includes(q)) ||
          (p.workingMarkdown && p.workingMarkdown.toLowerCase().includes(q)) ||
          (p.publishedMarkdown && p.publishedMarkdown.toLowerCase().includes(q)) ||
          (p.authorName && p.authorName.toLowerCase().includes(q)) ||
          (p.coeName && p.coeName.toLowerCase().includes(q))
      );
    }

    return reply.send({ posts: queryResult });
  });

  // 2. Get Post by ID or Slug
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    const [post] = await db
      .select({
        id: posts.id,
        slug: posts.slug,
        title: posts.title,
        excerpt: posts.excerpt,
        status: posts.status,
        authorId: posts.authorId,
        authorName: users.fullName,
        authorEmail: users.email,
        coeId: posts.coeId,
        coeName: centersOfExcellence.name,
        yjsState: posts.yjsState,
        publishedMarkdown: posts.publishedMarkdown,
        workingMarkdown: posts.workingMarkdown,
        publishedAt: posts.publishedAt,
        createdAt: posts.createdAt,
        updatedAt: posts.updatedAt,
      })
      .from(posts)
      .leftJoin(users, eq(posts.authorId, users.id))
      .leftJoin(centersOfExcellence, eq(posts.coeId, centersOfExcellence.id))
      .where(isUuid ? eq(posts.id, id) : eq(posts.slug, id))
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

    // Increment detached in-memory view counter (Task 4.5)
    viewCounter?.increment(post.id);

    // Derive markdown if not already pre-rendered
    let derivedMarkdown = post.publishedMarkdown || post.workingMarkdown || '';
    if (!derivedMarkdown && post.yjsState && post.yjsState.length > 0) {
      try {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, new Uint8Array(post.yjsState));
        const pmJson = yDocToProsemirrorJSON(doc, 'prosemirror');
        derivedMarkdown = exportDerivedMarkdown(pmJson as any);
      } catch {
        derivedMarkdown = `# ${post.title}\n\n${post.excerpt || ''}`;
      }
    }

    return reply.send({
      post: {
        ...post,
        derivedMarkdown,
      },
      userPermission: permission,
    });
  });

  // 2b. Export Derived Markdown
  fastify.get('/:id/export-markdown', async (request, reply) => {
    const { id } = request.params as { id: string };
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    const [post] = await db
      .select()
      .from(posts)
      .where(isUuid ? eq(posts.id, id) : eq(posts.slug, id))
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
      return reply.status(403).send({ error: 'Forbidden', message: 'You do not have access to export this post' });
    }

    let markdown = post.publishedMarkdown || post.workingMarkdown || '';
    if (!markdown && post.yjsState && post.yjsState.length > 0) {
      try {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, new Uint8Array(post.yjsState));
        const pmJson = yDocToProsemirrorJSON(doc, 'prosemirror');
        markdown = exportDerivedMarkdown(pmJson as any);
      } catch {
        markdown = `# ${post.title}\n\n${post.excerpt || ''}`;
      }
    }

    reply.header('Content-Type', 'text/markdown; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${post.slug}.md"`);
    return reply.send(markdown);
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

  // 6. Publish Post with Discrete Milestone Snapshot (Task 4.3)
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

    // Derive markdown snapshot from canonical Yjs binary state
    let publishedMarkdown = '';
    try {
      const doc = new Y.Doc();
      if (post.yjsState && post.yjsState.length > 0) {
        Y.applyUpdate(doc, new Uint8Array(post.yjsState));
        const pmJson = yDocToProsemirrorJSON(doc, 'prosemirror');
        publishedMarkdown = exportDerivedMarkdown(pmJson as any);
      }
    } catch {
      publishedMarkdown = `# ${post.title}\n\nPublished content.`;
    }

    // Monotonically increment version number
    const [latestVersion] = await db
      .select({ versionNumber: postVersions.versionNumber })
      .from(postVersions)
      .where(eq(postVersions.postId, id))
      .orderBy(desc(postVersions.versionNumber))
      .limit(1);

    const nextVersionNumber = (latestVersion?.versionNumber || 0) + 1;

    // Create immutable post_versions row
    const [version] = await db
      .insert(postVersions)
      .values({
        postId: id,
        versionNumber: nextVersionNumber,
        triggerReason: 'publication',
        yjsStateSnapshot: post.yjsState,
        markdownSnapshot: publishedMarkdown,
        createdBy: user.userId,
      })
      .returning();

    const [publishedPost] = await db
      .update(posts)
      .set({
        status: 'published',
        publishedVersionId: version.id,
        publishedMarkdown,
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
      metadata: { versionNumber: nextVersionNumber, versionId: version.id },
      ipAddress: request.ip,
    });

    return reply.send({ post: publishedPost, version });
  });

  // 7. Get Post Versions (Milestone M2 Feature 19)
  fastify.get('/:id/versions', async (request, reply) => {
    const { id } = request.params as { id: string };

    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) {
      return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });
    }

    const versions = await db
      .select({
        id: postVersions.id,
        postId: postVersions.postId,
        versionNumber: postVersions.versionNumber,
        triggerReason: postVersions.triggerReason,
        createdAt: postVersions.createdAt,
        createdBy: postVersions.createdBy,
        authorName: users.fullName,
      })
      .from(postVersions)
      .leftJoin(users, eq(postVersions.createdBy, users.id))
      .where(eq(postVersions.postId, id))
      .orderBy(desc(postVersions.versionNumber));

    return reply.send({ versions });
  });
};
