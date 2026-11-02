import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { createApiApp } from '../src/app.js';
import { AuthService } from '../src/services/auth.js';
import { users, posts, postCollaborators, personalAccessTokens } from '../src/db/schema.js';
import { createAuthHooks } from '../../collab/src/auth/hooks.js';
import type { Database } from '../src/db/index.js';

const SECRET = 'collab-capability-session-secret-32-characters';
const ORIGIN = 'https://glyphroom.example.com';

describe('production API–collab capability contract', () => {
  let db: Database;
  let app: Awaited<ReturnType<typeof createApiApp>>['app'];
  let close: () => Promise<void>;
  let apiUrl: string;
  const postId = randomUUID();
  const identities = new Map<string, { id: string; cookie: string }>();
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    db = createInMemoryDatabase().db;
    const auth = new AuthService(db, SECRET);
    for (const [name, role] of [['author', 'author'], ['admin', 'admin'], ['editor', 'reader'], ['viewer', 'reader'],
      ['reviewer', 'moderator'], ['unrelated', 'reader']] as const) {
      const [user] = await db.insert(users).values({ email: `${name}@capability.test`, fullName: name, role }).returning();
      identities.set(name, { id: user.id, cookie: `blogger_session=${auth.createSessionToken(user)}` });
    }
    await db.insert(posts).values({ id: postId, slug: 'capability-contract', title: 'Capability contract',
      authorId: identities.get('author')!.id, status: 'in_review', yjsState: Buffer.from([0, 0]), workingMarkdown: 'SECRET' });
    await db.insert(postCollaborators).values([
      { postId, userId: identities.get('editor')!.id, permission: 'edit' },
      { postId, userId: identities.get('viewer')!.id, permission: 'view' },
    ]);
    for (const [name, scopes, extra] of [
      ['edit', ['post:edit'], {}], ['read', ['post:read'], {}], ['suggest', ['post:read', 'post:suggest'], {}],
      ['revoked', ['post:edit'], { revokedAt: new Date() }], ['expired', ['post:edit'], { expiresAt: new Date(0) }],
    ] as const) {
      const token = `eb_pat_${randomUUID().replaceAll('-', '')}`;
      tokens[name] = token;
      await db.insert(personalAccessTokens).values({ name, userId: identities.get('author')!.id,
        tokenHash: createHash('sha256').update(token).digest('hex'), scopes: [...scopes], ...extra });
    }
    const instance = await createApiApp({ db, sessionSecret: SECRET });
    app = instance.app;
    close = instance.close;
    apiUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  });
  afterAll(async () => { await close?.(); });

  function authenticate(credentials: { cookie?: string; token?: string }, documentName = `post-${postId}`) {
    return createAuthHooks({ apiUrl, allowedOrigins: [ORIGIN] }).onAuthenticate({
      token: credentials.token, requestHeaders: { origin: ORIGIN, cookie: credentials.cookie },
      documentName, context: {}, connectionConfig: { readOnly: true },
    } as any);
  }

  it('serves the exact body-free edit capability from the registered production route', async () => {
    for (const name of ['author', 'admin', 'editor']) {
      const user = identities.get(name)!;
      const response = await app.inject({ url: `/api/v1/posts/${postId}/collab-access`, headers: { cookie: user.cookie } });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({ success: true, postId, user: { id: user.id,
        role: name === 'editor' ? 'reader' : name, name }, capabilities: { edit: true } });
      expect(response.body).not.toContain('SECRET');
      const result = await authenticate({ cookie: user.cookie });
      expect(result).toMatchObject({ documentName: `post-${postId}`, user: { id: user.id, permissions: ['edit'] } });
    }
  });

  it('denies viewers, reviewers, unrelated identities, missing credentials and forged role tokens', async () => {
    for (const name of ['viewer', 'reviewer', 'unrelated']) {
      await expect(authenticate({ cookie: identities.get(name)!.cookie })).rejects.toMatchObject({ statusCode: 403 });
    }
    expect((await app.inject({ url: `/api/v1/posts/${postId}/collab-access` })).statusCode).toBe(401);
    await expect(authenticate({ token: 'token-admin-forged' })).rejects.toMatchObject({ statusCode: 401 });
    const missing = await app.inject({ url: `/api/v1/posts/${randomUUID()}/collab-access`,
      headers: { cookie: identities.get('admin')!.cookie } });
    expect(missing.statusCode).toBe(404);
  });

  it('requires both a live PAT and unrestricted edit scope for raw document access', async () => {
    expect((await authenticate({ token: tokens.edit })).user.id).toBe(identities.get('author')!.id);
    for (const name of ['read', 'suggest', 'revoked', 'expired']) {
      await expect(authenticate({ token: tokens[name] })).rejects.toMatchObject({ statusCode: ['read', 'suggest'].includes(name) ? 403 : 401 });
    }
    await db.delete(postCollaborators).where(eq(postCollaborators.userId, identities.get('editor')!.id));
    await expect(authenticate({ cookie: identities.get('editor')!.cookie })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rechecks current account roles and deactivation rather than trusting old signed session claims', async () => {
    const admin = identities.get('admin')!;
    await db.update(users).set({ role: 'reader' }).where(eq(users.id, admin.id));
    await expect(authenticate({ cookie: admin.cookie })).rejects.toMatchObject({ statusCode: 403 });
    await db.update(users).set({ isActive: false }).where(eq(users.id, identities.get('author')!.id));
    await expect(authenticate({ cookie: identities.get('author')!.cookie })).rejects.toMatchObject({ statusCode: 401 });
    await expect(authenticate({ token: tokens.edit })).rejects.toMatchObject({ statusCode: 401 });
  });
});
