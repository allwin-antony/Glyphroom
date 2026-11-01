import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { createApiApp } from '../src/app.js';
import {
  postCollaborators,
  postReviews,
  posts,
  postVersions,
  spaceMembers,
  spaces,
  users,
} from '../src/db/schema.js';
import type { Database } from '../src/db/index.js';

const PASSWORD = 'VersionPrivacyPass2026!';
const PUBLISHED_HISTORY_SECRET = '# New unpublished revision\n\nInternal launch details.';
const PROMOTED_HISTORY_SECRET = '# Unreleased promoted-page revision';
const PINNED_REVIEW_MARKDOWN = '# Submitted review checkpoint';
const LATER_REVIEW_MARKDOWN = '# Later unsubmitted reviewer-invisible revision';

const userSpecs = {
  author: { id: randomUUID(), email: 'author@privacy.example.com', fullName: 'Post Author', role: 'author' },
  admin: { id: randomUUID(), email: 'admin@privacy.example.com', fullName: 'Global Admin', role: 'admin' },
  editor: { id: randomUUID(), email: 'editor@privacy.example.com', fullName: 'Explicit Editor', role: 'reader' },
  explicitViewer: { id: randomUUID(), email: 'viewer@privacy.example.com', fullName: 'Explicit Viewer', role: 'reader' },
  explicitReviewer: { id: randomUUID(), email: 'reviewer@privacy.example.com', fullName: 'Explicit Reviewer', role: 'reader' },
  unrelated: { id: randomUUID(), email: 'unrelated@privacy.example.com', fullName: 'Unrelated Reader', role: 'reader' },
  moderator: { id: randomUUID(), email: 'moderator@privacy.example.com', fullName: 'Global Moderator', role: 'moderator' },
  spaceAuthor: { id: randomUUID(), email: 'space-author@privacy.example.com', fullName: 'Space Author', role: 'author' },
  spaceReviewer: { id: randomUUID(), email: 'space-reviewer@privacy.example.com', fullName: 'Space Reviewer', role: 'reader' },
  spaceViewer: { id: randomUUID(), email: 'space-viewer@privacy.example.com', fullName: 'Space Viewer', role: 'reader' },
  spaceMaintainer: { id: randomUUID(), email: 'space-maintainer@privacy.example.com', fullName: 'Space Maintainer', role: 'reader' },
  spaceOwner: { id: randomUUID(), email: 'space-owner@privacy.example.com', fullName: 'Space Owner', role: 'reader' },
} as const;

type UserKey = keyof typeof userSpecs;

const spaceId = randomUUID();
const postIds = {
  draft: randomUUID(),
  published: randomUUID(),
  promoted: randomUUID(),
  inReview: randomUUID(),
  spaceDraft: randomUUID(),
  invited: randomUUID(),
  other: randomUUID(),
} as const;
type PostKey = keyof typeof postIds;

const versionIds = {
  draft1: randomUUID(),
  draft2: randomUUID(),
  draft3: randomUUID(),
  published1: randomUUID(),
  published2: randomUUID(),
  promoted1: randomUUID(),
  promoted2: randomUUID(),
  inReviewPinned: randomUUID(),
  inReviewLater: randomUUID(),
  spaceDraft1: randomUUID(),
  invited1: randomUUID(),
  other1: randomUUID(),
} as const;

const primaryVersionByPost: Record<PostKey, string> = {
  draft: versionIds.draft3,
  published: versionIds.published2,
  promoted: versionIds.promoted2,
  inReview: versionIds.inReviewLater,
  spaceDraft: versionIds.spaceDraft1,
  invited: versionIds.invited1,
  other: versionIds.other1,
};

