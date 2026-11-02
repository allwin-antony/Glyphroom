import type { OutboxService } from '../plugins/outbox.js';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'fs';
import { z } from 'zod';
import { eq, and, desc, asc, or, ne, inArray, ilike, isNull, isNotNull, sql } from 'drizzle-orm';
import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { exportDerivedMarkdown, TagSchema } from '@glyphroom/shared';
import type { Database } from '../db/index.js';
import { posts, postViewCounts, postVersions, postReviews, users, centersOfExcellence, postAttachments, spaces, spaceMembers, postCollaborators, tags, postTags } from '../db/schema.js';
import { PermissionService, type PostPermission } from '../services/permissions.js';
import type { AuditService } from '../services/audit.js';
import type { BufferedViewCounter } from '../services/view-counter.js';
import type { NotificationService } from '../services/notifications.js';
import { CollabServiceError, deriveDocumentSnapshot, type CollabService } from '../services/collab.js';

const PostTagsSchema = z.array(TagSchema).max(20, 'Cannot exceed 20 tags').optional();

function normalizeTagNames(tagNames: string[]): string[] {
  const seen = new Set<string>();
  const res: string[] = [];
  for (const raw of tagNames) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      res.push(lower);
    }
  }
  return res;
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
    const slug = name.toLowerCase();
    let [tag] = await db
      .select({ id: tags.id })
      .from(tags)
      .where(or(eq(tags.slug, slug), eq(tags.name, name)))
      .limit(1);

    if (!tag) {
      try {
        await db
          .insert(tags)
          .values({ name, slug })
          .onConflictDoNothing();
      } catch {
        // Tag was created concurrently or unique constraint hit
      }
      [tag] = await db
        .select({ id: tags.id })
        .from(tags)
        .where(or(eq(tags.slug, slug), eq(tags.name, name)))
        .limit(1);
    }

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
  status: z.enum(['draft']).optional(),
  tags: PostTagsSchema,
});

const PublicationRequestSchema = z.object({
  submittedVersionId: z.string().uuid().transform((value) => value.toLowerCase()),
  notes: z.string().max(2000).optional(),
});

const RouteUuidSchema = z.string().uuid().transform((value) => value.toLowerCase());

/** Query contract for the catalog endpoint. Defaults keep existing clients compatible. */
const CatalogStatusSchema = z.enum(['draft', 'in_review', 'approved', 'published', 'archived']);

export const CatalogQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).optional(),
  tags: z.union([TagSchema, z.array(TagSchema).max(20, 'Cannot exceed 20 tags')])
    .transform((value) => normalizeTagNames(Array.isArray(value) ? value : [value]))
    .optional(),
  coe: z.string().trim().min(1).max(255).optional(),
  coeId: z.string().uuid().optional(),
  status: z.union([CatalogStatusSchema, z.array(CatalogStatusSchema).min(1)])
    .transform((value) => [...new Set(Array.isArray(value) ? value : [value])])
    .optional(),
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

/** Read projections never flush or persist. A decodable empty document is content. */
function persistedWorkingMarkdown(state: Uint8Array | null, cached: string | null): string | null {
  if (state && state.length > 0) {
    const doc = new Y.Doc();
    try {
      Y.decodeUpdate(state);
      Y.applyUpdate(doc, state);
      if (doc.store.pendingStructs || doc.store.pendingDs) throw new Error('Incomplete document');
      const root = doc.share.has('prosemirror') ? 'prosemirror' : doc.share.has('default') ? 'default' : 'prosemirror';
      return exportDerivedMarkdown(yDocToProsemirrorJSON(doc, root) as any);
    } catch {
      // Only working-body grantees may use the persisted Markdown cache.
    } finally {
      doc.destroy();
    }
  }
  return typeof cached === 'string' ? cached : null;
}

function persistedDocumentJson(state: Uint8Array | null): Record<string, unknown> | null {
  if (state && state.length > 0) {
    const doc = new Y.Doc();
    try {
      Y.decodeUpdate(state);
      Y.applyUpdate(doc, state);
      if (doc.store.pendingStructs || doc.store.pendingDs) throw new Error('Incomplete document');
      const root = doc.share.has('prosemirror') ? 'prosemirror' : doc.share.has('default') ? 'default' : 'prosemirror';
      const json = yDocToProsemirrorJSON(doc, root);
      if (json && typeof json === 'object') return json as Record<string, unknown>;
    } catch {
      // Incomplete or corrupted state
    } finally {
      doc.destroy();
    }
  }
  return null;
}

function markdownToFallbackDocumentJson(markdown: string): Record<string, unknown> {
  const blocks = markdown.replace(/\r\n/g, '\n').split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length === 0) {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }
  const content = blocks.map((block) => {
    const headingMatch = block.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      return {
        type: 'heading',
        attrs: { level: headingMatch[1].length },
        content: headingMatch[2] ? [{ type: 'text', text: headingMatch[2] }] : [],
      };
    }
    return {
      type: 'paragraph',
      content: [{ type: 'text', text: block }],
    };
  });
  return { type: 'doc', content };
}

function validatedCollabSnapshot(
  value: unknown,
  expectedDocumentName: string,
  outcomeUnknown: boolean,
): ReturnType<typeof deriveDocumentSnapshot> {
  const response = value as Record<string, unknown> | null;
  if (!response || response.documentName !== expectedDocumentName || typeof response.inMemory !== 'boolean'
    || !(response.yjsState instanceof Uint8Array) || typeof response.workingMarkdown !== 'string'
    || typeof response.fingerprint !== 'string') {
    throw new CollabServiceError('INVALID_RESPONSE', 'Invalid collaboration document snapshot', outcomeUnknown);
  }
  let snapshot: ReturnType<typeof deriveDocumentSnapshot>;
  try {
    snapshot = deriveDocumentSnapshot(response.yjsState);
  } catch {
    throw new CollabServiceError('INVALID_RESPONSE', 'Invalid collaboration document snapshot', outcomeUnknown);
  }
  if (snapshot.workingMarkdown !== response.workingMarkdown || snapshot.fingerprint !== response.fingerprint) {
    throw new CollabServiceError('INVALID_RESPONSE', 'Incoherent collaboration document snapshot', outcomeUnknown);
  }
  return snapshot;
}

