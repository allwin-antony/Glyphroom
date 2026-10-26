import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { createApiApp } from '../src/app.js';
import { users, spaces, spaceMembers, posts, personalAccessTokens } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';

describe('Spaces, Access Model & MCP Bearer PAT Integration Suite', () => {
  let appInstance: any;
  let db: any;
  let close: any;

  // Test users
  let adminUser: any;
  let maintainerUser: any;
  let authorUser: any;
  let viewerUser: any;
  let externalUser: any;

  let testSpace: any;

  beforeAll(async () => {
    const mem = createInMemoryDatabase();
    db = mem.db;

    appInstance = await createApiApp({ db, logger: false });
    close = appInstance.close;

    // Create test accounts
    const [adm] = await db
      .insert(users)
      .values({
        email: `admin-${Date.now()}@corp.local`,
        fullName: 'Admin User',
        role: 'admin',
      })
      .returning();
    adminUser = adm;

    const [maint] = await db
      .insert(users)
      .values({
        email: `maintainer-${Date.now()}@corp.local`,
        fullName: 'Arjun Maintainer',
        role: 'author',
      })
      .returning();
    maintainerUser = maint;

    const [auth] = await db
      .insert(users)
      .values({
        email: `author-${Date.now()}@corp.local`,
        fullName: 'Priya Author',
        role: 'author',
      })
      .returning();
    authorUser = auth;

    const [view] = await db
      .insert(users)
      .values({
        email: `viewer-${Date.now()}@corp.local`,
        fullName: 'Rahul Viewer',
        role: 'reader',
      })
      .returning();
    viewerUser = view;

    const [ext] = await db
      .insert(users)
      .values({
        email: `external-${Date.now()}@corp.local`,
        fullName: 'External Colleague',
        role: 'author',
      })
      .returning();
    externalUser = ext;
  });

  afterAll(async () => {
    if (close) await close();
  });

  function createSessionCookie(user: any) {
    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 86400,
    };
    const secret = process.env.SESSION_SECRET || 'enterprise-blogger-session-secret-key-32b-min';
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    const token = `${encoded}.${signature}`;
    const csrf = crypto.createHmac('sha256', secret).update(`csrf:${token}`).digest('hex');
    return {
      cookie: `blogger_session=${token}`,
      csrf,
    };
  }

  it('1. Admin creates Space and assigns initial maintainer', async () => {
    const admAuth = createSessionCookie(adminUser);

    const res = await appInstance.app.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: {
        cookie: admAuth.cookie,
        'x-csrf-token': admAuth.csrf,
      },
      payload: {
        name: 'Payments Revamp',
        slug: `payments-revamp-${Date.now()}`,
        description: 'Core banking payment infrastructure refactor',
        initialMaintainerId: maintainerUser.id,
      },
    });

    expect(res.statusCode).toBe(201);
    const data = JSON.parse(res.body);
    expect(data.space).toBeDefined();
    expect(data.space.name).toBe('Payments Revamp');
    testSpace = data.space;

    // Verify Arjun is assigned as Owner in space_members
    const [membership] = await db
      .select()
      .from(spaceMembers)
      .where(eq(spaceMembers.spaceId, testSpace.id));
    expect(membership.userId).toBe(maintainerUser.id);
    expect(membership.role).toBe('owner');
  });

  it('2. Space maintainer adds members: Priya as Author, Rahul as Viewer', async () => {
    const maintAuth = createSessionCookie(maintainerUser);

    // Add Author
    const res1 = await appInstance.app.inject({
      method: 'POST',
      url: `/api/v1/spaces/${testSpace.id}/members`,
      headers: {
        cookie: maintAuth.cookie,
        'x-csrf-token': maintAuth.csrf,
      },
      payload: {
        userId: authorUser.id,
        role: 'author',
      },
    });
    expect(res1.statusCode).toBe(201);

    // Add Viewer
    const res2 = await appInstance.app.inject({
      method: 'POST',
      url: `/api/v1/spaces/${testSpace.id}/members`,
      headers: {
        cookie: maintAuth.cookie,
        'x-csrf-token': maintAuth.csrf,
      },
      payload: {
        userId: viewerUser.id,
        role: 'viewer',
      },
    });
    expect(res2.statusCode).toBe(201);

    // List members
    const listRes = await appInstance.app.inject({
      method: 'GET',
      url: `/api/v1/spaces/${testSpace.id}/members`,
      headers: { cookie: maintAuth.cookie },
    });
    expect(listRes.statusCode).toBe(200);
    const members = JSON.parse(listRes.body).members;
    expect(members.length).toBe(3);
  });

  it('2b. Space owner can update and archive the Space, but cannot remove the last owner', async () => {
    const maintAuth = createSessionCookie(maintainerUser);

    const updateRes = await appInstance.app.inject({
      method: 'PATCH',
      url: `/api/v1/spaces/${testSpace.id}`,
      headers: { cookie: maintAuth.cookie, 'x-csrf-token': maintAuth.csrf },
      payload: {
        name: 'Payments Revamp Platform',
        description: 'Updated team workspace description',
      },
    });

    expect(updateRes.statusCode).toBe(200);
    expect(JSON.parse(updateRes.body).space.name).toBe('Payments Revamp Platform');

    const removeOwnerRes = await appInstance.app.inject({
      method: 'DELETE',
      url: `/api/v1/spaces/${testSpace.id}/members/${maintainerUser.id}`,
      headers: { cookie: maintAuth.cookie, 'x-csrf-token': maintAuth.csrf },
    });

    expect(removeOwnerRes.statusCode).toBe(409);

    const archiveRes = await appInstance.app.inject({
      method: 'PATCH',
      url: `/api/v1/spaces/${testSpace.id}`,
      headers: { cookie: maintAuth.cookie, 'x-csrf-token': maintAuth.csrf },
      payload: { isArchived: true },
    });

    expect(archiveRes.statusCode).toBe(200);
    expect(JSON.parse(archiveRes.body).space.isArchived).toBe(true);
  });

  it('3. User Space Requests: Non-admin can request space, Admin can approve it', async () => {
    const authorAuth = createSessionCookie(authorUser);
    const slug = `cloud-infra-${Date.now()}`;

    // Submit request
    const reqRes = await appInstance.app.inject({
      method: 'POST',
      url: '/api/v1/spaces/requests',
      headers: {
        cookie: authorAuth.cookie,
        'x-csrf-token': authorAuth.csrf,
      },
      payload: {
        name: 'Cloud Infrastructure',
        slug,
        reason: 'Kubernetes cluster operations',
      },
    });
    expect(reqRes.statusCode).toBe(201);
    const reqData = JSON.parse(reqRes.body);

    // Admin approves request
    const admAuth = createSessionCookie(adminUser);
    const approveRes = await appInstance.app.inject({
      method: 'PATCH',
      url: `/api/v1/spaces/requests/${reqData.request.id}`,
      headers: {
        cookie: admAuth.cookie,
        'x-csrf-token': admAuth.csrf,
      },
      payload: { action: 'approve' },
    });
    expect(approveRes.statusCode).toBe(200);
    const approveData = JSON.parse(approveRes.body);
    expect(approveData.space.name).toBe('Cloud Infrastructure');
  });

  it('4. Separation of Duty: Author cannot self-promote team space page, Maintainer can', async () => {
    const authorAuth = createSessionCookie(authorUser);
    const maintAuth = createSessionCookie(maintainerUser);

    // Priya creates page in Payments Revamp space
    const createRes = await appInstance.app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: {
        cookie: authorAuth.cookie,
        'x-csrf-token': authorAuth.csrf,
      },
      payload: {
        title: 'Project Overview & Architecture',
        slug: `proj-overview-${Date.now()}`,
        spaceId: testSpace.id,
        visibility: 'space',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const post = JSON.parse(createRes.body).post;

    // Priya attempts to promote to Company Library -> REJECTED (403)
    const selfPromoteRes = await appInstance.app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post.id}/promote`,
      headers: {
        cookie: authorAuth.cookie,
        'x-csrf-token': authorAuth.csrf,
      },
    });
    expect(selfPromoteRes.statusCode).toBe(403);

    // Maintainer promotes to Company Library -> SUCCEEDS (200)
    const maintPromoteRes = await appInstance.app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post.id}/promote`,
      headers: {
        cookie: maintAuth.cookie,
        'x-csrf-token': maintAuth.csrf,
      },
    });
    expect(maintPromoteRes.statusCode).toBe(200);

    // Verify post is now marked promoted
    const checkRes = await appInstance.app.inject({
      method: 'GET',
      url: `/api/v1/posts/${post.id}`,
      headers: { cookie: authorAuth.cookie },
    });
    expect(JSON.parse(checkRes.body).post.isPromoted).toBe(true);
  });

  it('5. Standalone Page Promotion: Author CAN self-promote an independent document', async () => {
    const authorAuth = createSessionCookie(authorUser);

    // Priya creates independent post (no spaceId)
    const createRes = await appInstance.app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: {
        cookie: authorAuth.cookie,
        'x-csrf-token': authorAuth.csrf,
      },
      payload: {
        title: 'Personal Tech Notes',
        slug: `tech-notes-${Date.now()}`,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const post = JSON.parse(createRes.body).post;

    // Author promotes independent post -> SUCCEEDS (200)
    const promoteRes = await appInstance.app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post.id}/promote`,
      headers: {
        cookie: authorAuth.cookie,
        'x-csrf-token': authorAuth.csrf,
      },
    });
    expect(promoteRes.statusCode).toBe(200);
  });

  it('6. Page Visibility (invited_only) Isolation: Space Viewer cannot see invited_only page', async () => {
    const authorAuth = createSessionCookie(authorUser);
    const viewerAuth = createSessionCookie(viewerUser);
    const maintAuth = createSessionCookie(maintainerUser);

    // Priya creates restricted invited_only page in Payments Revamp
    const createRes = await appInstance.app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: {
        cookie: authorAuth.cookie,
        'x-csrf-token': authorAuth.csrf,
      },
      payload: {
        title: 'Confidential Security Audit',
        slug: `sec-audit-${Date.now()}`,
        spaceId: testSpace.id,
        visibility: 'invited_only',
      },
    });
    const post = JSON.parse(createRes.body).post;

    // Viewer (Rahul) tries to read -> 403 Forbidden
    const viewerRes = await appInstance.app.inject({
      method: 'GET',
      url: `/api/v1/posts/${post.id}`,
      headers: { cookie: viewerAuth.cookie },
    });
    expect(viewerRes.statusCode).toBe(403);

    // Maintainer (Arjun) tries to read -> 200 OK (Maintainers always have access)
    const maintRes = await appInstance.app.inject({
      method: 'GET',
      url: `/api/v1/posts/${post.id}`,
      headers: { cookie: maintAuth.cookie },
    });
    expect(maintRes.statusCode).toBe(200);
  });

  it('7. MCP Bearer PAT Integration: Allows external tool/MCP client to create post with Bearer token', async () => {
    // Generate PAT for authorUser
    const patSecret = `eb_pat_${crypto.randomBytes(32).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(patSecret).digest('hex');

    await db.insert(personalAccessTokens).values({
      userId: authorUser.id,
      name: 'Claude Desktop MCP Token',
      tokenHash,
      scopes: ['posts:read', 'posts:write'],
    });

    // Make an API call authenticated purely via Authorization: Bearer <PAT> without any cookies or CSRF
    const res = await appInstance.app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: {
        authorization: `Bearer ${patSecret}`,
      },
      payload: {
        title: 'Written via MCP Integration',
        slug: `mcp-post-${Date.now()}`,
        excerpt: 'Auto-authored post from external model',
      },
    });

    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body).post;
    expect(created.title).toBe('Written via MCP Integration');
    expect(created.authorId).toBe(authorUser.id);
  });
});
