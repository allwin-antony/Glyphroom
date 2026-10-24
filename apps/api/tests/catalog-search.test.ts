import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { createApiApp } from '../src/app.js';
import { users, posts, postVersions, postViewCounts } from '../src/db/schema.js';
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

  it('publication creates discrete version snapshot in post_versions with published_markdown', async () => {
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

    expect(pubRes.statusCode).toBe(200);
    const body = pubRes.json();
    expect(body.post.status).toBe('published');
    expect(body.version).toBeDefined();
    expect(body.version.versionNumber).toBe(1);
    expect(body.version.triggerReason).toBe('publication');

    // Verify row in post_versions
    const [savedVersion] = await db
      .select()
      .from(postVersions)
      .where(eq(postVersions.postId, draftPostId));

    expect(savedVersion).toBeDefined();
    expect(savedVersion.versionNumber).toBe(1);
    expect(savedVersion.triggerReason).toBe('publication');
  });
});