async function resolveCurrentPostAccess(database: Database, userId: string, post: Pick<typeof posts.$inferSelect,
  'id' | 'authorId' | 'status' | 'spaceId' | 'visibility' | 'isPromoted'>) {
  const [account] = await database.select({ id: users.id, role: users.role, isActive: users.isActive })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!account?.isActive) return { account: null, permission: 'none' as const };
  const permission = await new PermissionService(database).resolvePostPermission(account, { ...post, postId: post.id });
  return { account, permission };
}

export async function projectPostContent(db: Database, permissionService: PermissionService, post: Pick<typeof posts.$inferSelect,
  'id' | 'authorId' | 'status' | 'spaceId' | 'visibility' | 'isPromoted' |
  'yjsState' | 'workingMarkdown' | 'publishedMarkdown' | 'submittedVersionId'> & {
    publishedVersionId?: string | null;
  }, user: FastifyRequest['user']) {
  const context = {
    postId: post.id, authorId: post.authorId, status: post.status,
    spaceId: post.spaceId, visibility: post.visibility, isPromoted: post.isPromoted
  };
  let permission: PostPermission = user
    ? await permissionService.resolvePostPermission({ id: user.userId, role: user.role }, context)
    : (post.status === 'published' && (post.isPromoted || !post.spaceId)) ? 'view' : 'none';

  // Retain the permitted prior publication through revisions, including empty
  // publications and the explicitly approved archived/moderator eligibility.
  if (permission === 'none' && typeof post.publishedMarkdown === 'string') {
    if (!user) {
      if (post.isPromoted || !post.spaceId) permission = 'view';
    } else {
      const publishedPermission = await permissionService.resolvePostPermission(
        { id: user.userId, role: user.role }, { ...context, status: 'published' });
      if (permissionService.canView(publishedPermission)) permission = 'view';
    }
  }
  const forbidden = {
    ok: false as const, statusCode: 403 as const,
    error: { error: 'Forbidden', message: 'You do not have access to view this post' }
  };
  if (!permissionService.canView(permission)) return forbidden;

  const canEdit = permissionService.canEdit(permission);
  const activeReview = post.status === 'in_review' || post.status === 'approved';
  const canReadSubmission = canEdit || permissionService.canReview(permission, user?.userId === post.authorId);
  let canReadWorking = canEdit;
  if (user && !canEdit) {
    // Effective `view` conflates publication with private invitations. Keep the
    // provenance, even when a stronger independent review grant also applies.
    const [invitation] = await db.select({ permission: postCollaborators.permission })
      .from(postCollaborators)
      .where(and(eq(postCollaborators.postId, post.id), eq(postCollaborators.userId, user.userId)))
      .limit(1);
    const spaceRole = post.spaceId && post.visibility === 'space'
      ? await permissionService.getSpaceRole(post.spaceId, user.userId) : null;
    canReadWorking = invitation?.permission === 'view' || spaceRole === 'viewer';
  }

  let submittedVersion: Pick<typeof postVersions.$inferSelect,
    'id' | 'versionNumber' | 'triggerReason' | 'markdownSnapshot' | 'createdAt'> | null = null;
  let submittedYjsState: Uint8Array | null = null;
  if (canReadSubmission && activeReview && post.submittedVersionId) {
    const [sv] = await db.select({
      id: postVersions.id, versionNumber: postVersions.versionNumber,
      triggerReason: postVersions.triggerReason, markdownSnapshot: postVersions.markdownSnapshot,
      yjsStateSnapshot: postVersions.yjsStateSnapshot,
      createdAt: postVersions.createdAt,
    }).from(postVersions).where(and(
      eq(postVersions.id, post.submittedVersionId), eq(postVersions.postId, post.id),
      eq(postVersions.triggerReason, 'review_submission'),
    )).limit(1);
    if (sv && typeof sv.markdownSnapshot === 'string') {
      const { yjsStateSnapshot, ...publicVersion } = sv;
      submittedVersion = publicVersion;
      if (yjsStateSnapshot) {
        submittedYjsState = new Uint8Array(yjsStateSnapshot);
      }
    }
  }

  const workingMarkdown = canReadWorking ? persistedWorkingMarkdown(post.yjsState, post.workingMarkdown) : null;
  const publishedMarkdown = typeof post.publishedMarkdown === 'string' ? post.publishedMarkdown : null;
  const contentSource = canReadWorking ? 'working' : submittedVersion ? 'submitted' : 'published';
  const derivedMarkdown = canReadWorking ? workingMarkdown : submittedVersion ? submittedVersion.markdownSnapshot : publishedMarkdown;
  if (derivedMarkdown === null) {
    if (!canReadWorking && canReadSubmission && !activeReview) return forbidden;
    return {
      ok: false as const, statusCode: 409 as const,
      error: { error: 'Conflict', message: 'Post content unavailable' }
    };
  }

  let selectedState: Uint8Array | null = null;
  if (contentSource === 'working') {
    selectedState = post.yjsState ? new Uint8Array(post.yjsState) : null;
  } else if (contentSource === 'submitted') {
    selectedState = submittedYjsState;
  } else if (contentSource === 'published') {
    if (post.publishedVersionId) {
      const [pubVersion] = await db.select({
        yjsStateSnapshot: postVersions.yjsStateSnapshot,
      }).from(postVersions).where(and(
        eq(postVersions.id, post.publishedVersionId),
        eq(postVersions.postId, post.id),
      )).limit(1);
      if (pubVersion?.yjsStateSnapshot) {
        selectedState = new Uint8Array(pubVersion.yjsStateSnapshot);
      }
    }
  }

  let documentJson = persistedDocumentJson(selectedState);
  if (!documentJson && typeof derivedMarkdown === 'string') {
    documentJson = markdownToFallbackDocumentJson(derivedMarkdown);
  }

  return {
    ok: true as const, permission, content: {
      ...(canEdit ? { yjsState: post.yjsState } : {}),
      ...(canReadWorking ? { workingMarkdown } : {}),
      ...((canEdit || (canReadSubmission && activeReview)) ? {
        submittedVersionId: submittedVersion?.id ?? null, submittedVersion,
      } : {}),
      publishedMarkdown, derivedMarkdown, contentSource,
      documentJson,
    }
  };
}

