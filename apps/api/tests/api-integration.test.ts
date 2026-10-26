import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { createApiApp } from '../src/app.js';
import { users, posts, postReviews, postVersions } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Database } from '../src/db/index.js';

describe('Fastify REST API End-to-End Integration Suite', () => {
  let db: Database;
  let app: any;
  let close: () => Promise<void>;

  const ADMIN_PASSWORD = 'AdminSecretPass2026!';
  let adminUserId: string;
  let reviewerUserId: string;
  let readerUserId: string;

  beforeEach(async () => {
    const mem = createInMemoryDatabase();
    db = mem.db;

    // Seed test users
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const [admin] = await db
      .insert(users)
      .values({
        email: 'admin@blogger.corp.internal',
        fullName: 'Admin User',
        role: 'admin',
        ssoProvider: 'local',
        passwordHash,
        isActive: true,
      })
      .returning();
    adminUserId = admin.id;

    const breakGlassHash = await bcrypt.hash('admin2026!', 10);
    await db
      .insert(users)
      .values({
        email: 'admin@enterprise-blogger.local',
        fullName: 'Break-Glass System Administrator',
        role: 'admin',
        ssoProvider: 'local',
        passwordHash: breakGlassHash,
        isActive: true,
      });

    const [reviewer] = await db
      .insert(users)
      .values({
        email: 'reviewer@blogger.corp.internal',
        fullName: 'Reviewer Bob',
        role: 'moderator',
        ssoProvider: 'oidc',
        isActive: true,
      })
      .returning();
    reviewerUserId = reviewer.id;

    const [reader] = await db
      .insert(users)
      .values({
        email: 'reader@blogger.corp.internal',
        fullName: 'Reader Charlie',
        role: 'reader',
        ssoProvider: 'oidc',
        isActive: true,
      })
      .returning();
    readerUserId = reader.id;

    const instance = await createApiApp({
      db,
      sessionSecret: 'test-secret-32-chars-long-minimum-length',
    });
    app = instance.app;
    close = instance.close;
    await app.ready();
  });

  afterEach(async () => {
    if (close) {
      await close();
    }
  });

  it('GET /health returns 200 OK', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', service: 'enterprise-blogger-api' });
  });

  it('performs local admin login, receives session cookie and csrfToken', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'admin@blogger.corp.internal',
        password: ADMIN_PASSWORD,
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const body = loginRes.json();
    expect(body.user.email).toBe('admin@blogger.corp.internal');
    expect(body.user.role).toBe('admin');
    expect(body.csrfToken).toBeDefined();

    // Verify session cookie was set
    const cookies = loginRes.cookies;
    const sessionCookie = cookies.find((c: any) => c.name === 'blogger_session');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe('Strict');
  });

  it('enforces CSRF protection on mutating POST requests', async () => {
    // 1. Login to get cookie and csrfToken
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'admin@blogger.corp.internal',
        password: ADMIN_PASSWORD,
      },
    });
    const { csrfToken } = loginRes.json();
    const sessionCookie = loginRes.cookies.find((c: any) => c.name === 'blogger_session')?.value;

    // 2. Attempt mutation WITHOUT CSRF header -> must return 403
    const forbiddenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: {
        cookie: `blogger_session=${sessionCookie}`,
      },
      payload: {
        title: 'Attack Post',
        slug: 'attack-post',
      },
    });
    expect(forbiddenRes.statusCode).toBe(403);
    expect(forbiddenRes.json().message).toContain('CSRF token');

    // 3. Attempt mutation WITH valid CSRF header -> succeeds with 201
    const allowedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: {
        cookie: `blogger_session=${sessionCookie}`,
        'x-csrf-token': csrfToken,
      },
      payload: {
        title: 'Legitimate Admin Post',
        slug: 'legitimate-admin-post',
      },
    });
    expect(allowedRes.statusCode).toBe(201);
    expect(allowedRes.json().post.slug).toBe('legitimate-admin-post');
  });

  it('executes full enterprise publication review lifecycle', async () => {
    // 1. Login as Author via SSO
    const authorLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sso/callback',
      payload: {
        provider: 'oidc',
        sub: 'author-alice-sub',
        email: 'alice.author@blogger.corp.internal',
        name: 'Alice Author',
        roles: ['author'],
      },
    });
    expect(authorLogin.statusCode).toBe(200);
    const authorSession = authorLogin.cookies.find((c: any) => c.name === 'blogger_session')?.value;
    const authorCsrf = authorLogin.json().csrfToken;

    // 2. Author creates post
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: {
        cookie: `blogger_session=${authorSession}`,
        'x-csrf-token': authorCsrf,
      },
      payload: {
        title: 'Architecture Overview 2026',
        slug: 'architecture-overview-2026',
      },
    });
    expect(postRes.statusCode).toBe(201);
    const post = postRes.json().post;
    expect(post.status).toBe('draft');

    // 3. Flush working content, then submit post for review
    await db.update(posts).set({ workingMarkdown: '# Pinned review content' }).where(eq(posts.id, post.id));
    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post.id}/submit-review`,
      headers: {
        cookie: `blogger_session=${authorSession}`,
        'x-csrf-token': authorCsrf,
      },
    });
    expect(submitRes.statusCode).toBe(200);
    expect(submitRes.json().post.status).toBe('in_review');
    const submittedVersionId = submitRes.json().submittedVersion.id;
    expect(submitRes.json().submittedVersion.triggerReason).toBe('review_submission');

    // Working content may continue to change, but the review remains pinned.
    await db.update(posts).set({ workingMarkdown: '# Mutable post-review edit' }).where(eq(posts.id, post.id));

    // 4. Author tries to approve their own post -> must be strictly rejected (403)
    const selfApproveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post.id}/reviews`,
      headers: {
        cookie: `blogger_session=${authorSession}`,
        'x-csrf-token': authorCsrf,
      },
      payload: {
        decision: 'approved',
        notes: 'I approve my own post!',
      },
    });
    expect(selfApproveRes.statusCode).toBe(403);
    expect(selfApproveRes.json().message).toContain('Author cannot review their own post');

    // 5. Moderator logs in via SSO
    const modLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sso/callback',
      payload: {
        provider: 'oidc',
        sub: 'reviewer-bob-sub',
        email: 'reviewer@blogger.corp.internal',
        name: 'Reviewer Bob',
        roles: ['moderator'],
      },
    });
    const modSession = modLogin.cookies.find((c: any) => c.name === 'blogger_session')?.value;
    const modCsrf = modLogin.json().csrfToken;

    // 6. A changes-requested review returns the post to draft.
    const changesRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post.id}/reviews`,
      headers: {
        cookie: `blogger_session=${modSession}`,
        'x-csrf-token': modCsrf,
      },
      payload: { decision: 'changes_requested', notes: 'Please revise.' },
    });
    expect(changesRes.statusCode).toBe(201);
    expect(changesRes.json().review.submittedVersionId).toBe(submittedVersionId);
    const draftAfterChanges = await db.select({ status: posts.status }).from(posts).where(eq(posts.id, post.id));
    expect(draftAfterChanges[0].status).toBe('draft');

    // 7. Resubmit the revised draft and approve that new checkpoint.
    await db.update(posts).set({ workingMarkdown: '# Pinned approved content' }).where(eq(posts.id, post.id));
    const resubmitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post.id}/submit-review`,
      headers: { cookie: `blogger_session=${authorSession}`, 'x-csrf-token': authorCsrf },
    });
    expect(resubmitRes.statusCode).toBe(200);
    const approvedSubmittedVersionId = resubmitRes.json().submittedVersion.id;

    // 8. Moderator reviews and approves the post
    const reviewRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post.id}/reviews`,
      headers: {
        cookie: `blogger_session=${modSession}`,
        'x-csrf-token': modCsrf,
      },
      payload: {
        decision: 'approved',
        notes: 'Thorough architecture, approved for enterprise publication.',
      },
    });
    expect(reviewRes.statusCode).toBe(201);
    expect(reviewRes.json().review.submittedVersionId).toBe(approvedSubmittedVersionId);

    // 9. Moderator publishes the pinned submitted version, not mutable working content
    const publishRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post.id}/publish`,
      headers: {
        cookie: `blogger_session=${modSession}`,
        'x-csrf-token': modCsrf,
      },
    });
    expect(publishRes.statusCode).toBe(200);
    expect(publishRes.json().post.status).toBe('published');
    expect(publishRes.json().post.publishedVersionId).toBe(approvedSubmittedVersionId);
    expect(publishRes.json().post.publishedMarkdown).toBe('# Pinned approved content');
    expect(publishRes.json().post.publishedMarkdown).not.toContain('Mutable post-review edit');

    const reviews = await db.select().from(postReviews).where(eq(postReviews.postId, post.id));
    expect(reviews).toHaveLength(2);
    const versions = await db.select().from(postVersions).where(eq(postVersions.postId, post.id));
    expect(versions.filter((version) => version.triggerReason === 'review_submission')).toHaveLength(2);

    // 10. Public / Reader user can now view the published post
    const readerRes = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${post.id}`,
    });
    expect(readerRes.statusCode).toBe(200);
    expect(readerRes.json().post.id).toBe(post.id);
  });

  it('manages Personal Access Tokens (PATs) and verifies audit chain integrity', async () => {
    // 1. Admin login
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'admin@blogger.corp.internal',
        password: ADMIN_PASSWORD,
      },
    });
    const { csrfToken } = loginRes.json();
    const session = loginRes.cookies.find((c: any) => c.name === 'blogger_session')?.value;

    // 2. Create PAT for agent
    const patRes = await app.inject({
      method: 'POST',
      url: '/api/v1/pats',
      headers: {
        cookie: `blogger_session=${session}`,
        'x-csrf-token': csrfToken,
      },
      payload: {
        name: 'Claude Desktop Suggestion Agent',
        scopes: ['post:read', 'post:suggest'],
        expiresInDays: 30,
      },
    });
    expect(patRes.statusCode).toBe(201);
    const patBody = patRes.json();
    expect(patBody.secret).toMatch(/^eb_pat_[a-f0-9]{64}$/);
    expect(patBody.token.name).toBe('Claude Desktop Suggestion Agent');

    // 3. Verify audit chain verification endpoint (Admin only)
    const auditVerifyRes = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-logs/verify',
      headers: {
        cookie: `blogger_session=${session}`,
      },
    });
    expect(auditVerifyRes.statusCode).toBe(200);
    const auditVerify = auditVerifyRes.json();
    expect(auditVerify.valid).toBe(true);
    expect(auditVerify.totalRows).toBeGreaterThanOrEqual(1);

    // 4. Revoke PAT
    const revokeRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/pats/${patBody.token.id}`,
      headers: {
        cookie: `blogger_session=${session}`,
        'x-csrf-token': csrfToken,
      },
    });
    expect(revokeRes.statusCode).toBe(200);
    expect(revokeRes.json().success).toBe(true);
  });

  it('authenticates break-glass admin (admin@enterprise-blogger.local) and returns csrfToken', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'admin@enterprise-blogger.local',
        password: 'admin2026!',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe('admin@enterprise-blogger.local');
    expect(body.user.role).toBe('admin');
    expect(body.csrfToken).toBeDefined();
    expect(typeof body.csrfToken).toBe('string');
  });

  it('verifies SHA-256 hash chain via /api/v1/audit/verify route alias', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'admin@enterprise-blogger.local',
        password: 'admin2026!',
      },
    });
    const sessionCookie = loginRes.cookies.find((c: any) => c.name === 'blogger_session')?.value;

    const verifyRes = await app.inject({
      method: 'GET',
      url: '/api/v1/audit/verify',
      headers: {
        cookie: `blogger_session=${sessionCookie}`,
      },
    });

    expect(verifyRes.statusCode).toBe(200);
    const verifyBody = verifyRes.json();
    expect(verifyBody.valid).toBe(true);
    expect(verifyBody.totalRows).toBeGreaterThanOrEqual(1);
  });

  it('allows author or admin to delete a post and cascades deletions', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'admin@enterprise-blogger.local',
        password: 'admin2026!',
      },
    });
    const sessionCookie = loginRes.cookies.find((c: any) => c.name === 'blogger_session')?.value;
    const csrfToken = loginRes.json().csrfToken;

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: {
        cookie: `blogger_session=${sessionCookie}`,
        'x-csrf-token': csrfToken,
      },
      payload: {
        title: 'Post To Delete',
        slug: 'post-to-delete',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const postId = createRes.json().post.id;

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/posts/${postId}`,
      headers: {
        cookie: `blogger_session=${sessionCookie}`,
        'x-csrf-token': csrfToken,
      },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().success).toBe(true);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${postId}`,
      headers: {
        cookie: `blogger_session=${sessionCookie}`,
      },
    });
    expect(getRes.statusCode).toBe(404);
  });

  it('persists post tags across create, update, dedicated tag routes, and reads', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'admin@enterprise-blogger.local',
        password: 'admin2026!',
      },
    });
    const sessionCookie = loginRes.cookies.find((c: any) => c.name === 'blogger_session')?.value;
    const csrfToken = loginRes.json().csrfToken;
    const headers = {
      cookie: `blogger_session=${sessionCookie}`,
      'x-csrf-token': csrfToken,
    };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers,
      payload: {
        title: 'Tagged Post',
        slug: 'tagged-post',
        tags: ['Engineering', 'collaborative', 'engineering'],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json().post;
    expect(created.tags).toEqual(['engineering', 'collaborative']);

    const readRes = await app.inject({ method: 'GET', url: `/api/v1/posts/${created.id}`, headers });
    expect(readRes.statusCode).toBe(200);
    expect(readRes.json().post.tags).toEqual(['engineering', 'collaborative']);

    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${created.id}`,
      headers,
      payload: { tags: ['platform'] },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().post.tags).toEqual(['platform']);

    const dedicatedUpdateRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/posts/${created.id}/tags`,
      headers,
      payload: { tags: ['docs', 'platform'] },
    });
    expect(dedicatedUpdateRes.statusCode).toBe(200);
    expect(dedicatedUpdateRes.json().tags).toEqual(['docs', 'platform']);

    const dedicatedReadRes = await app.inject({
      method: 'GET',
      url: `/api/v1/posts/${created.id}/tags`,
      headers,
    });
    expect(dedicatedReadRes.statusCode).toBe(200);
    expect(dedicatedReadRes.json().tags).toEqual(['docs', 'platform']);

    const listRes = await app.inject({ method: 'GET', url: '/api/v1/posts', headers });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().posts.find((post: any) => post.id === created.id).tags).toEqual(['docs', 'platform']);
  });
});
