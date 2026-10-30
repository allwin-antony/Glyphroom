import type { OutboxService } from '../plugins/outbox.js';
import type { FastifyPluginAsync } from 'fastify';
import fs from 'fs';
import { z } from 'zod';
import { eq, and, desc, asc, or, ne, inArray, ilike, isNull, sql } from 'drizzle-orm';
import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { exportDerivedMarkdown, TagSchema } from '@enterprise-blogger/shared';
import type { Database } from '../db/index.js';
import { posts, postViewCounts, postVersions, postReviews, users, centersOfExcellence, postAttachments, spaces, spaceMembers, postCollaborators, tags, postTags } from '../db/schema.js';
import type { PermissionService } from '../services/permissions.js';
import type { AuditService } from '../services/audit.js';
import type { BufferedViewCounter } from '../services/view-counter.js';
import type { NotificationService } from '../services/notifications.js';

const PostTagsSchema = z.array(TagSchema).max(20, 'Cannot exceed 20 tags').optional();

function normalizeTagNames(tagNames: string[]): string[] {
  return [...new Set(tagNames.map((name) => name.trim().toLowerCase()).filter(Boolean))];
}

async function loadTagsForPosts(db: Database, postIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (postIds.length === 0) return result;

  const rows = await db
    .select({ postId: postTags.postId, name: tags.name })
    .from(postTags)
    .innerJoin(tags, eq(postTags.tagId, tags.id))
    .where(inArray(postTags.postId, postIds));

  for (const row of rows) {
    const postTagNames = result.get(row.postId) || [];
    postTagNames.push(row.name);
    result.set(row.postId, postTagNames);
  }
  return result;
}

async function replacePostTags(db: Pick<Database, 'select' | 'insert' | 'delete'>, postId: string, tagNames: string[]): Promise<string[]> {
  const normalizedNames = normalizeTagNames(tagNames);
  await db.delete(postTags).where(eq(postTags.postId, postId));

  for (const name of normalizedNames) {
    await db
      .insert(tags)
      .values({ name, slug: name })
      .onConflictDoNothing({ target: tags.slug });

    const [tag] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, name)).limit(1);
    if (tag) {
      await db.insert(postTags).values({ postId, tagId: tag.id }).onConflictDoNothing();
    }
  }

  return normalizedNames;
}

const CreatePostSchema = z.object({
  title: z.string().min(1).max(500),
  slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/),
  excerpt: z.string().optional(),
  content: z.string().min(1).max(1_000_000).optional(),
  tags: PostTagsSchema,
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
  tags: PostTagsSchema,
});

/** Query contract for the catalog endpoint. Defaults keep existing clients compatible. */
export const CatalogQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  coe: z.string().trim().min(1).max(255).optional(),
  coeId: z.string().uuid().optional(),
  status: z.enum(['draft', 'in_review', 'approved', 'published', 'archived']).optional(),
  sort: z.enum(['newest', 'oldest', 'title']).default('newest'),
});

export type CatalogQuery = z.infer<typeof CatalogQuerySchema>;

export interface CatalogPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
}