export const postRoutes: FastifyPluginAsync<{
  db: Database;
  permissionService: PermissionService;
  auditService: AuditService;
  viewCounter?: BufferedViewCounter;
  notificationService: NotificationService;
  outboxService?: OutboxService;
  collabService?: CollabService;
}> = async (fastify, options) => {
  const { db, permissionService, auditService, viewCounter, notificationService, outboxService, collabService } = options;

  async function publishApprovedCheckpoint(
    request: FastifyRequest,
    reply: FastifyReply,
    alias: 'publish' | 'republish',
  ) {
    const user = request.user!;
    const rawId = (request.params as { id: string }).id;
    if (!rawId || typeof rawId !== 'string' || !rawId.trim()) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid post ID' });
    }
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId.trim());
    if (!isUuid) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid post ID' });
    }
    const denied = (statusCode: number, error: string, message: string) => ({
      ok: false as const,
      statusCode,
      body: { error, message },
    });

    let outcome;
    try {
      outcome = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(posts)
          .where(eq(posts.id, rawId.trim().toLowerCase()))
          .limit(1)
          .for('update');
        if (!current) return denied(404, 'Not Found', 'Post not found');
        const id = current.id;

        const access = await resolveCurrentPostAccess(tx as unknown as Database, user.userId, current);
        if (!access.account) return denied(401, 'Unauthorized', 'Authentication required');
        const isAuthor = current.authorId === user.userId;
        const hasPatScope = !request.isPatAuth || request.patScopes?.some(
          (scope) => scope === 'post:publish' || scope === 'posts:publish',
        );
        if (!permissionService.canPublish(access.account.role, access.permission, isAuthor) || !hasPatScope) {
          return denied(403, 'Forbidden', isAuthor
            ? 'Author cannot self-publish without independent moderator or admin approval'
            : 'Insufficient permissions to publish this post');
        }
        if (current.status !== 'approved') {
          return denied(409, 'Invalid transition',
            `A post can only be ${alias === 'republish' ? 'republished' : 'published'} after approval (current status: ${current.status})`);
        }
        if (alias === 'republish' && typeof current.publishedMarkdown !== 'string') {
          return denied(409, 'Invalid transition', 'A post can only be republished after a prior publication');
        }

        const parsedBody = PublicationRequestSchema.safeParse(request.body);
        if (!parsedBody.success) {
          return denied(400, 'Bad Request', parsedBody.error.issues.some((issue) => issue.path[0] === 'notes')
            ? 'Publication notes must be a string of at most 2000 characters'
            : 'A valid submittedVersionId is required');
        }
        const { submittedVersionId, notes } = parsedBody.data;
        if (!current.submittedVersionId || current.submittedVersionId !== submittedVersionId) {
          return denied(409, 'Conflict', 'Approved review checkpoint changed or unavailable');
        }

        const [checkpoint] = await tx.select({
          id: postVersions.id,
          versionNumber: postVersions.versionNumber,
          markdownSnapshot: postVersions.markdownSnapshot,
        }).from(postVersions).where(and(
          eq(postVersions.id, submittedVersionId),
          eq(postVersions.postId, current.id),
          eq(postVersions.triggerReason, 'review_submission'),
        )).limit(1);
        if (!checkpoint || typeof checkpoint.markdownSnapshot !== 'string') {
          return denied(409, 'Conflict', 'Approved review checkpoint changed or unavailable');
        }

        const [independentApproval] = await tx.select({ id: postReviews.id }).from(postReviews).where(and(
          eq(postReviews.postId, current.id),
          eq(postReviews.submittedVersionId, checkpoint.id),
          eq(postReviews.decision, 'approved'),
          ne(postReviews.reviewerId, current.authorId),
        )).limit(1);
        if (!independentApproval) {
          return denied(409, 'Conflict', 'Approved review checkpoint changed or unavailable');
        }
        if (!outboxService) throw new Error('Publication outbox is not configured');

        const now = new Date();
        const [published] = await tx.update(posts).set({
          status: 'published',
          publishedVersionId: checkpoint.id,
          publishedMarkdown: checkpoint.markdownSnapshot,
          publishedAt: current.publishedAt ?? now,
          submittedVersionId: null,
          updatedAt: now,
        }).where(eq(posts.id, current.id)).returning({
          id: posts.id,
          status: posts.status,
          publishedVersionId: posts.publishedVersionId,
          publishedAt: posts.publishedAt,
        });
        if (!published) throw new Error('Publication update failed');

        await outboxService.enqueue(tx, 'post:published', {
          postId: current.id,
          publishedVersionId: checkpoint.id,
          authorId: current.authorId,
          spaceId: current.spaceId,
          title: current.title,
          ...(notes !== undefined ? { notes } : {}),
        });
        return { ok: true as const, current, checkpoint, published, notes };
      });
    } catch {
      request.log.warn({ postId: rawId }, 'Publication transaction failed');
      return reply.status(503).send({
        error: 'Service Unavailable',
        message: 'Unable to publish the approved checkpoint',
      });
    }

    if (!outcome.ok) return reply.status(outcome.statusCode).send(outcome.body);
    const { current, checkpoint, published, notes } = outcome;
    const republishing = alias === 'republish';

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: request.isPatAuth ? 'agent' : 'human',
      patId: request.patId,
      action: republishing ? 'post_republished' : 'post_published',
      entityType: 'post',
      entityId: current.id,
      metadata: {
        versionNumber: checkpoint.versionNumber, versionId: checkpoint.id,
        ...(notes !== undefined ? { notes } : {})
      },
      ipAddress: request.ip,
    }).catch(() => request.log.warn({ postId: current.id }, 'Publication committed; audit delivery failed'));

    await notificationService.create({
      userId: current.authorId,
      type: 'published',
      title: republishing ? 'Post republished' : 'Post published',
      body: `${current.title} ${republishing ? 'was republished' : 'is now published'}.`,
      entityType: 'post',
      entityId: current.id,
      href: `/posts/${current.id}`,
    }).catch(() => request.log.warn({ postId: current.id }, 'Publication committed; notification delivery failed'));

    return reply.send({ post: published });
  }

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

    // Per-row grant provenance stays in SQL, before both LIMIT and COUNT. The
    // unique membership/invitation joins cannot multiply catalog rows.
    const activeReview = inArray(posts.status, ['in_review', 'approved']);
    const spaceVisible = eq(posts.visibility, 'space');
    const adminGrant = user?.role === 'admin' ? sql`true`
      : inArray(spaceMembers.role, ['maintainer', 'owner']);
    const editGrant = or(
      adminGrant,
      user ? eq(posts.authorId, user.userId) : sql`false`,
      eq(postCollaborators.permission, 'edit'),
      and(spaceVisible, eq(spaceMembers.role, 'author')),
    )!;
    const workingGrant = or(editGrant, eq(postCollaborators.permission, 'view'),
      and(spaceVisible, eq(spaceMembers.role, 'viewer')))!;
    const reviewGrant = or(
      eq(postCollaborators.permission, 'review'),
      and(spaceVisible, eq(spaceMembers.role, 'reviewer')),
      user?.role === 'moderator' ? activeReview : sql`false`,
    )!;
    const submittedGrant = and(or(editGrant, reviewGrant), activeReview,
      isNotNull(postVersions.id), isNotNull(postVersions.markdownSnapshot))!;
    const publishedGrant = and(isNotNull(posts.publishedMarkdown), or(
      eq(posts.isPromoted, true), isNull(posts.spaceId), workingGrant, reviewGrant,
      user?.role === 'moderator' ? sql`true` : sql`false`,
    ))!;
    const visibilityCondition = or(workingGrant, submittedGrant, publishedGrant)!;
    const searchableMarkdown = sql<string | null>`case
      when ${workingGrant} then ${posts.workingMarkdown}
      when ${submittedGrant} then ${postVersions.markdownSnapshot}
      when ${publishedGrant} then ${posts.publishedMarkdown}
      else null end`;

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
      contentSource: sql<'working' | 'submitted' | 'published'>`case
        when ${workingGrant} then 'working' when ${submittedGrant} then 'submitted' else 'published' end`.as('content_source'),
      userPermission: sql<string>`case when ${adminGrant} then 'admin'
        when ${editGrant} then 'edit' when ${reviewGrant} then 'review' else 'view' end`.as('user_permission'),
      isCollaborator: isNotNull(postCollaborators.postId).as('is_collaborator'),
      collaboratorPermission: postCollaborators.permission,
      publishedAt: posts.publishedAt,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
    };

    const filters = [visibilityCondition];
    if (query.status) filters.push(inArray(posts.status, query.status));
    if (query.tags?.length) {
      const lowerTags = query.tags.map((t) => t.toLowerCase());
      filters.push(inArray(posts.id, db
        .select({ postId: postTags.postId })
        .from(postTags)
        .innerJoin(tags, eq(postTags.tagId, tags.id))
        .where(or(
          inArray(tags.name, query.tags),
          inArray(tags.slug, lowerTags)
        ))));
    }
    if (query.coeId) filters.push(eq(posts.coeId, query.coeId));
    if (query.coe) filters.push(eq(centersOfExcellence.name, query.coe));
    if (query.search) {
      const pattern = `%${escapeSearchTerm(query.search)}%`;
      filters.push(or(
        ilike(posts.title, pattern),
        ilike(posts.excerpt, pattern),
        ilike(searchableMarkdown, pattern),
        ilike(users.fullName, pattern),
        ilike(centersOfExcellence.name, pattern)
      )!);
    }

    const where = and(...filters);
    const invitationJoin = and(eq(postCollaborators.postId, posts.id),
      user ? eq(postCollaborators.userId, user.userId) : sql`false`);
    const membershipJoin = and(eq(spaceMembers.spaceId, posts.spaceId),
      user ? eq(spaceMembers.userId, user.userId) : sql`false`);
    const submissionJoin = and(eq(postVersions.id, posts.submittedVersionId),
      eq(postVersions.postId, posts.id), eq(postVersions.triggerReason, 'review_submission'));
    const fromQuery = db
      .select(baseSelection)
      .from(posts)
      .leftJoin(users, eq(posts.authorId, users.id))
      .leftJoin(centersOfExcellence, eq(posts.coeId, centersOfExcellence.id))
      .leftJoin(spaces, eq(posts.spaceId, spaces.id))
      .leftJoin(postCollaborators, invitationJoin)
      .leftJoin(spaceMembers, membershipJoin)
      .leftJoin(postVersions, submissionJoin);

    const countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(posts)
      .leftJoin(users, eq(posts.authorId, users.id))
      .leftJoin(centersOfExcellence, eq(posts.coeId, centersOfExcellence.id))
      .leftJoin(spaces, eq(posts.spaceId, spaces.id))
      .leftJoin(postCollaborators, invitationJoin)
      .leftJoin(spaceMembers, membershipJoin)
      .leftJoin(postVersions, submissionJoin);

    const catalogDate = sql`coalesce(${posts.publishedAt}, ${posts.createdAt})`;
    const orderBy = query.sort === 'title'
      ? [asc(posts.title), asc(posts.id)]
      : query.sort === 'oldest'
        ? [asc(catalogDate), asc(posts.id)]
        : [desc(catalogDate), desc(posts.id)];
    const offset = query.offset ?? (query.page - 1) * query.limit;
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
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
        hasNextPage: offset + queryResult.length < total,
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

  // Capability contract used by the collab server before any raw CRDT sync.
  fastify.get('/:id/collab-access', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const parsedId = z.string().uuid().safeParse((request.params as { id: string }).id);
    if (!parsedId.success) return reply.status(400).send({ error: 'Bad Request', message: 'Invalid post ID' });
    const hasEditScope = !request.isPatAuth || request.patScopes?.some(
      (scope) => scope === 'post:edit' || scope === 'posts:draft' || scope === 'post:draft' || scope === 'posts:write'
    );
    if (!hasEditScope) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Post edit scope required' });
    }

    // Signed sessions can outlive a role change or account deactivation. The
    // capability is based on the current account, not cached session claims.
    const [account] = await db.select({
      id: users.id, role: users.role, name: users.fullName,
      email: users.email, isActive: users.isActive
    }).from(users)
      .where(eq(users.id, request.user!.userId)).limit(1);
    if (!account?.isActive) return reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required' });
    const [post] = await db.select({
      id: posts.id, authorId: posts.authorId, status: posts.status,
      spaceId: posts.spaceId, visibility: posts.visibility, isPromoted: posts.isPromoted
    })
      .from(posts).where(eq(posts.id, parsedId.data.toLowerCase())).limit(1);
    if (!post) return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });
    const permission = await permissionService.resolvePostPermission(account, { ...post, postId: post.id });
    if (!permissionService.canEdit(permission)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Document edit access required' });
    }
    return reply.send({
      success: true, postId: post.id,
      user: { id: account.id, role: account.role, name: account.name.trim() || account.email },
      capabilities: { edit: true }
    });
  });

  // Publish-authorized callers can discover only the exact active approved pin.
  fastify.get('/:id/publication-checkpoint', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const user = request.user!;
    const rawId = (request.params as { id: string }).id;
    if (!rawId || typeof rawId !== 'string' || !rawId.trim()) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid post ID' });
    }
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId.trim());
    if (!isUuid) {
      return reply.status(400).send({ error: 'Bad Request', message: 'Invalid post ID' });
    }
    const denied = (statusCode: number, error: string, message: string) => ({
      ok: false as const,
      statusCode,
      body: { error, message },
    });

    let outcome;
    try {
      outcome = await db.transaction(async (tx) => {
        const [current] = await tx.select({
          id: posts.id,
          authorId: posts.authorId,
          status: posts.status,
          spaceId: posts.spaceId,
          visibility: posts.visibility,
          isPromoted: posts.isPromoted,
          submittedVersionId: posts.submittedVersionId,
        }).from(posts)
          .where(eq(posts.id, rawId.trim().toLowerCase()))
          .limit(1)
          .for('update');
        if (!current) return denied(404, 'Not Found', 'Post not found');
        const id = current.id;

        const access = await resolveCurrentPostAccess(tx as unknown as Database, user.userId, current);
        if (!access.account) return denied(401, 'Unauthorized', 'Authentication required');
        const isAuthor = current.authorId === user.userId;
        const hasPatScope = !request.isPatAuth || request.patScopes?.some(
          (scope) => scope === 'post:publish' || scope === 'posts:publish',
        );
        if (!permissionService.canPublish(access.account.role, access.permission, isAuthor) || !hasPatScope) {
          return denied(403, 'Forbidden', isAuthor
            ? 'Author cannot self-publish without independent moderator or admin approval'
            : 'Insufficient permissions to publish this post');
        }
        const parsedPin = RouteUuidSchema.safeParse(current.submittedVersionId);
        if (current.status !== 'approved' || !parsedPin.success) {
          return denied(409, 'Conflict', 'Approved review checkpoint changed or unavailable');
        }

        const [checkpoint] = await tx.select({
          id: postVersions.id,
          markdownSnapshot: postVersions.markdownSnapshot,
        }).from(postVersions).where(and(
          eq(postVersions.id, parsedPin.data),
          eq(postVersions.postId, current.id),
          eq(postVersions.triggerReason, 'review_submission'),
        )).limit(1);
        if (!checkpoint || typeof checkpoint.markdownSnapshot !== 'string') {
          return denied(409, 'Conflict', 'Approved review checkpoint changed or unavailable');
        }

        const [independentApproval] = await tx.select({ id: postReviews.id }).from(postReviews).where(and(
          eq(postReviews.postId, current.id),
          eq(postReviews.submittedVersionId, checkpoint.id),
          eq(postReviews.decision, 'approved'),
          ne(postReviews.reviewerId, current.authorId),
        )).limit(1);
        if (!independentApproval) {
          return denied(409, 'Conflict', 'Approved review checkpoint changed or unavailable');
        }

        return {
          ok: true as const, post: {
            id: current.id,
            status: current.status,
            submittedVersionId: checkpoint.id,
          }
        };
      });
    } catch {
      request.log.warn({ postId: rawId }, 'Publication checkpoint read failed');
      return reply.status(503).send({
        error: 'Service Unavailable',
        message: 'Unable to read the approved publication checkpoint',
      });
    }

    if (!outcome.ok) return reply.status(outcome.statusCode).send(outcome.body);
    return reply.send({ post: outcome.post });
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
        submittedVersionId: posts.submittedVersionId,
        publishedVersionId: posts.publishedVersionId,
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

    const projection = await projectPostContent(db, permissionService, post, request.user);
    if (!projection.ok) return reply.status(projection.statusCode).send(projection.error);

    const query = request.query as { format?: string; includeSuggestions?: string } | undefined;
    if (query?.includeSuggestions === 'true') {
      const canReviewOrEdit = permissionService.canEdit(projection.permission)
        || permissionService.canReview(projection.permission, request.user?.userId === post.authorId);
      if (!canReviewOrEdit) {
        return reply.status(403).send({
          error: 'Forbidden',
          code: 'FORBIDDEN',
          message: 'Suggestion-bearing documents require edit or review permission.',
        });
      }
    }

    const tagsByPost = await loadTagsForPosts(db, [post.id]);
    viewCounter?.increment(post.id);
    const { yjsState: _yjs, workingMarkdown: _working, submittedVersionId: _pin, publishedMarkdown: _published, publishedVersionId: _pubVer, ...metadata } = post;

    return reply.send({
      post: {
        ...metadata,
        ...projection.content,
        tags: tagsByPost.get(post.id) || [],
      },
      userPermission: projection.permission,
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

    const projection = await projectPostContent(db, permissionService, post, request.user);
    if (!projection.ok) return reply.status(projection.statusCode).send(projection.error);

    reply.header('Content-Type', 'text/markdown; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${post.slug}.md"`);
    return reply.send(projection.content.derivedMarkdown);
  });

  // Helper: Server-side pure Yjs markdown parser
  function populateYjsFromMarkdown(ydoc: Y.Doc, markdown: string) {
    const fragment = ydoc.getXmlFragment('prosemirror');
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Heading: #{1,6} Title
      const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (hMatch) {
        const level = hMatch[1].length;
        const text = hMatch[2].trim();
        const h = new Y.XmlElement('heading');
        h.setAttribute('level', String(level));
        const ht = new Y.XmlText(text);
        h.insert(0, [ht]);
        fragment.push([h]);
        i++;
        continue;
      }

      // Mermaid code block: ```mermaid
      if (line.trim().startsWith('```mermaid')) {
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++; // skip closing ```
        const m = new Y.XmlElement('mermaidBlock');
        m.setAttribute('code', codeLines.join('\n').trim());
        fragment.push([m]);
        continue;
      }

      // Math display block: $$
      if (line.trim() === '$$') {
        const mathLines: string[] = [];
        i++;
        while (i < lines.length && lines[i].trim() !== '$$') {
          mathLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++; // skip closing $$
        const mb = new Y.XmlElement('mathBlock');
        mb.setAttribute('formula', mathLines.join('\n').trim());
        fragment.push([mb]);
        continue;
      }

      // Generic code block: ```[lang]
      if (line.trim().startsWith('```')) {
        const lang = line.trim().slice(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++; // skip closing ```
        const cb = new Y.XmlElement('codeBlock');
        if (lang) cb.setAttribute('language', lang);
        const cbt = new Y.XmlText(codeLines.join('\n'));
        cb.insert(0, [cbt]);
        fragment.push([cb]);
        continue;
      }

      // Blank line
      if (!line.trim()) {
        i++;
        continue;
      }

      // Regular paragraph: collect consecutive non-blank lines that aren't special blocks
      const paraLines: string[] = [line];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !lines[i].match(/^#{1,6}\s+/) &&
        !lines[i].trim().startsWith('```') &&
        lines[i].trim() !== '$$'
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      const p = new Y.XmlElement('paragraph');
      const pt = new Y.XmlText(paraLines.join('\n'));
      p.insert(0, [pt]);
      fragment.push([p]);
    }
  }

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
      populateYjsFromMarkdown(ydoc, content);
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

    const { permission } = await resolveCurrentPostAccess(db, user.userId, post);

    if (!permissionService.canEdit(permission)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'You do not have permission to edit this post' });
    }

    const parseResult = UpdatePostSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }

    const { tags: tagNames, ...updates } = parseResult.data;

    // Check slug collision
    if (updates.slug && updates.slug !== post.slug) {
      const [existingSlug] = await db
        .select({ id: posts.id })
        .from(posts)
        .where(eq(posts.slug, updates.slug))
        .limit(1);
      if (existingSlug && existingSlug.id !== id) {
        return reply.status(409).send({
          error: 'Conflict',
          message: `Slug "${updates.slug}" is already in use by another post`,
        });
      }
    }

    // Handle status changes (e.g. Save as Draft reversion)
    const postUpdateData: Record<string, any> = { ...updates };

    if (updates.status === 'draft') {
      if (post.status === 'published' || post.status === 'archived') {
        return reply.status(400).send({
          error: 'Bad Request',
          message: `Cannot revert a ${post.status} post directly to draft`,
        });
      }
      postUpdateData.status = 'draft';
      postUpdateData.submittedVersionId = null;
    }

    const outcome = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(posts).where(eq(posts.id, id)).limit(1).for('update');
      if (!current) {
        return { ok: false as const, statusCode: 404, body: { error: 'Not Found', message: 'Post not found' } };
      }
      const access = await resolveCurrentPostAccess(tx as unknown as Database, user.userId, current);
      if (!access.account) {
        return { ok: false as const, statusCode: 401, body: { error: 'Unauthorized', message: 'Authentication required' } };
      }
      if (!permissionService.canEdit(access.permission)) {
        return {
          ok: false as const, statusCode: 403,
          body: { error: 'Forbidden', message: 'You do not have permission to edit this post' }
        };
      }
      if (updates.status === 'draft') {
        if (current.status !== post.status || current.submittedVersionId !== post.submittedVersionId) {
          return {
            ok: false as const, statusCode: 409,
            body: { error: 'Conflict', message: 'Post workflow changed. Reload before reverting to draft.' }
          };
        }
        if (current.status === 'published' || current.status === 'archived') {
          return {
            ok: false as const, statusCode: 400,
            body: { error: 'Bad Request', message: `Cannot revert a ${current.status} post directly to draft` }
          };
        }
      }
      const [updated] = await tx
        .update(posts)
        .set({ ...postUpdateData, updatedAt: new Date() })
        .where(eq(posts.id, current.id))
        .returning();

      const tags = tagNames === undefined
        ? (await loadTagsForPosts(tx as any, [current.id])).get(current.id) || []
        : await replacePostTags(tx as any, current.id, tagNames);

      return { ok: true as const, updatedPost: updated, savedTags: tags };
    });
    if (!outcome.ok) return reply.status(outcome.statusCode).send(outcome.body);
    const { updatedPost, savedTags } = outcome;

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

    // Read attachment metadata before the relational cascade, but defer every
    // destructive side effect until collaboration has confirmed its barrier.
    let attachments: Array<typeof postAttachments.$inferSelect> = [];
    try {
      attachments = await db.select().from(postAttachments).where(eq(postAttachments.postId, post.id));
    } catch (cleanupErr) {
      request.log.warn({ cleanupErr }, 'Unable to load attachment cleanup metadata');
    }

    // A validated tombstone acknowledgement is the deletion barrier. Unknown
    // outcomes deliberately leave the relational post intact for safe retry.
    try {
      if (!collabService) throw new CollabServiceError('UNAVAILABLE', 'Collaboration dependency is not configured');
      const tombstone = await collabService.tombstoneDocument(post.id);
      if (tombstone?.tombstoned !== true || tombstone.documentName !== `post-${post.id}`) {
        throw new CollabServiceError('INVALID_RESPONSE', 'Invalid collaboration deletion acknowledgement', true);
      }
    } catch (tombErr) {
      request.log.warn({ tombErr, id: post.id }, 'Failed to confirm collaboration deletion barrier');
      return reply.status(503).send({
        error: 'Service Unavailable',
        message: 'Unable to safely delete the post',
      });
    }

    // Delete post row (cascades to all foreign-key tables in DB)
    const [deleted] = await db.delete(posts).where(eq(posts.id, post.id)).returning({ id: posts.id });
    if (!deleted) {
      return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });
    }

    // Clean up associated files only after the relational delete succeeds.
    try {
      for (const att of attachments) {
        if (att.storagePath && fs.existsSync(att.storagePath)) {
          const [otherRef] = await db
            .select({ id: postAttachments.id })
            .from(postAttachments)
            .where(and(eq(postAttachments.sha256, att.sha256), ne(postAttachments.postId, post.id)))
            .limit(1);
          if (!otherRef) await fs.promises.unlink(att.storagePath).catch(() => { });
        }
      }
    } catch (cleanupErr) {
      request.log.warn({ cleanupErr }, 'Attachment disk cleanup encountered an error');
    }

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'post_deleted',
      entityType: 'post',
      entityId: post.id,
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

    const { permission } = await resolveCurrentPostAccess(db, user.userId, post);

    const hasEditScope = !request.isPatAuth || request.patScopes?.some(
      (scope) => scope === 'post:edit' || scope === 'posts:draft' || scope === 'post:draft' || scope === 'posts:write'
    );
    if (!permissionService.canEdit(permission) || !hasEditScope) {
      return reply.status(403).send({ error: 'Forbidden', message: 'You do not have permission to submit this post for review' });
    }

    if (post.status !== 'draft' && post.status !== 'published') {
      return reply.status(409).send({
        error: 'Invalid transition',
        message: `A post can only be submitted for review from draft or published status (current status: ${post.status})`,
      });
    }

    const [admittedVersion] = await db.select({ versionNumber: postVersions.versionNumber }).from(postVersions)
      .where(eq(postVersions.postId, post.id)).orderBy(desc(postVersions.versionNumber)).limit(1);
    let submission;
    try {
      if (!collabService) throw new CollabServiceError('UNAVAILABLE', 'Collaboration dependency is not configured');
      // Never hold a row lock across this RPC: capture persists to that same row.
      const captured = await collabService.flushDocument(post.id);
      if (captured.documentName !== `post-${post.id}` || typeof captured.inMemory !== 'boolean') {
        throw new CollabServiceError('INVALID_RESPONSE', 'Invalid capture acknowledgement');
      }
      const live = captured.inMemory ? deriveDocumentSnapshot(captured.yjsState) : null;
      if (captured.inMemory && (live!.workingMarkdown !== captured.workingMarkdown || live!.fingerprint !== captured.fingerprint)) {
        throw new CollabServiceError('INVALID_RESPONSE', 'Incoherent capture acknowledgement');
      }
      if (!captured.inMemory && ('yjsState' in captured || 'workingMarkdown' in captured || 'fingerprint' in captured)) {
        throw new CollabServiceError('INVALID_RESPONSE', 'Invalid inactive capture acknowledgement');
      }

      submission = await db.transaction(async (tx) => {
        // The reread is AFTER acknowledgement, and also serializes concurrent
        // submissions/version-number allocation across all API processes.
        const [current] = await tx.select().from(posts).where(eq(posts.id, post.id)).limit(1).for('update');
        if (!current) return { ok: false as const, statusCode: 404, message: 'Post not found' };
        const access = await resolveCurrentPostAccess(tx as unknown as Database, user.userId, current);
        if (!permissionService.canEdit(access.permission)) {
          return { ok: false as const, statusCode: 403, message: 'You do not have permission to submit this post for review' };
        }
        const [latest] = await tx.select({ versionNumber: postVersions.versionNumber }).from(postVersions)
          .where(eq(postVersions.postId, post.id)).orderBy(desc(postVersions.versionNumber)).limit(1);
        if (current.status !== post.status || current.submittedVersionId !== post.submittedVersionId
          || (latest?.versionNumber ?? 0) !== (admittedVersion?.versionNumber ?? 0)) {
          return { ok: false as const, statusCode: 409, message: 'Post workflow changed during capture. Reload before submitting.' };
        }
        const snapshot = live ?? deriveDocumentSnapshot(current.yjsState);
        const [version] = await tx.insert(postVersions).values({
          postId: post.id, versionNumber: (latest?.versionNumber ?? 0) + 1,
          triggerReason: 'review_submission', yjsStateSnapshot: Buffer.from(snapshot.yjsState),
          markdownSnapshot: snapshot.workingMarkdown, createdBy: user.userId,
        }).returning();
        const [updated] = await tx.update(posts).set({
          status: 'in_review', submittedVersionId: version.id, updatedAt: new Date(),
        }).where(eq(posts.id, post.id)).returning();
        // Only the immutable checkpoint and its pin change. Later working edits
        // belong to the next revision and must never be overwritten by capture.
        await outboxService?.enqueue(tx, 'post:submitted_for_review', {
          postId: post.id, authorId: current.authorId, versionId: version.id,
        });
        return { ok: true as const, submittedVersion: version, updatedPost: updated };
      });
    } catch (error) {
      const statusCode = error instanceof CollabServiceError ? error.statusCode : (error as { code?: string })?.code === '23505' ? 409 : 503;
      request.log.warn({ postId: post.id, statusCode }, 'Review capture or checkpoint transaction failed');
      return reply.status(statusCode).send({
        error: statusCode === 409 ? 'Conflict' : 'Service Unavailable',
        message: statusCode === 409 ? 'Post changed during submission. Reload before submitting.' : 'Unable to capture the working document for review'
      });
    }
    if (!submission.ok) return reply.status(submission.statusCode).send({
      error: submission.statusCode === 403 ? 'Forbidden'
        : submission.statusCode === 404 ? 'Not Found' : 'Conflict', message: submission.message
    });
    const { submittedVersion, updatedPost } = submission;

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'post_submitted_for_review',
      entityType: 'post',
      entityId: id,
      metadata: {
        versionId: submittedVersion.id,
        versionNumber: submittedVersion.versionNumber,
      },
      ipAddress: request.ip,
    }).catch(() => request.log.warn({ postId: post.id }, 'Review submission committed; audit delivery failed'));

    await notificationService.notifyAdminsAndModerators({
      type: 'review_submitted',
      title: 'Post submitted for review',
      body: `${post.title} was submitted for editorial review.`,
      entityType: 'post',
      entityId: id,
      href: `/posts/${id}`,
    }, user.userId).catch(() => request.log.warn({ postId: post.id }, 'Review submission committed; notification delivery failed'));

    return reply.send({ post: updatedPost, submittedVersion });
  });

  // 6. Publish the exact active, independently approved review checkpoint.
  fastify.post('/:id/publish', { preHandler: (fastify as any).requireAuth },
    (request, reply) => publishApprovedCheckpoint(request, reply, 'publish'));

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
  fastify.get('/:id/versions', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) {
      return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });
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

    if (!permissionService.canEdit(permission)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Insufficient permission to view version history' });
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
  fastify.get('/:id/versions/:versionId', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const { id, versionId } = request.params as { id: string; versionId: string };
    const user = request.user!;

    const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    if (!post) {
      return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });
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

    if (!permissionService.canEdit(permission)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Insufficient permission to view version history' });
    }

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

    const { permission } = await resolveCurrentPostAccess(db, user.userId, post);

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

    let targetSnapshot: ReturnType<typeof deriveDocumentSnapshot>;
    try {
      targetSnapshot = deriveDocumentSnapshot(new Uint8Array(targetVersion.yjsStateSnapshot));
      if (targetSnapshot.workingMarkdown !== targetVersion.markdownSnapshot) throw new Error('Incoherent target');
    } catch {
      return reply.status(409).send({ error: 'Conflict', message: 'Target version content is not restorable' });
    }

    let safetySnapshot: ReturnType<typeof deriveDocumentSnapshot>;
    let safetyVersionNumber: number;
    try {
      if (!collabService) throw new CollabServiceError('UNAVAILABLE', 'Collaboration dependency is not configured');

      // Capture/persist without a row lock: the collab RPC writes this same row.
      const captured = await collabService.flushDocument(post.id);
      if (!captured || captured.documentName !== `post-${post.id}` || typeof captured.inMemory !== 'boolean') {
        throw new CollabServiceError('INVALID_RESPONSE', 'Invalid capture acknowledgement');
      }

      let activeSnapshot: ReturnType<typeof deriveDocumentSnapshot> | null = null;
      if (captured.inMemory) {
        activeSnapshot = validatedCollabSnapshot(captured, `post-${post.id}`, false);
      } else {
        const rawCapture = captured as unknown as Record<string, unknown>;
        if ('yjsState' in rawCapture || 'workingMarkdown' in rawCapture || 'fingerprint' in rawCapture) {
          throw new CollabServiceError('INVALID_RESPONSE', 'Invalid inactive capture acknowledgement');
        }
      }

      // Commit the exact pre-restore state before dispatching the destructive
      // collaboration RPC. The short row lock also serializes version numbers;
      // no database lock is held while waiting on collaboration.
      const checkpoint = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(posts)
          .where(eq(posts.id, post.id)).limit(1).for('update');
        if (!current) return { ok: false as const, statusCode: 404, message: 'Post not found' };
        const access = await resolveCurrentPostAccess(tx as unknown as Database, user.userId, current);
        if (!permissionService.canEdit(access.permission)) {
          return { ok: false as const, statusCode: 403, message: 'Insufficient permission to restore version' };
        }
        // Inactive acknowledgements intentionally contain no content. Reread
        // only after that acknowledgement, under the workflow lock, so a
        // persistence change before acknowledgement is the protected source.
        const snapshot = activeSnapshot ?? deriveDocumentSnapshot(current.yjsState);
        const [latestVersion] = await tx
          .select({ versionNumber: postVersions.versionNumber })
          .from(postVersions)
          .where(eq(postVersions.postId, post.id))
          .orderBy(desc(postVersions.versionNumber))
          .limit(1);
        const [version] = await tx.insert(postVersions).values({
          postId: post.id,
          versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
          triggerReason: 'hourly_checkpoint',
          yjsStateSnapshot: Buffer.from(snapshot.yjsState),
          markdownSnapshot: snapshot.workingMarkdown,
          createdBy: access.account!.id,
        }).returning({ id: postVersions.id, versionNumber: postVersions.versionNumber });
        return { ok: true as const, version, snapshot };
      });
      if (!checkpoint.ok) {
        return reply.status(checkpoint.statusCode).send({
          error: checkpoint.statusCode === 404 ? 'Not Found' : 'Forbidden',
          message: checkpoint.message,
        });
      }
      safetySnapshot = checkpoint.snapshot;
      safetyVersionNumber = checkpoint.version.versionNumber;
    } catch (checkpointErr) {
      const statusCode = checkpointErr instanceof CollabServiceError ? checkpointErr.statusCode
        : (checkpointErr as { code?: string })?.code === '23505' ? 409 : 503;
      request.log.warn({ checkpointErr, statusCode, id: post.id }, 'Restore capture or safety checkpoint failed closed');
      return reply.status(statusCode).send({
        error: statusCode === 409 ? 'Conflict' : 'Service Unavailable',
        message: statusCode === 409
          ? 'Post history changed during restore. Reload and try again.'
          : 'Unable to safely restore the post version',
      });
    }

    let restoredSnapshot: ReturnType<typeof deriveDocumentSnapshot>;
    try {
      const restored = await collabService!.restoreDocument(
        post.id,
        targetSnapshot.yjsState,
        safetySnapshot.fingerprint,
      );
      restoredSnapshot = validatedCollabSnapshot(restored, `post-${post.id}`, true);
      if (restoredSnapshot.workingMarkdown !== targetSnapshot.workingMarkdown) {
        throw new CollabServiceError('INVALID_RESPONSE', 'Restore acknowledgement does not match the target', true);
      }
    } catch (collabErr) {
      const statusCode = collabErr instanceof CollabServiceError ? collabErr.statusCode : 503;
      request.log.warn({ collabErr, statusCode, id: post.id }, 'Collaboration restore failed closed with safety checkpoint retained');
      return reply.status(statusCode).send({
        error: statusCode === 409 ? 'Conflict' : 'Service Unavailable',
        message: statusCode === 409
          ? 'The working document changed during restore. Reload and try again.'
          : 'Unable to safely restore the post version',
      });
    }

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'post_version_restored',
      entityType: 'post',
      entityId: post.id,
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
      yjsState: Buffer.from(restoredSnapshot.yjsState),
      markdownSnapshot: restoredSnapshot.workingMarkdown,
    });
  });

  // 7.7 Republishing is the same reviewed-checkpoint publication with a retained-publication precondition.
  fastify.post('/:id/republish', { preHandler: (fastify as any).requireAuth },
    (request, reply) => publishApprovedCheckpoint(request, reply, 'republish'));
};
