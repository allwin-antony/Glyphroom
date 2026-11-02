import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { createApiApp } from '../src/app.js';
import { users, posts, postVersions, postViewCounts, tags, postTags } from '../src/db/schema.js';
import type { Database } from '../src/db/index.js';
import { eq } from 'drizzle-orm';

describe('Phase 4: Catalog, Search, Publication Snapshots & Detached View Counter', () => {
  let db: Database;
  let app: any;
  let viewCounter: any;
  let close: () => Promise<void>;

  let authorId: string;
  let moderatorId: string;
  let publishedPostId: string;
  let draftPostId: string;

  beforeEach(async () => {
    const mem = createInMemoryDatabase();
    db = mem.db;

    // Seed users
    const [author] = await db
      .insert(users)
      .values({
        email: 'alice@corp.com',
        fullName: 'Alice Author',
        role: 'author',
        isActive: true,
      })
      .returning();
    authorId = author.id;

    const [moderator] = await db
      .insert(users)
      .values({
        email: 'bob.mod@corp.com',
        fullName: 'Bob Moderator',
        role: 'moderator',
        isActive: true,
      })
      .returning();
    moderatorId = moderator.id;

    // Initialize Yjs docs
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    // Published Post
    const [pub] = await db
      .insert(posts)
      .values({
        title: 'Distributed Systems Patterns in 2026',
        slug: 'distributed-systems-patterns-2026',
        excerpt: 'High availability patterns for distributed microservices.',
        status: 'published',
        authorId,
        yjsState: Buffer.from(Y.encodeStateAsUpdate(doc1)),
        publishedMarkdown: '# Distributed Systems Patterns in 2026\n\nHigh availability patterns.',
        publishedAt: new Date(),
      })
      .returning();
    publishedPostId = pub.id;

    // Secret Draft Post
    const [draft] = await db
      .insert(posts)
      .values({
        title: 'Confidential Unreleased Architecture Draft',
        slug: 'confidential-unreleased-architecture-draft',
        excerpt: 'Top secret draft content.',
        status: 'draft',
        authorId,
        yjsState: Buffer.from(Y.encodeStateAsUpdate(doc2)),
      })
      .returning();
    draftPostId = draft.id;

    const instance = await createApiApp({
      db,
      sessionSecret: 'test-session-secret-at-least-32-chars-long',
    });
    app = instance.app;
    viewCounter = instance.viewCounter;
    close = instance.close;
    await app.ready();
  });

  afterEach(async () => {
    if (close) {
      await close();
    }
  });

  it('enforces search visibility: public/readers only see published posts, drafts are strictly isolated', async () => {
    // Unauthenticated search for "Architecture"
    const publicRes = await app.inject({
      method: 'GET',
      url: '/api/v1/posts?search=Architecture',
    });
    expect(publicRes.statusCode).toBe(200);
    const publicPosts = publicRes.json().posts;

    // The draft post must NOT appear in public search results!
    expect(publicPosts.find((p: any) => p.id === draftPostId)).toBeUndefined();
  });

  it('returns typed pagination metadata and applies filters before limiting results', async () => {
    const firstPage = await app.inject({
      method: 'GET',
      url: '/api/v1/posts?limit=1&page=1&status=published&sort=oldest',
    });

    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json()).toMatchObject({
      posts: [{ id: publishedPostId, status: 'published' }],
      pagination: {
        page: 1,
        limit: 1,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
      },
    });

    const invalidQuery = await app.inject({
      method: 'GET',
      url: '/api/v1/posts?limit=0',
    });
    expect(invalidQuery.statusCode).toBe(400);
    expect(invalidQuery.json().error).toBe('Bad Request');
  });

  it('supports exact offsets and a complete repeated-status queue without changing page pagination', async () => {
    const state = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()));
    await db.insert(posts).values(Array.from({ length: 40 }, (_, index) => ({
      title: `Review queue row ${String(index + 1).padStart(2, '0')}`,
      slug: `review-queue-row-${String(index + 1).padStart(2, '0')}`,
      status: index % 2 === 0 ? 'in_review' as const : 'approved' as const,
      authorId,
      yjsState: state,
      publishedMarkdown: `Prior publication ${index + 1}`,
    })));

    const firstQueuePage = await app.inject({
      method: 'GET',
      url: '/api/v1/posts?search=Review%20queue%20row&status=in_review&status=approved&sort=title&page=1&limit=24',
    });
    expect(firstQueuePage.statusCode).toBe(200);
    expect(firstQueuePage.json().posts).toHaveLength(24);
    expect(firstQueuePage.json().pagination).toEqual({
      page: 1, limit: 24, total: 40, totalPages: 2, hasNextPage: true,
    });

    const secondQueuePage = await app.inject({
      method: 'GET',
      url: '/api/v1/posts?search=Review%20queue%20row&status=in_review&status=approved&sort=title&page=2&limit=24',
    });
    expect(secondQueuePage.statusCode).toBe(200);
    expect(secondQueuePage.json().posts).toHaveLength(16);
    expect(secondQueuePage.json().pagination).toEqual({
      page: 2, limit: 24, total: 40, totalPages: 2, hasNextPage: false,
    });

    const pageOnly = await app.inject({
      method: 'GET',
      url: '/api/v1/posts?search=Review%20queue%20row&sort=title&page=3&limit=10',
    });
    expect(pageOnly.json().posts.map((post: any) => post.title)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Review queue row ${index + 21}`),
    );

    const exactOffset = await app.inject({
      method: 'GET',
      url: '/api/v1/posts?search=Review%20queue%20row&sort=title&page=4&limit=10&offset=25',
    });
    expect(exactOffset.statusCode).toBe(200);
    expect(exactOffset.json().posts.map((post: any) => post.title)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Review queue row ${index + 26}`),
    );
    expect(exactOffset.json().pagination).toEqual({
      page: 4, limit: 10, total: 40, totalPages: 4, hasNextPage: true,
    });

    const beyondEnd = await app.inject({
      method: 'GET',
      url: '/api/v1/posts?search=Review%20queue%20row&limit=10&offset=50',
    });
    expect(beyondEnd.json()).toMatchObject({
      posts: [],
      pagination: { total: 40, hasNextPage: false },
    });

    for (const offset of ['-1', '1.5']) {
      const invalid = await app.inject({ method: 'GET', url: `/api/v1/posts?offset=${offset}` });
      expect(invalid.statusCode).toBe(400);
    }
  });

  it('filters normalized single and repeated wire tags with OR semantics and no duplicate rows', async () => {
    const state = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()));
    const phrase = 'systems & design — 架构 / 🚀 привет';
    const created = await db.insert(posts).values([
      { title: `${phrase} backend`, slug: 'encoded-search-backend', status: 'published', authorId,
        yjsState: state, publishedMarkdown: 'backend result' },
      { title: `${phrase} infra`, slug: 'encoded-search-infra', status: 'published', authorId,
        yjsState: state, publishedMarkdown: 'infra result' },
      { title: `${phrase} frontend`, slug: 'encoded-search-frontend', status: 'published', authorId,
        yjsState: state, publishedMarkdown: 'frontend result' },
    ]).returning({ id: posts.id, slug: posts.slug });
    const createdTags = await db.insert(tags).values([
      { name: 'backend', slug: 'backend' },
      { name: 'infra', slug: 'infra' },
      { name: 'frontend', slug: 'frontend' },
    ]).returning({ id: tags.id, name: tags.name });
    const tagId = Object.fromEntries(createdTags.map((tag) => [tag.name, tag.id]));
    const postId = Object.fromEntries(created.map((post) => [post.slug, post.id]));
    await db.insert(postTags).values([
      { postId: postId['encoded-search-backend'], tagId: tagId.backend },
      { postId: postId['encoded-search-backend'], tagId: tagId.infra },
      { postId: postId['encoded-search-infra'], tagId: tagId.infra },
      { postId: postId['encoded-search-frontend'], tagId: tagId.frontend },
    ]);

    const single = new URLSearchParams({ search: phrase, tags: ' BACKEND ', limit: '10', offset: '0' });
    const singleResponse = await app.inject({ method: 'GET', url: `/api/v1/posts?${single}` });
    expect(singleResponse.statusCode).toBe(200);
    expect(singleResponse.json().posts.map((post: any) => post.id)).toEqual([postId['encoded-search-backend']]);
    expect(singleResponse.json().pagination.total).toBe(1);

    const repeated = new URLSearchParams({ search: phrase, limit: '10', offset: '0' });
    repeated.append('tags', 'backend');
    repeated.append('tags', 'infra');
    repeated.append('tags', 'BACKEND');
    const repeatedResponse = await app.inject({ method: 'GET', url: `/api/v1/posts?${repeated}` });
    expect(repeatedResponse.statusCode).toBe(200);
    expect(repeatedResponse.json().pagination.total).toBe(2);
    expect(new Set(repeatedResponse.json().posts.map((post: any) => post.id))).toEqual(new Set([
      postId['encoded-search-backend'], postId['encoded-search-infra'],
    ]));
    expect(repeatedResponse.json().posts).toHaveLength(2);
  });

  it('detached view counter accumulates in-memory and flushes to database without locking posts', async () => {
    // Read post multiple times
    await app.inject({ method: 'GET', url: `/api/v1/posts/${publishedPostId}` });
    await app.inject({ method: 'GET', url: `/api/v1/posts/${publishedPostId}` });
    await app.inject({ method: 'GET', url: `/api/v1/posts/${publishedPostId}` });

    // Assert pending in memory
    expect(viewCounter.getPendingCount(publishedPostId)).toBe(3);

    // Trigger flush
    const flushedCount = await viewCounter.flush();
    expect(flushedCount).toBe(1);
    expect(viewCounter.getPendingCount(publishedPostId)).toBe(0);

    // Verify row in post_view_counts
    const [viewRow] = await db
      .select()
      .from(postViewCounts)
      .where(eq(postViewCounts.postId, publishedPostId));

    expect(viewRow).toBeDefined();
    expect(Number(viewRow.totalViews)).toBe(3);
  });

  it('rejects publication before an approved review checkpoint exists', async () => {
    // Moderator logs in via SSO
    const modLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sso/callback',
      payload: {
        provider: 'oidc',
        sub: 'mod-sub-1',
        email: 'bob.mod@corp.com',
        roles: ['moderator'],
      },
    });
    const modSession = modLogin.cookies.find((c: any) => c.name === 'blogger_session')?.value;
    const modCsrf = modLogin.json().csrfToken;

    // Publish the draft post
    const pubRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${draftPostId}/publish`,
      headers: {
        cookie: `blogger_session=${modSession}`,
        'x-csrf-token': modCsrf,
      },
    });

    expect(pubRes.statusCode).toBe(409);
    expect(pubRes.json().message).toContain('published after approval');

    // Verify row in post_versions
    const [savedVersion] = await db
      .select()
      .from(postVersions)
      .where(eq(postVersions.postId, draftPostId));

    expect(savedVersion).toBeUndefined();
  });
});
