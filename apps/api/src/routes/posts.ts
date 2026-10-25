import type { FastifyPluginAsync } from 'fastify';
import fs from 'fs';
import { z } from 'zod';
import { eq, and, desc, or, ne } from 'drizzle-orm';
import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { exportDerivedMarkdown } from '@enterprise-blogger/shared';
import type { Database } from '../db/index.js';
import { posts, postViewCounts, postVersions, users, centersOfExcellence, postAttachments, spaces, spaceMembers, postCollaborators } from '../db/schema.js';
import type { PermissionService } from '../services/permissions.js';
import type { AuditService } from '../services/audit.js';
import type { BufferedViewCounter } from '../services/view-counter.js';

const CreatePostSchema = z.object({
  title: z.string().min(1).max(500),
  slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/),
  excerpt: z.string().optional(),
  coeId: z.string().uuid().optional(),
  spaceId: z.string().uuid().optional(),
  visibility: z.enum(['space', 'invited_only']).optional(),
  templateId: z.enum([
    'blank',
    'weekly_status',
    'architecture_rfc',
    'incident_postmortem',
    'runbook',
    'test_plan',
  ]).optional(),
});

const UpdatePostSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/).optional(),
  excerpt: z.string().optional(),
  coeId: z.string().uuid().nullable().optional(),
  spaceId: z.string().uuid().nullable().optional(),
  visibility: z.enum(['space', 'invited_only']).optional(),
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
      spaceId: posts.spaceId,
      spaceName: spaces.name,
      visibility: posts.visibility,
      isPromoted: posts.isPromoted,
      promotedAt: posts.promotedAt,
      publishedMarkdown: posts.publishedMarkdown,
      workingMarkdown: posts.workingMarkdown,
      publishedAt: posts.publishedAt,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
    };

    let queryResult;

    if (!user) {
      // Unauthenticated public requests see ONLY published posts in company library or standalone
      queryResult = await db
        .select(baseSelection)
        .from(posts)
        .leftJoin(users, eq(posts.authorId, users.id))
        .leftJoin(centersOfExcellence, eq(posts.coeId, centersOfExcellence.id))
        .leftJoin(spaces, eq(posts.spaceId, spaces.id))
        .where(
          and(
            eq(posts.status, 'published'),
            or(eq(posts.isPromoted, true), eq(posts.spaceId, null as any))
          )
        )
        .orderBy(desc(posts.publishedAt), desc(posts.createdAt));
    } else if (user.role === 'admin') {
      // Global Admins see all posts across all spaces
      queryResult = await db
        .select(baseSelection)
        .from(posts)
        .leftJoin(users, eq(posts.authorId, users.id))
        .leftJoin(centersOfExcellence, eq(posts.coeId, centersOfExcellence.id))
        .leftJoin(spaces, eq(posts.spaceId, spaces.id))
        .orderBy(desc(posts.createdAt));
    } else {
      // Fetch spaces user is a member of
      const userSpaces = await db
        .select({ spaceId: spaceMembers.spaceId, role: spaceMembers.role })
        .from(spaceMembers)
        .where(eq(spaceMembers.userId, user.userId));

      const joinedSpaceIds = userSpaces.map((s) => s.spaceId);
      const maintainerSpaceIds = userSpaces
        .filter((s) => s.role === 'maintainer' || s.role === 'owner')
        .map((s) => s.spaceId);

      // Fetch direct post invitations (Page Guests / Collaborators)
      const directCollabs = await db
        .select({
          postId: postCollaborators.postId,
          permission: postCollaborators.permission,
        })
        .from(postCollaborators)
        .where(eq(postCollaborators.userId, user.userId));

      const collabMap = new Map(directCollabs.map((c) => [c.postId, c.permission]));

      const allRows = await db
        .select(baseSelection)
        .from(posts)
        .leftJoin(users, eq(posts.authorId, users.id))
        .leftJoin(centersOfExcellence, eq(posts.coeId, centersOfExcellence.id))
        .leftJoin(spaces, eq(posts.spaceId, spaces.id))
        .orderBy(desc(posts.createdAt));

      // Filter rows based on access rules:
      // 1. Author's own posts
      // 2. Direct page guest / collaborator invitation
      // 3. Promoted and published (Company Library)
      // 4. User is member of post's space:
      //    - If post is 'space' visibility -> can see
      //    - If post is 'invited_only' -> only maintainers/owners of that space can see without guest invite
      // 5. Standalone published posts without a space
      queryResult = allRows
        .filter((p) => {
          if (p.authorId === user.userId) return true;
          if (collabMap.has(p.id)) return true;
          if (p.isPromoted && p.status === 'published') return true;
          if (!p.spaceId && p.status === 'published') return true;
          if (p.spaceId && joinedSpaceIds.includes(p.spaceId)) {
            if (p.visibility === 'space') return true;
            if (maintainerSpaceIds.includes(p.spaceId)) return true;
          }
          return false;
        })
        .map((p) => ({
          ...p,
          isCollaborator: collabMap.has(p.id),
          collaboratorPermission: collabMap.get(p.id) || null,
        }));
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

  // 1.5 Get Centers of Excellence (COE)
  fastify.get('/coe', async (_request, reply) => {
    const coes = await db
      .select({
        id: centersOfExcellence.id,
        name: centersOfExcellence.name,
        code: centersOfExcellence.code,
        description: centersOfExcellence.description,
      })
      .from(centersOfExcellence)
      .orderBy(centersOfExcellence.name);

    return reply.send({ coes });
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
        spaceId: posts.spaceId,
        visibility: posts.visibility,
        isPromoted: posts.isPromoted,
        promotedAt: posts.promotedAt,
        promotedBy: posts.promotedBy,
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
          {
            postId: post.id,
            authorId: post.authorId,
            status: post.status,
            spaceId: post.spaceId,
            visibility: post.visibility,
            isPromoted: post.isPromoted,
          }
        )
      : (post.status === 'published' && (post.isPromoted || !post.spaceId))
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
          {
            postId: post.id,
            authorId: post.authorId,
            status: post.status,
            spaceId: post.spaceId,
            visibility: post.visibility,
            isPromoted: post.isPromoted,
          }
        )
      : (post.status === 'published' && (post.isPromoted || !post.spaceId))
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

// Helper: Server-side pure Yjs template generator
function populateYjsTemplate(ydoc: Y.Doc, templateId: string, title: string) {
  const fragment = ydoc.getXmlFragment('prosemirror');

  const createH = (level: number, text: string) => {
    const h = new Y.XmlElement('heading');
    h.setAttribute('level', String(level));
    const pText = new Y.XmlText(text);
    h.insert(0, [pText]);
    return h;
  };

  const createP = (text: string) => {
    const p = new Y.XmlElement('paragraph');
    const pText = new Y.XmlText(text);
    p.insert(0, [pText]);
    return p;
  };

  if (templateId === 'weekly_status') {
    fragment.insert(fragment.length, [createH(1, title || 'Weekly Project Status Pulse')]);

    const statusBlock = new Y.XmlElement('projectStatusBlock');
    statusBlock.setAttribute('ragStatus', 'green');
    statusBlock.setAttribute('milestoneTitle', 'Sprint Milestone Deliverables');
    statusBlock.setAttribute('completionPercent', '65');
    statusBlock.setAttribute('targetDate', '2026-11-30');
    statusBlock.setAttribute('blockers', 'None currently');
    fragment.insert(fragment.length, [statusBlock]);

    fragment.insert(fragment.length, [createH(2, 'Key Milestones Completed This Week')]);
    fragment.insert(fragment.length, [createP('• Completed Sprint 1 database migration and table schemas')]);
    fragment.insert(fragment.length, [createP('• Deployed staging API services with 99.9% uptime')]);

    fragment.insert(fragment.length, [createH(2, 'Deliverables for Next Sprint')]);
    fragment.insert(fragment.length, [createP('• Runbook security verification and peer reviews')]);
    fragment.insert(fragment.length, [createP('• Performance benchmarking under 500 concurrent connections')]);

    fragment.insert(fragment.length, [createH(2, 'Active Blockers & Dependencies')]);
    const alert = new Y.XmlElement('alert');
    alert.setAttribute('type', 'tip');
    alert.insert(0, [createP('Dependency: SecOps review scheduled for Wednesday.')]);
    fragment.insert(fragment.length, [alert]);
  } else if (templateId === 'architecture_rfc') {
    fragment.insert(fragment.length, [createH(1, title || 'Architecture RFC & System Design')]);

    const alert = new Y.XmlElement('alert');
    alert.setAttribute('type', 'note');
    alert.insert(0, [createP('Status: Proposed | Authors: Engineering Architecture Group')]);
    fragment.insert(fragment.length, [alert]);

    fragment.insert(fragment.length, [createH(2, 'Context & Problem Statement')]);
    fragment.insert(fragment.length, [createP('Describe the architectural background, business motivation, and technical constraints.')]);

    fragment.insert(fragment.length, [createH(2, 'Architecture Diagram')]);
    const mermaid = new Y.XmlElement('mermaidBlock');
    mermaid.setAttribute('code', 'graph TD\n  Client[Web Browser] -->|WebSocket| Gateway[Collab Gateway]\n  Gateway --> YjsEngine[Yjs CRDT Engine]\n  YjsEngine --> DB[(PostgreSQL)]');
    fragment.insert(fragment.length, [mermaid]);

    fragment.insert(fragment.length, [createH(2, 'Decision & Technical Rationale')]);
    fragment.insert(fragment.length, [createP('Outline the chosen solution and explain why alternatives were rejected.')]);

    fragment.insert(fragment.length, [createH(2, 'Consequences & Trade-offs')]);
    fragment.insert(fragment.length, [createP('Detail operational impact, security considerations, and latency characteristics.')]);
  } else if (templateId === 'incident_postmortem') {
    fragment.insert(fragment.length, [createH(1, title || 'Incident Retrospective (SEV-1)')]);

    const alert = new Y.XmlElement('alert');
    alert.setAttribute('type', 'caution');
    alert.insert(0, [createP('Incident Date: 2026-10-24 | Duration: 23 mins | Severity: SEV-1')]);
    fragment.insert(fragment.length, [alert]);

    fragment.insert(fragment.length, [createH(2, 'Incident Summary & Customer Impact')]);
    fragment.insert(fragment.length, [createP('Brief overview of the outage and percentage of requests affected.')]);

    fragment.insert(fragment.length, [createH(2, 'Root Cause Analysis (5 Whys)')]);
    fragment.insert(fragment.length, [createP('1. Why did the service fail? Connection pool exhaustion under spike.')]);
    fragment.insert(fragment.length, [createP('2. Why was the pool exhausted? Slow queries blocked background worker threads.')]);

    fragment.insert(fragment.length, [createH(2, 'Preventive Action Items')]);
    fragment.insert(fragment.length, [createP('• Add query timeout threshold (3000ms)')]);
    fragment.insert(fragment.length, [createP('• Scale connection pool limits dynamically')]);
  } else if (templateId === 'runbook') {
    fragment.insert(fragment.length, [createH(1, title || 'Operational Runbook')]);

    const alert = new Y.XmlElement('alert');
    alert.setAttribute('type', 'tip');
    alert.insert(0, [createP('SLA: < 15 minutes | Service: Core API Production')]);
    fragment.insert(fragment.length, [alert]);

    fragment.insert(fragment.length, [createH(2, 'Preconditions & Access Requirements')]);
    fragment.insert(fragment.length, [createP('Ensure you have production read-only or break-glass admin credentials.')]);

    fragment.insert(fragment.length, [createH(2, 'Verification & Health Checks')]);
    fragment.insert(fragment.length, [createP('curl -f http://localhost:4001/health')]);

    fragment.insert(fragment.length, [createH(2, 'Step-by-Step Recovery Procedure')]);
    fragment.insert(fragment.length, [createP('1. Verify active worker pods.')]);
    fragment.insert(fragment.length, [createP('2. Restart stale replica instances.')]);
  } else if (templateId === 'test_plan') {
    fragment.insert(fragment.length, [createH(1, title || 'Test Plan & Acceptance Matrix')]);
    fragment.insert(fragment.length, [createH(2, 'Scope & Environment')]);
    fragment.insert(fragment.length, [createP('Staging environment configuration and test coverage targets.')]);
    fragment.insert(fragment.length, [createH(2, 'Acceptance Test Scenarios')]);
    fragment.insert(fragment.length, [createP('• TC-01: Multi-user concurrent edit convergence')]);
    fragment.insert(fragment.length, [createP('• TC-02: Attachment upload security and magic-byte validation')]);
  }
}

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

    const { title, slug, excerpt, coeId, spaceId, visibility, templateId } = parseResult.data;

    // Check slug collision
    const [existing] = await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, slug)).limit(1);
    if (existing) {
      return reply.status(409).send({ error: 'Conflict', message: 'A post with this slug already exists' });
    }

    // Initialize canonical Yjs binary document state
    const ydoc = new Y.Doc();
    if (templateId && templateId !== 'blank') {
      populateYjsTemplate(ydoc, templateId, title);
    }
    const yjsState = Buffer.from(Y.encodeStateAsUpdate(ydoc));

    const [newPost] = await db
      .insert(posts)
      .values({
        title,
        slug,
        excerpt,
        coeId,
        spaceId: spaceId || null,
        visibility: visibility || 'space',
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

  // 4b. Delete Post
  fastify.delete('/:id', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) {
      return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });
    }

    const isAuthor = user.userId === post.authorId;
    const isAdmin = user.role === 'admin';

    if (!isAuthor && !isAdmin) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Only the author or an administrator can delete this post' });
    }

    // Clean up associated file attachments on disk if any
    try {
      const attachments = await db.select().from(postAttachments).where(eq(postAttachments.postId, id));
      for (const att of attachments) {
        if (att.storagePath && fs.existsSync(att.storagePath)) {
          // Check if any other attachment references the same file (content-hash deduplication)
          const [otherRef] = await db
            .select({ id: postAttachments.id })
            .from(postAttachments)
            .where(and(eq(postAttachments.sha256, att.sha256), ne(postAttachments.postId, id)))
            .limit(1);
          if (!otherRef) {
            await fs.promises.unlink(att.storagePath).catch(() => {});
          }
        }
      }
    } catch (cleanupErr) {
      request.log.warn({ cleanupErr }, 'Attachment disk cleanup encountered an error');
    }

    // Delete post row (cascades to all foreign-key tables in DB)
    await db.delete(posts).where(eq(posts.id, id));

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'post_deleted',
      entityType: 'post',
      entityId: id,
      metadata: { title: post.title, slug: post.slug },
      ipAddress: request.ip,
    });

    return reply.status(200).send({ success: true, message: 'Post deleted successfully' });
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

  // 6.5 Promote Page to Company Library
  fastify.post('/:id/promote', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) {
      return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });
    }

    const canPromote = await permissionService.canPromoteToCompany(
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

    if (!canPromote) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: post.spaceId
          ? 'Authors cannot self-promote team space pages to the Company Library. A Space Maintainer or Owner must promote this page.'
          : 'You do not have permission to promote this document to the Company Library.',
      });
    }

    const [promotedPost] = await db
      .update(posts)
      .set({
        isPromoted: true,
        promotedAt: new Date(),
        promotedBy: user.userId,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id))
      .returning();

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'post_promoted_to_company',
      entityType: 'post',
      entityId: id,
      metadata: { title: post.title, spaceId: post.spaceId },
      ipAddress: request.ip,
    });

    return reply.send({ message: 'Page promoted to Company Library', post: promotedPost });
  });

  // 6.6 Demote / Withdraw Page from Company Library
  fastify.post('/:id/demote', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) {
      return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });
    }

    const canDemote = await permissionService.canPromoteToCompany(
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

    if (!canDemote) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Only Space Maintainers, Owners, or Global Admins can withdraw pages from the Company Library.',
      });
    }

    const [demotedPost] = await db
      .update(posts)
      .set({
        isPromoted: false,
        promotedAt: null,
        promotedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id))
      .returning();

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'post_demoted_from_company',
      entityType: 'post',
      entityId: id,
      metadata: { title: post.title, spaceId: post.spaceId },
      ipAddress: request.ip,
    });

    return reply.send({ message: 'Page withdrawn to team space', post: demotedPost });
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

  // 7.5 Get Single Version Details with snapshot
  fastify.get('/:id/versions/:versionId', async (request, reply) => {
    const { id, versionId } = request.params as { id: string; versionId: string };

    const [version] = await db
      .select({
        id: postVersions.id,
        postId: postVersions.postId,
        versionNumber: postVersions.versionNumber,
        triggerReason: postVersions.triggerReason,
        markdownSnapshot: postVersions.markdownSnapshot,
        createdAt: postVersions.createdAt,
        createdBy: postVersions.createdBy,
        authorName: users.fullName,
      })
      .from(postVersions)
      .leftJoin(users, eq(postVersions.createdBy, users.id))
      .where(and(eq(postVersions.id, versionId), eq(postVersions.postId, id)))
      .limit(1);

    if (!version) {
      return reply.status(404).send({ error: 'Not Found', message: 'Version not found' });
    }

    return reply.send({ version });
  });

  // 7.6 Live Restore Version (Creates safety checkpoint, restores Yjs state, records audit log)
  fastify.post('/:id/versions/:versionId/restore', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const { id, versionId } = request.params as { id: string; versionId: string };
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
      return reply.status(403).send({ error: 'Forbidden', message: 'Insufficient permission to restore version' });
    }

    const [targetVersion] = await db
      .select()
      .from(postVersions)
      .where(and(eq(postVersions.id, versionId), eq(postVersions.postId, id)))
      .limit(1);

    if (!targetVersion) {
      return reply.status(404).send({ error: 'Not Found', message: 'Target version not found' });
    }

    // 1. Create a safety checkpoint version of the current state before rolling back
    const [latestVersion] = await db
      .select({ versionNumber: postVersions.versionNumber })
      .from(postVersions)
      .where(eq(postVersions.postId, id))
      .orderBy(desc(postVersions.versionNumber))
      .limit(1);

    const safetyVersionNumber = (latestVersion?.versionNumber || 0) + 1;
    await db.insert(postVersions).values({
      postId: id,
      versionNumber: safetyVersionNumber,
      triggerReason: 'hourly_checkpoint',
      yjsStateSnapshot: post.yjsState,
      markdownSnapshot: post.workingMarkdown || `# ${post.title}`,
      createdBy: user.userId,
    });

    // 2. Restore historical state
    await db
      .update(posts)
      .set({
        yjsState: targetVersion.yjsStateSnapshot,
        workingMarkdown: targetVersion.markdownSnapshot,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id));

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'post_version_restored',
      entityType: 'post',
      entityId: id,
      metadata: {
        restoredFromVersionId: targetVersion.id,
        restoredVersionNumber: targetVersion.versionNumber,
        safetyVersionNumber,
      },
      ipAddress: request.ip,
    });

    return reply.send({
      success: true,
      restoredVersionNumber: targetVersion.versionNumber,
      message: `Successfully restored version v${targetVersion.versionNumber}`,
    });
  });

  // 7.7 Policy-Driven Republishing (with required change summary)
  fastify.post('/:id/republish', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
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

    if (!permissionService.canEdit(permission)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Insufficient permission to republish' });
    }

    const { changeSummary } = (request.body as any) || {};
    if (!changeSummary || typeof changeSummary !== 'string' || changeSummary.trim().length < 3) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'A meaningful change summary (minimum 3 characters) is required when republishing',
      });
    }

    // Derive markdown from flushed yjsState
    let publishedMarkdown = post.workingMarkdown || '';
    if (!publishedMarkdown) {
      try {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, new Uint8Array(post.yjsState));
        const pmJson = yDocToProsemirrorJSON(doc, 'prosemirror');
        publishedMarkdown = exportDerivedMarkdown(pmJson as any);
      } catch {
        publishedMarkdown = `# ${post.title}\n\n${post.excerpt || ''}`;
      }
    }

    const [latestVersion] = await db
      .select({ versionNumber: postVersions.versionNumber })
      .from(postVersions)
      .where(eq(postVersions.postId, id))
      .orderBy(desc(postVersions.versionNumber))
      .limit(1);

    const nextVersionNumber = (latestVersion?.versionNumber || 0) + 1;

    const [newVersion] = await db
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

    const [republishedPost] = await db
      .update(posts)
      .set({
        status: 'published',
        publishedVersionId: newVersion.id,
        publishedMarkdown,
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id))
      .returning();

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'post_republished',
      entityType: 'post',
      entityId: id,
      metadata: {
        versionNumber: nextVersionNumber,
        versionId: newVersion.id,
        changeSummary: changeSummary.trim(),
      },
      ipAddress: request.ip,
    });

    return reply.send({
      post: republishedPost,
      version: newVersion,
      changeSummary: changeSummary.trim(),
    });
  });
};
