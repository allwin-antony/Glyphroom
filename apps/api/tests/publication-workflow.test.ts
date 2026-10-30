import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { createApiApp } from '../src/app.js';
import { users, posts, postVersions, postReviews } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Database } from '../src/db/index.js';
import type { CollabService } from '../src/services/collab.js';

describe('Track 1: Live Checkpoints, Reversion, and Publication Workflow (B03-B07, B11)', () => {
  let db: Database;
  let app: any;
  let close: () => Promise<void>;
  let mockCollabService: CollabService;

  const AUTHOR_PASS = 'AuthorPass2026!';
  const MOD_PASS = 'ModPass2026!';
  let authorId: string;
  let authorCookie: string;
  let authorCsrf: string;
  let modId: string;
  let modCookie: string;
  let modCsrf: string;

  beforeEach(async () => {
    const mem = createInMemoryDatabase();
    db = mem.db;

    const authorHash = await bcrypt.hash(AUTHOR_PASS, 10);
    const [author] = await db
      .insert(users)
      .values({
        email: 'alice.author@blogger.corp.internal',
        fullName: 'Alice Author',
        role: 'author',
        ssoProvider: 'local',
        passwordHash: authorHash,
        isActive: true,
      })
      .returning();
    authorId = author.id;

    const modHash = await bcrypt.hash(MOD_PASS, 10);
    const [mod] = await db
      .insert(users)
      .values({
        email: 'bob.moderator@blogger.corp.internal',
        fullName: 'Bob Moderator',
        role: 'moderator',
        ssoProvider: 'local',
        passwordHash: modHash,
        isActive: true,
      })
      .returning();
    modId = mod.id;

    mockCollabService = {
      flushDocument: vi.fn().mockResolvedValue({
        inMemory: true,
        yjsState: new Uint8Array([1, 2, 3, 4]),
        workingMarkdown: '# Live Millisecond Flushed Content\n\nCaptured directly from memory.',
      }),
      restoreDocument: vi.fn().mockResolvedValue(true),
      tombstoneDocument: vi.fn().mockResolvedValue(true),
    } as unknown as CollabService;

    const instance = await createApiApp({
      db,
      sessionSecret: 'test-secret-32-chars-long-minimum-length',
      collabService: mockCollabService,
    });
    app = instance.app;
    close = instance.close;
    await app.ready();

    // Login author
    const authorLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'alice.author@blogger.corp.internal', password: AUTHOR_PASS },
    });
    authorCookie = authorLogin.cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
    authorCsrf = authorLogin.json().csrfToken;

    // Login moderator
    const modLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'bob.moderator@blogger.corp.internal', password: MOD_PASS },
    });
    modCookie = modLogin.cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
    modCsrf = modLogin.json().csrfToken;
  });

  afterEach(async () => {
    if (close) await close();
  });

  it('B03: submit-review flushes live collab room and pins submittedVersionId', async () => {
    // 1. Create draft post
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { cookie: authorCookie, 'x-csrf-token': authorCsrf },
      payload: {
        title: 'Mission Critical RFC',
        slug: 'mission-critical-rfc',
        content: '# Stale Persisted Content',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const postId = createRes.json().post.id;

    // 2. Submit for review
    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${postId}/submit-review`,
      headers: { cookie: authorCookie, 'x-csrf-token': authorCsrf },
    });
    expect(submitRes.statusCode).toBe(200);

    // Verify collab flush was invoked
    expect(mockCollabService.flushDocument).toHaveBeenCalledWith(postId);

    const submitBody = submitRes.json();
    expect(submitBody.post.status).toBe('in_review');
    expect(submitBody.post.submittedVersionId).toBeDefined();
    expect(submitBody.submittedVersion.markdownSnapshot).toBe(
      '# Live Millisecond Flushed Content\n\nCaptured directly from memory.'
    );

    // Verify GET /:id returns the pinned submittedVersion
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${postId}`,
      headers: { cookie: authorCookie },
    });
    expect(getRes.statusCode).toBe(200);
    const postDetails = getRes.json().post;
    expect(postDetails.submittedVersion).toBeDefined();
    expect(postDetails.submittedVersion.versionNumber).toBe(1);
    expect(postDetails.submittedVersion.markdownSnapshot).toBe(
      '# Live Millisecond Flushed Content\n\nCaptured directly from memory.'
    );
  });

  it('B04 & B05: Mutable author edits after submission do not pollute published version', async () => {
    // 1. Create and submit post
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { cookie: authorCookie, 'x-csrf-token': authorCsrf },
      payload: { title: 'Security Advisory', slug: 'sec-advisory', content: 'Initial Content' },
    });
    const postId = createRes.json().post.id;

    await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${postId}/submit-review`,
      headers: { cookie: authorCookie, 'x-csrf-token': authorCsrf },
    });

    // 2. Author mutates working content directly in database while in review
    await db.update(posts).set({
      workingMarkdown: '# Malicious Unreviewed Post-Submission Changes',
    }).where(eq(posts.id, postId));

    // 3. Moderator reviews and approves the submitted checkpoint
    const reviewRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${postId}/reviews`,
      headers: { cookie: modCookie, 'x-csrf-token': modCsrf },
      payload: { decision: 'approved', notes: 'Approved checkpoint.' },
    });
    expect(reviewRes.statusCode).toBe(201);

    // 4. Publish post
    const pubRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${postId}/publish`,
      headers: { cookie: modCookie, 'x-csrf-token': modCsrf },
    });
    expect(pubRes.statusCode).toBe(200);
    const publishedPost = pubRes.json().post;

    // Published content MUST be the approved submitted version, NOT the later working changes!
    expect(publishedPost.status).toBe('published');
    expect(publishedPost.publishedMarkdown).toBe(
      '# Live Millisecond Flushed Content\n\nCaptured directly from memory.'
    );
    expect(publishedPost.publishedMarkdown).not.toContain('Malicious Unreviewed');
  });

  it('B05: PATCH /:id reverts in_review and approved posts to draft and resets submittedVersionId', async () => {
    // 1. Create and submit post
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { cookie: authorCookie, 'x-csrf-token': authorCsrf },
      payload: { title: 'Draft Reversion Test', slug: 'revert-test', content: 'Testing revert' },
    });
    const postId = createRes.json().post.id;

    await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${postId}/submit-review`,
      headers: { cookie: authorCookie, 'x-csrf-token': authorCsrf },
    });

    // 2. Author reverts to draft
    const revertRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${postId}`,
      headers: { cookie: authorCookie, 'x-csrf-token': authorCsrf },
      payload: { status: 'draft' },
    });
    expect(revertRes.statusCode).toBe(200);
    expect(revertRes.json().post.status).toBe('draft');

    const [dbPost] = await db.select().from(posts).where(eq(posts.id, postId));
    expect(dbPost.status).toBe('draft');
    expect(dbPost.submittedVersionId).toBeNull();
  });

  it('B11: PATCH /:id returns 409 Conflict on slug collisions', async () => {
    // Create first post
    await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { cookie: authorCookie, 'x-csrf-token': authorCsrf },
      payload: { title: 'Alpha Post', slug: 'slug-alpha', content: 'Alpha content' },
    });

    // Create second post
    const post2 = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { cookie: authorCookie, 'x-csrf-token': authorCsrf },
      payload: { title: 'Beta Post', slug: 'slug-beta', content: 'Beta content' },
    });
    const post2Id = post2.json().post.id;

    // Attempt renaming post2 to 'slug-alpha'
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${post2Id}`,
      headers: { cookie: authorCookie, 'x-csrf-token': authorCsrf },
      payload: { slug: 'slug-alpha' },
    });
    expect(patchRes.statusCode).toBe(409);
    expect(patchRes.json().message).toContain('Slug "slug-alpha" is already in use');
  });

  it('B06: Live version restore invokes collab room restore and creates safety checkpoint', async () => {
    // 1. Create and submit post (creates v1)
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { cookie: authorCookie, 'x-csrf-token': authorCsrf },
      payload: { title: 'Restore Test', slug: 'restore-test', content: 'Initial version' },
    });
    const postId = createRes.json().post.id;

    const subRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${postId}/submit-review`,
      headers: { cookie: authorCookie, 'x-csrf-token': authorCsrf },
    });
    const v1Id = subRes.json().submittedVersion.id;

    // 2. Author mutates content in draft
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${postId}`,
      headers: { cookie: authorCookie, 'x-csrf-token': authorCsrf },
      payload: { status: 'draft' },
    });

    // 3. Restore v1
    const restoreRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${postId}/versions/${v1Id}/restore`,
      headers: { cookie: authorCookie, 'x-csrf-token': authorCsrf },
    });
    expect(restoreRes.statusCode).toBe(200);

    // Verify collab restore was invoked with snapshot
    expect(mockCollabService.restoreDocument).toHaveBeenCalledWith(
      postId,
      expect.any(Uint8Array)
    );

    // Verify safety checkpoint v2 was created
    const versions = await db.select().from(postVersions).where(eq(postVersions.postId, postId));
    expect(versions.length).toBe(2);
    expect(versions.some((v) => v.versionNumber === 2 && v.triggerReason === 'hourly_checkpoint')).toBe(true);
  });

  it('B06: DELETE /:id tombstones document on collab server to prevent ghost resurrection', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { cookie: authorCookie, 'x-csrf-token': authorCsrf },
      payload: { title: 'Tombstone Target', slug: 'tombstone-target', content: 'To be deleted' },
    });
    const postId = createRes.json().post.id;

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/posts/${postId}`,
      headers: { cookie: authorCookie, 'x-csrf-token': authorCsrf },
    });
    expect(delRes.statusCode).toBe(200);

    // Verify tombstone was called on collab service
    expect(mockCollabService.tombstoneDocument).toHaveBeenCalledWith(postId);

    // Verify post is gone from DB
    const [dbPost] = await db.select().from(posts).where(eq(posts.id, postId));
    expect(dbPost).toBeUndefined();
  });
});