describe('post version-history read privacy', () => {
  let db: Database;
  let app: any;
  let close: (() => Promise<void>) | undefined;
  const sessions = new Map<UserKey, { cookie: string; csrfToken: string }>();

  beforeAll(async () => {
    const memory = createInMemoryDatabase();
    db = memory.db;

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    await db.insert(users).values(
      Object.values(userSpecs).map((user) => ({
        ...user,
        passwordHash,
        ssoProvider: 'local',
        isActive: true,
      }))
    );

    await db.insert(spaces).values({
      id: spaceId,
      slug: 'version-privacy-space',
      name: 'Version Privacy Space',
    });

    await db.insert(spaceMembers).values([
      { spaceId, userId: userSpecs.spaceAuthor.id, role: 'author' },
      { spaceId, userId: userSpecs.spaceReviewer.id, role: 'reviewer' },
      { spaceId, userId: userSpecs.spaceViewer.id, role: 'viewer' },
      { spaceId, userId: userSpecs.spaceMaintainer.id, role: 'maintainer' },
      { spaceId, userId: userSpecs.spaceOwner.id, role: 'owner' },
    ]);

    const postRows: (typeof posts.$inferInsert)[] = [
      {
        id: postIds.draft,
        slug: 'private-version-draft',
        title: 'Private Version Draft',
        status: 'draft',
        authorId: userSpecs.author.id,
        visibility: 'space',
        isPromoted: false,
        yjsState: Buffer.from([1]),
        workingMarkdown: '# Current draft',
      },
      {
        id: postIds.published,
        slug: 'public-post-private-history',
        title: 'Public Post with Private History',
        status: 'published',
        authorId: userSpecs.author.id,
        visibility: 'space',
        isPromoted: false,
        yjsState: Buffer.from([2]),
        workingMarkdown: PUBLISHED_HISTORY_SECRET,
        publishedMarkdown: '# Reviewed public snapshot',
        publishedAt: new Date('2026-10-01T00:00:00.000Z'),
      },
      {
        id: postIds.promoted,
        slug: 'promoted-post-private-history',
        title: 'Promoted Post with Private History',
        status: 'published',
        authorId: userSpecs.author.id,
        spaceId,
        visibility: 'space',
        isPromoted: true,
        yjsState: Buffer.from([3]),
        workingMarkdown: PROMOTED_HISTORY_SECRET,
        publishedMarkdown: '# Reviewed promoted snapshot',
        publishedAt: new Date('2026-10-02T00:00:00.000Z'),
      },
      {
        id: postIds.inReview,
        slug: 'pinned-review-version',
        title: 'Pinned Review Version',
        status: 'in_review',
        authorId: userSpecs.author.id,
        visibility: 'space',
        isPromoted: false,
        yjsState: Buffer.from([4]),
        workingMarkdown: LATER_REVIEW_MARKDOWN,
      },
      {
        id: postIds.spaceDraft,
        slug: 'space-version-draft',
        title: 'Space Version Draft',
        status: 'draft',
        authorId: userSpecs.author.id,
        spaceId,
        visibility: 'space',
        isPromoted: false,
        yjsState: Buffer.from([5]),
      },
      {
        id: postIds.invited,
        slug: 'invited-version-draft',
        title: 'Invited-only Version Draft',
        status: 'draft',
        authorId: userSpecs.author.id,
        spaceId,
        visibility: 'invited_only',
        isPromoted: false,
        yjsState: Buffer.from([6]),
      },
      {
        id: postIds.other,
        slug: 'other-version-draft',
        title: 'Other Version Draft',
        status: 'draft',
        authorId: userSpecs.author.id,
        visibility: 'space',
        isPromoted: false,
        yjsState: Buffer.from([7]),
      },
    ];
    await db.insert(posts).values(postRows);

    const versionRows: (typeof postVersions.$inferInsert)[] = [
      {
        id: versionIds.draft1,
        postId: postIds.draft,
        versionNumber: 1,
        triggerReason: 'manual_save',
        yjsStateSnapshot: Buffer.from([11]),
        markdownSnapshot: '# Draft version one',
        createdBy: userSpecs.author.id,
        createdAt: new Date('2026-10-10T01:00:00.000Z'),
      },
      {
        id: versionIds.draft3,
        postId: postIds.draft,
        versionNumber: 3,
        triggerReason: 'hourly_checkpoint',
        yjsStateSnapshot: Buffer.from([13]),
        markdownSnapshot: '# Draft version three',
        createdBy: userSpecs.author.id,
        createdAt: new Date('2026-10-10T03:00:00.000Z'),
      },
      {
        id: versionIds.draft2,
        postId: postIds.draft,
        versionNumber: 2,
        triggerReason: 'manual_save',
        yjsStateSnapshot: Buffer.from([12]),
        markdownSnapshot: '# Draft version two by editor',
        createdBy: userSpecs.editor.id,
        createdAt: new Date('2026-10-10T02:00:00.000Z'),
      },
      {
        id: versionIds.published1,
        postId: postIds.published,
        versionNumber: 1,
        triggerReason: 'publication',
        yjsStateSnapshot: Buffer.from([21]),
        markdownSnapshot: '# Reviewed public snapshot',
        createdBy: userSpecs.author.id,
      },
      {
        id: versionIds.published2,
        postId: postIds.published,
        versionNumber: 2,
        triggerReason: 'manual_save',
        yjsStateSnapshot: Buffer.from([22]),
        markdownSnapshot: PUBLISHED_HISTORY_SECRET,
        createdBy: userSpecs.author.id,
      },
      {
        id: versionIds.promoted1,
        postId: postIds.promoted,
        versionNumber: 1,
        triggerReason: 'publication',
        yjsStateSnapshot: Buffer.from([31]),
        markdownSnapshot: '# Reviewed promoted snapshot',
        createdBy: userSpecs.author.id,
      },
      {
        id: versionIds.promoted2,
        postId: postIds.promoted,
        versionNumber: 2,
        triggerReason: 'manual_save',
        yjsStateSnapshot: Buffer.from([32]),
        markdownSnapshot: PROMOTED_HISTORY_SECRET,
        createdBy: userSpecs.author.id,
      },
      {
        id: versionIds.inReviewPinned,
        postId: postIds.inReview,
        versionNumber: 1,
        triggerReason: 'review_submission',
        yjsStateSnapshot: Buffer.from([41]),
        markdownSnapshot: PINNED_REVIEW_MARKDOWN,
        createdBy: userSpecs.author.id,
      },
      {
        id: versionIds.inReviewLater,
        postId: postIds.inReview,
        versionNumber: 2,
        triggerReason: 'manual_save',
        yjsStateSnapshot: Buffer.from([42]),
        markdownSnapshot: LATER_REVIEW_MARKDOWN,
        createdBy: userSpecs.author.id,
      },
      {
        id: versionIds.spaceDraft1,
        postId: postIds.spaceDraft,
        versionNumber: 1,
        triggerReason: 'manual_save',
        yjsStateSnapshot: Buffer.from([51]),
        markdownSnapshot: '# Space draft history',
        createdBy: userSpecs.author.id,
      },
      {
        id: versionIds.invited1,
        postId: postIds.invited,
        versionNumber: 1,
        triggerReason: 'manual_save',
        yjsStateSnapshot: Buffer.from([61]),
        markdownSnapshot: '# Invited-only history',
        createdBy: userSpecs.author.id,
      },
      {
        id: versionIds.other1,
        postId: postIds.other,
        versionNumber: 1,
        triggerReason: 'manual_save',
        yjsStateSnapshot: Buffer.from([71]),
        markdownSnapshot: '# Other post history',
        createdBy: userSpecs.author.id,
      },
    ];
    await db.insert(postVersions).values(
      versionRows.map((version, index) => ({
        ...version,
        // pg-mem resolves mixed explicit/default values in a multi-row insert as NULL.
        createdAt: version.createdAt ?? new Date(Date.UTC(2026, 9, 11, 0, index)),
      }))
    );

    await db
      .update(posts)
      .set({ submittedVersionId: versionIds.inReviewPinned })
      .where(eq(posts.id, postIds.inReview));

    await db.insert(postCollaborators).values([
      { postId: postIds.draft, userId: userSpecs.editor.id, permission: 'edit' },
      { postId: postIds.invited, userId: userSpecs.editor.id, permission: 'edit' },
      { postId: postIds.published, userId: userSpecs.explicitViewer.id, permission: 'view' },
      { postId: postIds.draft, userId: userSpecs.explicitReviewer.id, permission: 'review' },
    ]);

    const instance = await createApiApp({
      db,
      sessionSecret: 'test-secret-32-chars-long-minimum-length',
    });
    app = instance.app;
    close = instance.close;
    await app.ready();
  });

  afterAll(async () => {
    if (close) await close();
  });

  async function login(user: UserKey) {
    const cached = sessions.get(user);
    if (cached) return cached;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: userSpecs[user].email, password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);

    const session = {
      cookie: response.cookies.map((cookie: any) => `${cookie.name}=${cookie.value}`).join('; '),
      csrfToken: response.json().csrfToken as string,
    };
    sessions.set(user, session);
    return session;
  }

  async function historyResponse(user: UserKey, post: PostKey, versionId?: string) {
    const session = await login(user);
    return app.inject({
      method: 'GET',
      url: versionId
        ? `/api/v1/posts/${postIds[post]}/versions/${versionId}`
        : `/api/v1/posts/${postIds[post]}/versions`,
      headers: { cookie: session.cookie },
    });
  }

  it('requires valid authentication on both history endpoints without returning history data', async () => {
    const endpoints = [
      `/api/v1/posts/${postIds.published}/versions`,
      `/api/v1/posts/${postIds.published}/versions/${versionIds.published2}`,
    ];

    for (const url of endpoints) {
      for (const headers of [undefined, { cookie: 'blogger_session=not-a-valid-session' }]) {
        const response = await app.inject({ method: 'GET', url, headers });
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: 'Unauthorized', message: 'Authentication required' });
        expect(response.body).not.toContain(PUBLISHED_HISTORY_SECRET);
        expect(response.body).not.toContain(versionIds.published2);
      }
    }
  });

  it('denies view, review, and no-access permissions before returning list or detail data', async () => {
    const deniedCases: Array<{ user: UserKey; post: PostKey; permission: string }> = [
      { user: 'unrelated', post: 'published', permission: 'public standalone view' },
      { user: 'moderator', post: 'published', permission: 'moderator published view' },
      { user: 'moderator', post: 'inReview', permission: 'moderator review' },
      { user: 'explicitViewer', post: 'published', permission: 'explicit view' },
      { user: 'explicitReviewer', post: 'draft', permission: 'explicit review' },
      { user: 'unrelated', post: 'draft', permission: 'none' },
      { user: 'spaceViewer', post: 'spaceDraft', permission: 'space view' },
      { user: 'spaceReviewer', post: 'spaceDraft', permission: 'space review' },
      { user: 'spaceAuthor', post: 'invited', permission: 'invited-only space author' },
      { user: 'spaceReviewer', post: 'invited', permission: 'invited-only space reviewer' },
      { user: 'spaceViewer', post: 'invited', permission: 'invited-only space viewer' },
      { user: 'unrelated', post: 'promoted', permission: 'promoted published view' },
    ];

    for (const testCase of deniedCases) {
      for (const versionId of [undefined, primaryVersionByPost[testCase.post]]) {
        const response = await historyResponse(testCase.user, testCase.post, versionId);
        expect(response.statusCode, `${testCase.permission} ${versionId ? 'detail' : 'list'}`).toBe(403);
        const body = response.json();
        expect(Object.keys(body).sort()).toEqual(['error', 'message']);
        expect(body.error).toBe('Forbidden');
        expect(response.body).not.toContain(primaryVersionByPost[testCase.post]);
        expect(response.body).not.toContain(PUBLISHED_HISTORY_SECRET);
        expect(response.body).not.toContain(PROMOTED_HISTORY_SECRET);
        expect(response.body).not.toContain(LATER_REVIEW_MARKDOWN);
      }
    }
  });

  it('allows only authors, global admins, explicit editors, and effective space editors/admins', async () => {
    const allowedCases: Array<{ user: UserKey; post: PostKey; permission: string }> = [
      { user: 'author', post: 'draft', permission: 'post author' },
      { user: 'admin', post: 'published', permission: 'global admin' },
      { user: 'editor', post: 'draft', permission: 'explicit editor' },
      { user: 'editor', post: 'invited', permission: 'invited-only explicit editor' },
      { user: 'spaceAuthor', post: 'spaceDraft', permission: 'space author editor' },
      { user: 'spaceMaintainer', post: 'spaceDraft', permission: 'space maintainer admin' },
      { user: 'spaceOwner', post: 'spaceDraft', permission: 'space owner admin' },
      { user: 'spaceMaintainer', post: 'invited', permission: 'invited-only maintainer admin' },
      { user: 'spaceOwner', post: 'invited', permission: 'invited-only owner admin' },
    ];

    for (const testCase of allowedCases) {
      const listResponse = await historyResponse(testCase.user, testCase.post);
      expect(listResponse.statusCode, `${testCase.permission} list`).toBe(200);
      expect(listResponse.json().versions.length).toBeGreaterThan(0);

      const detailResponse = await historyResponse(
        testCase.user,
        testCase.post,
        primaryVersionByPost[testCase.post]
      );
      expect(detailResponse.statusCode, `${testCase.permission} detail`).toBe(200);
      expect(detailResponse.json().version.id).toBe(primaryVersionByPost[testCase.post]);
    }
  });

  it('preserves descending list ordering and the existing list/detail response shapes', async () => {
    const listResponse = await historyResponse('author', 'draft');
    expect(listResponse.statusCode).toBe(200);
    const listBody = listResponse.json();
    expect(Object.keys(listBody)).toEqual(['versions']);
    expect(listBody.versions.map((version: any) => version.versionNumber)).toEqual([3, 2, 1]);
    expect(listBody.versions.map((version: any) => version.id)).toEqual([
      versionIds.draft3,
      versionIds.draft2,
      versionIds.draft1,
    ]);
    for (const version of listBody.versions) {
      expect(Object.keys(version).sort()).toEqual(
        ['id', 'postId', 'versionNumber', 'triggerReason', 'createdAt', 'createdBy', 'authorName'].sort()
      );
      expect(version).not.toHaveProperty('markdownSnapshot');
    }

    const detailResponse = await historyResponse('author', 'draft', versionIds.draft2);
    expect(detailResponse.statusCode).toBe(200);
    const detailBody = detailResponse.json();
    expect(Object.keys(detailBody)).toEqual(['version']);
    expect(Object.keys(detailBody.version).sort()).toEqual(
      [
        'id',
        'postId',
        'versionNumber',
        'triggerReason',
        'markdownSnapshot',
        'createdAt',
        'createdBy',
        'authorName',
      ].sort()
    );
    expect(detailBody.version).toMatchObject({
      id: versionIds.draft2,
      postId: postIds.draft,
      versionNumber: 2,
      triggerReason: 'manual_save',
      markdownSnapshot: '# Draft version two by editor',
      createdBy: userSpecs.editor.id,
      authorName: userSpecs.editor.fullName,
    });
  });

  it('returns authenticated 404s for missing posts, missing versions, and cross-post version IDs', async () => {
    const admin = await login('admin');
    const missingPostId = randomUUID();
    const missingPostList = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${missingPostId}/versions`,
      headers: { cookie: admin.cookie },
    });
    expect(missingPostList.statusCode).toBe(404);
    expect(missingPostList.json()).toEqual({ error: 'Not Found', message: 'Post not found' });

    const missingPostDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${missingPostId}/versions/${versionIds.draft1}`,
      headers: { cookie: admin.cookie },
    });
    expect(missingPostDetail.statusCode).toBe(404);
    expect(missingPostDetail.json()).toEqual({ error: 'Not Found', message: 'Post not found' });

    const missingVersion = await historyResponse('author', 'draft', randomUUID());
    expect(missingVersion.statusCode).toBe(404);
    expect(missingVersion.json()).toEqual({ error: 'Not Found', message: 'Version not found' });

    const crossPostVersion = await historyResponse('author', 'draft', versionIds.other1);
    expect(crossPostVersion.statusCode).toBe(404);
    expect(crossPostVersion.json()).toEqual({ error: 'Not Found', message: 'Version not found' });
  });

  it('keeps moderator access to the pinned submitted version through normal post/review flow', async () => {
    const moderator = await login('moderator');

    const history = await historyResponse('moderator', 'inReview', versionIds.inReviewPinned);
    expect(history.statusCode).toBe(403);

    const postResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${postIds.inReview}`,
      headers: { cookie: moderator.cookie },
    });
    expect(postResponse.statusCode).toBe(200);
    expect(postResponse.json()).toMatchObject({
      userPermission: 'review',
      post: {
        submittedVersion: {
          id: versionIds.inReviewPinned,
          versionNumber: 1,
          triggerReason: 'review_submission',
          markdownSnapshot: PINNED_REVIEW_MARKDOWN,
        },
      },
    });
    expect(postResponse.json().post.submittedVersion.id).not.toBe(versionIds.inReviewLater);

    const reviewResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${postIds.inReview}/reviews`,
      headers: { cookie: moderator.cookie, 'x-csrf-token': moderator.csrfToken },
      payload: { decision: 'approved', notes: 'Reviewed the pinned checkpoint.' },
    });
    expect(reviewResponse.statusCode).toBe(201);
    expect(reviewResponse.json().review.submittedVersionId).toBe(versionIds.inReviewPinned);

    const [savedReview] = await db
      .select({ submittedVersionId: postReviews.submittedVersionId })
      .from(postReviews)
      .where(eq(postReviews.postId, postIds.inReview))
      .limit(1);
    expect(savedReview.submittedVersionId).toBe(versionIds.inReviewPinned);
  });
});