function escapeSearchTerm(value: string): string {
  // Keep search a substring match while preventing user supplied LIKE wildcards.
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export const postRoutes: FastifyPluginAsync<{
  db: Database;
  permissionService: PermissionService;
  auditService: AuditService;
  viewCounter?: BufferedViewCounter;
  notificationService: NotificationService;
  outboxService?: OutboxService;
}> = async (fastify, options) => {
  const { db, permissionService, auditService, viewCounter, notificationService, outboxService } = options;

  // 1. List & Search Posts with strict visibility rules
  fastify.get('/', async (request, reply) => {
    const user = request.user;
    const parsedQuery = CatalogQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid catalog query parameters',
        details: parsedQuery.error.flatten().fieldErrors,
      });
    }
    const query = parsedQuery.data;

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

    let visibilityCondition;
    let collabMap = new Map<string, 'edit' | 'review' | 'view'>();

    if (!user) {
      // Unauthenticated public requests see ONLY published posts in company library or standalone.
      visibilityCondition = and(
        eq(posts.status, 'published'),
        or(eq(posts.isPromoted, true), isNull(posts.spaceId))
      );
    } else if (user.role === 'admin') {
      // Global Admins see all posts across all spaces.
      visibilityCondition = undefined;
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

      collabMap = new Map(directCollabs.map((c) => [c.postId, c.permission]));

      // Apply the same access rules in SQL so pagination never fetches an entire catalog:
      // author, direct guest, promoted publication, standalone publication, or an allowed space.
      const accessConditions = [
        eq(posts.authorId, user.userId),
        ...(directCollabs.length ? [inArray(posts.id, directCollabs.map((c) => c.postId))] : []),
        and(eq(posts.isPromoted, true), eq(posts.status, 'published')),
        and(isNull(posts.spaceId), eq(posts.status, 'published')),
      ];
      if (joinedSpaceIds.length) {
        accessConditions.push(
          and(
            inArray(posts.spaceId, joinedSpaceIds),
            or(
              eq(posts.visibility, 'space'),
              ...(maintainerSpaceIds.length ? [inArray(posts.spaceId, maintainerSpaceIds)] : [])
            )
          )
        );
      }
      visibilityCondition = or(...accessConditions);
    }

    const filters = [];
    if (visibilityCondition) filters.push(visibilityCondition);
    if (query.status) filters.push(eq(posts.status, query.status));
    if (query.coeId) filters.push(eq(posts.coeId, query.coeId));
    if (query.coe) filters.push(eq(centersOfExcellence.name, query.coe));
    if (query.search) {
      const pattern = `%${escapeSearchTerm(query.search)}%`;
      filters.push(or(
        ilike(posts.title, pattern),
        ilike(posts.excerpt, pattern),
        ilike(posts.workingMarkdown, pattern),
        ilike(posts.publishedMarkdown, pattern),
        ilike(users.fullName, pattern),
        ilike(centersOfExcellence.name, pattern)
      ));
    }

    const where = filters.length ? and(...filters) : undefined;
    const fromQuery = db
      .select(baseSelection)
      .from(posts)
      .leftJoin(users, eq(posts.authorId, users.id))
      .leftJoin(centersOfExcellence, eq(posts.coeId, centersOfExcellence.id))
      .leftJoin(spaces, eq(posts.spaceId, spaces.id));

    const countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(posts)
      .leftJoin(users, eq(posts.authorId, users.id))
      .leftJoin(centersOfExcellence, eq(posts.coeId, centersOfExcellence.id))
      .leftJoin(spaces, eq(posts.spaceId, spaces.id));

    const catalogDate = sql`coalesce(${posts.publishedAt}, ${posts.createdAt})`;
    const orderBy = query.sort === 'title'
      ? [asc(posts.title), asc(posts.id)]
      : query.sort === 'oldest'
        ? [asc(catalogDate), asc(posts.id)]
        : [desc(catalogDate), desc(posts.id)];
    const offset = (query.page - 1) * query.limit;
    const [queryResult, countRows] = await Promise.all([
      (where ? fromQuery.where(where) : fromQuery).orderBy(...orderBy).limit(query.limit).offset(offset),
      (where ? countQuery.where(where) : countQuery),
    ]);
    const total = Number(countRows[0]?.count ?? 0);
    const totalPages = total === 0 ? 0 : Math.ceil(total / query.limit);
    const tagsByPost = await loadTagsForPosts(db, queryResult.map((post) => post.id));

    return reply.send({
      posts: queryResult.map((post) => ({
        ...post,
        tags: tagsByPost.get(post.id) || [],
        ...(user && user.role !== 'admin'
          ? { isCollaborator: collabMap.has(post.id), collaboratorPermission: collabMap.get(post.id) || null }
          : {}),
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
        hasNextPage: query.page < totalPages,
      } satisfies CatalogPagination,
    });
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

  // 1.6 Load tags for a post. The post read response also includes this field,
  // but this endpoint is useful to settings clients that only need taxonomy data.
  fastify.get('/:id/tags', async (request, reply) => {
    const { id } = request.params as { id: string };
    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) {
      return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });
    }

    const permission = request.user
      ? await permissionService.resolvePostPermission(
          { id: request.user.userId, role: request.user.role },
          { postId: post.id, authorId: post.authorId, status: post.status, spaceId: post.spaceId, visibility: post.visibility, isPromoted: post.isPromoted }
        )
      : (post.status === 'published' && (post.isPromoted || !post.spaceId)) ? 'view' : 'none';

    if (!permissionService.canView(permission)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'You do not have access to view this post' });
    }

    const tagsByPost = await loadTagsForPosts(db, [id]);
    return reply.send({ tags: tagsByPost.get(id) || [] });
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

    const tagsByPost = await loadTagsForPosts(db, [post.id]);

    // Increment detached in-memory view counter (Task 4.5)
    viewCounter?.increment(post.id);

    // Derive markdown for reader view:
    // If published, use immutable published snapshot.
    // If draft, derive directly from live yjsState so readers/previewers see exact working state.
    let derivedMarkdown = post.publishedMarkdown || '';
    if (!derivedMarkdown && post.yjsState && post.yjsState.length > 0) {
      try {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, new Uint8Array(post.yjsState));
        const pmJson = yDocToProsemirrorJSON(doc, 'prosemirror');
        derivedMarkdown = exportDerivedMarkdown(pmJson as any);
      } catch {
        derivedMarkdown = post.workingMarkdown || `# ${post.title}\n\n${post.excerpt || ''}`;
      }
    }
    if (!derivedMarkdown) {
      derivedMarkdown = post.workingMarkdown || `# ${post.title}\n\n${post.excerpt || ''}`;
    }

    return reply.send({
      post: {
        ...post,
        tags: tagsByPost.get(post.id) || [],
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

    let markdown = post.publishedMarkdown || '';
    if (!markdown && post.yjsState && post.yjsState.length > 0) {
      try {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, new Uint8Array(post.yjsState));
        const pmJson = yDocToProsemirrorJSON(doc, 'prosemirror');
        markdown = exportDerivedMarkdown(pmJson as any);
      } catch {
        markdown = post.workingMarkdown || `# ${post.title}\n\n${post.excerpt || ''}`;
      }
    }
    if (!markdown) {
      markdown = post.workingMarkdown || `# ${post.title}\n\n${post.excerpt || ''}`;
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

    const { title, slug, excerpt, content, tags: tagNames, coeId, spaceId, visibility, templateId } = parseResult.data;

    // Check slug collision
    const [existing] = await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, slug)).limit(1);
    if (existing) {
      return reply.status(409).send({ error: 'Conflict', message: 'A post with this slug already exists' });
    }

    // Initialize canonical Yjs binary document state
    const ydoc = new Y.Doc();
    if (content !== undefined) {
      // Preserve the complete Markdown input in the canonical draft. Full rich-node
      // Markdown import is a separate follow-up; never discard supplied body text.
      const fragment = ydoc.getXmlFragment('prosemirror');
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.insert(0, [new Y.XmlText(content)]);
      fragment.insert(0, [paragraph]);
    } else if (templateId && templateId !== 'blank') {
      populateYjsTemplate(ydoc, templateId, title);
    }
    const yjsState = Buffer.from(Y.encodeStateAsUpdate(ydoc));
    const workingMarkdown = exportDerivedMarkdown(yDocToProsemirrorJSON(ydoc, 'prosemirror') as any);
    ydoc.destroy();

    const { newPost, savedTags } = await db.transaction(async (tx) => {
      const [newPost] = await tx
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
          workingMarkdown,
        })
        .returning();

      const savedTags = await replacePostTags(tx, newPost.id, tagNames || []);

      await tx.insert(postViewCounts).values({ postId: newPost.id, totalViews: 0n });
      return { newPost, savedTags };
    });

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: request.isPatAuth ? 'agent' : 'human',
      patId: request.patId,
      action: 'post_created',
      entityType: 'post',
      entityId: newPost.id,
      metadata: { title, slug, ...(request.isPatAuth ? { tokenId: request.patId } : {}) },
      ipAddress: request.ip,
    });

    if (outboxService) {
      await outboxService.enqueue(db, 'post:created', {
        postId: newPost.id,
        authorId: user.userId,
        spaceId: newPost.spaceId,
        title: newPost.title,
      });
    }

    return reply.status(201).send({ post: { ...newPost, tags: savedTags } });
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

    const { tags: tagNames, ...updates } = parseResult.data;
    const [updatedPost] = await db
      .update(posts)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, id))
      .returning();

    const savedTags = tagNames === undefined
      ? (await loadTagsForPosts(db, [id])).get(id) || []
      : await replacePostTags(db, id, tagNames);

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'post_metadata_updated',
      entityType: 'post',
      entityId: id,
      metadata: updates,
      ipAddress: request.ip,
    });

    return reply.send({ post: { ...updatedPost, tags: savedTags } });
  });

  // Replace all tags for a post without requiring the caller to send metadata.
  fastify.put('/:id/tags', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
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

    const body = z.object({ tags: PostTagsSchema.default([]) }).safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Validation failed', details: body.error.format() });
    }

    const savedTags = await replacePostTags(db, id, body.data.tags || []);
    await db.update(posts).set({ updatedAt: new Date() }).where(eq(posts.id, id));
    return reply.send({ tags: savedTags });
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

    if (post.status !== 'draft') {
      return reply.status(409).send({
        error: 'Invalid transition',
        message: `A post can only be submitted from draft (current status: ${post.status})`,
      });
    }

    // Pin exactly what was submitted. Reviewers and publication must never read
    // mutable working content after this point.
    let submittedMarkdown = post.workingMarkdown || '';
    if (!submittedMarkdown) {
      try {
        const doc = new Y.Doc();
        if (post.yjsState && post.yjsState.length > 0) {
          Y.applyUpdate(doc, new Uint8Array(post.yjsState));
          const pmJson = yDocToProsemirrorJSON(doc, 'prosemirror');
          submittedMarkdown = exportDerivedMarkdown(pmJson as any);
        }
      } catch {
        submittedMarkdown = `# ${post.title}\n\n${post.excerpt || ''}`;
      }
    }

    const [latestVersion] = await db
      .select({ versionNumber: postVersions.versionNumber })
      .from(postVersions)
      .where(eq(postVersions.postId, id))
      .orderBy(desc(postVersions.versionNumber))
      .limit(1);

    const [submittedVersion] = await db
      .insert(postVersions)
      .values({
        postId: id,
        versionNumber: (latestVersion?.versionNumber || 0) + 1,
        triggerReason: 'review_submission',
        yjsStateSnapshot: post.yjsState,
        markdownSnapshot: submittedMarkdown,
        createdBy: user.userId,
      })
      .returning();

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

    await notificationService.notifyAdminsAndModerators({
      type: 'review_submitted',
      title: 'Post submitted for review',
      body: `${post.title} was submitted for editorial review.`,
      entityType: 'post',
      entityId: id,
      href: `/posts/${id}`,
    }, user.userId);

    if (outboxService) {
      await outboxService.enqueue(db, 'post:submitted_for_review', {
        postId: id,
        authorId: post.authorId,
        versionId: submittedVersion.id,
      });
    }

    return reply.send({ post: updatedPost, submittedVersion });
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

    if (post.status !== 'approved') {
      return reply.status(409).send({
        error: 'Invalid transition',
        message: `A post can only be published after approval (current status: ${post.status})`,
      });
    }

    const [approvedReview] = await db
      .select({ submittedVersionId: postReviews.submittedVersionId })
      .from(postReviews)
      .where(and(eq(postReviews.postId, id), eq(postReviews.decision, 'approved')))
      .orderBy(desc(postReviews.createdAt))
      .limit(1);

    if (!approvedReview?.submittedVersionId) {
      return reply.status(409).send({
        error: 'Invalid transition',
        message: 'No approved submitted version is available for publication',
      });
    }

    const [submittedVersion] = await db
      .select()
      .from(postVersions)
      .where(and(eq(postVersions.id, approvedReview.submittedVersionId), eq(postVersions.postId, id)))
      .limit(1);

    if (!submittedVersion) {
      return reply.status(409).send({
        error: 'Invalid transition',
        message: 'The approved submitted version could not be found',
      });
    }

    // Publish the immutable review checkpoint, never the mutable working copy.
    const publishedMarkdown = submittedVersion.markdownSnapshot;

    const [publishedPost] = await db
      .update(posts)
      .set({
        status: 'published',
        // The reader-facing pointer is the exact immutable checkpoint that
        // was reviewed, rather than a new snapshot of mutable working state.
        publishedVersionId: submittedVersion.id,
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
      metadata: { versionNumber: submittedVersion.versionNumber, versionId: submittedVersion.id },
      ipAddress: request.ip,
    });

    await notificationService.create({
      userId: post.authorId,
      type: 'published',
      title: 'Post published',
      body: `${post.title} is now published.`,
      entityType: 'post',
      entityId: id,
      href: `/posts/${id}`,
    });

    if (outboxService) {
      await outboxService.enqueue(db, 'post:published', {
        postId: id,
        publishedVersionId: submittedVersion.id,
        authorId: post.authorId,
        spaceId: post.spaceId,
        title: post.title,
      });
    }

    return reply.send({ post: publishedPost, version: submittedVersion });
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
      yjsState: targetVersion.yjsStateSnapshot,
      markdownSnapshot: targetVersion.markdownSnapshot,
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

    if (post.status !== 'published') {
      return reply.status(409).send({
        error: 'Invalid transition',
        message: `A post can only be republished from published (current status: ${post.status})`,
      });
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

    await notificationService.create({
      userId: post.authorId,
      type: 'published',
      title: 'Post republished',
      body: `${post.title} was republished.`,
      entityType: 'post',
      entityId: id,
      href: `/posts/${id}`,
    });

    return reply.send({
      post: republishedPost,
      version: newVersion,
      changeSummary: changeSummary.trim(),
    });
  });
};
