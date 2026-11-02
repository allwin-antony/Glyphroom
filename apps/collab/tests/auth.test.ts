import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { createAuthHooks, type UserContext } from '../src/auth/hooks.js';
import { createCollabServer, type CollabServerInstance } from '../src/server.js';
import { AuthService } from '../../api/src/services/auth.js';
import { PermissionService } from '../../api/src/services/permissions.js';
import { authPlugin } from '../../api/src/plugins/auth.js';
import { users, posts, postCollaborators, personalAccessTokens } from '../../api/src/db/schema.js';
import { createInMemoryDatabase } from '../../api/tests/helpers/test-db.js';

const postId = '11111111-2222-3333-4444-555555555555';
const room = `post-${postId}`;
const origin = 'https://blog.corp.internal';
const editPat = 'eb_pat_real_edit_fixture';
const readPat = 'eb_pat_real_read_fixture';
const editor: UserContext = { id: 'test-editor', role: 'author', name: 'Test editor', permissions: ['edit'] };

function payload(options: { token?: any; cookie?: string; authorization?: string; origin?: string; room?: string } = {}): any {
  const headers = new Headers();
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.authorization) headers.set('authorization', options.authorization);
  if (options.origin) headers.set('origin', options.origin);
  return { token: options.token, requestHeaders: headers, documentName: options.room ?? room, context: {}, connectionConfig: { readOnly: true } };
}

describe('Authenticated working-document access', () => {
  let api: FastifyInstance;
  let apiUrl: string;
  let pool: any;
  let cookies: Record<string, string>;
  let mode: 'normal' | 'outage' | 'malformed' | 'wrong-room' | 'no-edit' | 'slow';
  let requests: Array<{ cookie?: string; authorization?: string; gatewaySecret?: string }>;
  let collab: CollabServerInstance | undefined;
  const providers: HocuspocusProvider[] = [];

  beforeEach(async () => {
    const fixture = createInMemoryDatabase();
    pool = fixture.pool;
    const db = fixture.db;
    const authService = new AuthService(db, 'auth-test-session-signing-key-not-a-runtime-default');
    const permissions = new PermissionService(db);
    cookies = {};
    const identities = [
      { key: 'editor', role: 'author' as const },
      { key: 'viewer', role: 'reader' as const },
      { key: 'reviewer', role: 'author' as const },
      { key: 'admin', role: 'admin' as const },
      { key: 'invited-editor', role: 'reader' as const },
    ];
    const records: Record<string, typeof users.$inferSelect> = {};
    for (const identity of identities) {
      const [user] = await db.insert(users).values({ id: randomUUID(), email: `${identity.key}@test.internal`, fullName: identity.key, role: identity.role }).returning();
      records[identity.key] = user;
      cookies[identity.key] = `blogger_session=${authService.createSessionToken(user)}`;
    }
    await db.insert(posts).values({ id: postId, slug: 'auth-fixture', title: 'Private working doc', authorId: records.editor.id, yjsState: Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())) });
    await db.insert(postCollaborators).values([
      { postId, userId: records.viewer.id, permission: 'view' },
      { postId, userId: records.reviewer.id, permission: 'review' },
      { postId, userId: records['invited-editor'].id, permission: 'edit' },
    ]);
    for (const [token, scopes, extra] of [
      [editPat, ['read', 'write'], {}],
      [readPat, ['read'], {}],
      ['eb_pat_revoked_fixture', ['write'], { revokedAt: new Date() }],
      ['eb_pat_expired_fixture', ['write'], { expiresAt: new Date(0) }],
    ] as const) {
      await db.insert(personalAccessTokens).values({ userId: records.editor.id, name: token, tokenHash: createHash('sha256').update(token).digest('hex'), scopes: [...scopes], ...extra });
    }

    api = Fastify();
    await api.register(authPlugin, { authService, db });
    mode = 'normal';
    requests = [];
    // Contract fixture for A's forthcoming endpoint, using actual API session/PAT
    // validation and permission resolution, not token-shaped user assertions.
    api.get('/api/v1/posts/:id/collab-access', async (request, reply) => {
      requests.push({ cookie: request.headers.cookie, authorization: request.headers.authorization, gatewaySecret: request.headers['x-gateway-secret'] as string | undefined });
      if (mode === 'outage') return reply.status(503).send({ error: 'Dependency unavailable' });
      if (mode === 'slow') await new Promise((resolve) => setTimeout(resolve, 100));
      if (!request.user) return reply.status(401).send({ error: 'Unauthorized' });
      if (request.isPatAuth && !request.patScopes?.includes('write')) return reply.status(403).send({ error: 'Forbidden' });
      const permission = await permissions.resolvePostPermission({ id: request.user.userId, role: request.user.role }, { postId, authorId: records.editor.id, status: 'draft' });
      if (!permissions.canEdit(permission)) return reply.status(403).send({ error: 'Forbidden' });
      if (mode === 'malformed') return { user: { id: request.user.userId, role: 'admin' } };
      return {
        success: true,
        postId: mode === 'wrong-room' ? randomUUID() : postId,
        user: { id: request.user.userId, role: request.user.role, name: request.user.fullName },
        capabilities: { edit: mode !== 'no-edit' },
      };
    });
    apiUrl = await api.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    providers.splice(0).forEach((provider) => provider.destroy());
    await collab?.destroy();
    collab = undefined;
    await api.close();
    await pool.end();
  });

  function hooks() { return createAuthHooks({ apiUrl, allowedOrigins: [origin] }); }

  it.each(['editor', 'admin', 'invited-editor'])('verifies the signed %s session and per-post edit capability', async (identity) => {
    const data = payload({ cookie: `unrelated=ignored; ${cookies[identity]}`, origin });
    const result = await hooks().onAuthenticate(data);
    expect(result.user.name).toBe(identity);
    expect(data.connectionConfig.readOnly).toBe(false);
    expect(result.user.permissions).toEqual(['edit']);
    expect(requests).toEqual([{ cookie: cookies[identity], authorization: undefined, gatewaySecret: undefined }]);
  });

  it.each(['token', 'header'])('verifies an actual PAT from the %s and never forwards a gateway secret', async (source) => {
    const data = payload(source === 'token' ? { token: editPat } : { authorization: `Bearer ${editPat}` });
    await hooks().onAuthenticate(data);
    expect(data.context.user.name).toBe('editor');
    expect(requests).toEqual([{ cookie: undefined, authorization: `Bearer ${editPat}`, gatewaySecret: undefined }]);
  });

  it.each(['viewer', 'reviewer'])('rejects a verified %s before any working-document load', async (identity) => {
    const data = payload({ cookie: cookies[identity], origin });
    await expect(hooks().onAuthenticate(data)).rejects.toMatchObject({ statusCode: 403 });
    expect(data.context.user).toBeUndefined();
  });

  it.each([readPat, 'eb_pat_revoked_fixture', 'eb_pat_expired_fixture', 'eb_pat_not_registered'])('rejects unauthorized PAT %s', async (token) => {
    await expect(hooks().onAuthenticate(payload({ token }))).rejects.toMatchObject({ statusCode: token === readPat ? 403 : 401 });
  });

  it.each(['token-admin-forged', 'token-author-forged', 'token-moderator-forged', 'token-reader-forged', 'token-reviewer-forged', 'admin', 'author', 'reader'])('does not trust forged role token %s', async (token) => {
    await expect(hooks().onAuthenticate(payload({ token }))).rejects.toMatchObject({ statusCode: 401 });
    expect(requests).toHaveLength(0);
  });

  it('does not accept token query parameters, malformed tokens, or duplicate cookies', async () => {
    const data = payload();
    data.requestParameters = new URLSearchParams(`token=${editPat}`);
    await expect(hooks().onAuthenticate(data)).rejects.toMatchObject({ statusCode: 401 });
    for (const token of [12345, { role: 'admin' }]) {
      await expect(hooks().onAuthenticate(payload({ token }))).rejects.toMatchObject({ statusCode: 401 });
    }
    await expect(hooks().onAuthenticate(payload({ cookie: `${cookies.editor}; ${cookies.admin}` }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a tampered session instead of trusting its role claims', async () => {
    await expect(hooks().onAuthenticate(payload({ cookie: `${cookies.editor}tampered`, origin }))).rejects.toMatchObject({ statusCode: 401 });
  });

  it.each(['post-1', postId, `post-${postId.replace('555555555555', 'ABCDEFABCDEF')}`, 'draft-private-confidential'])('rejects noncanonical runtime room %s', async (documentName) => {
    await expect(hooks().onAuthenticate(payload({ cookie: cookies.editor, origin, room: documentName }))).rejects.toMatchObject({ statusCode: 403 });
    expect(requests).toHaveLength(0);
  });

  it('enforces exact browser origins while allowing authenticated native PAT clients without Origin', async () => {
    await expect(hooks().onAuthenticate(payload({ cookie: cookies.editor, origin: `${origin}.evil.example` }))).rejects.toMatchObject({ statusCode: 403 });
    await expect(hooks().onAuthenticate(payload({ cookie: cookies.editor, origin: 'http://blog.corp.internal' }))).rejects.toMatchObject({ statusCode: 403 });
    await expect(hooks().onAuthenticate(payload({ token: editPat }))).resolves.toBeDefined();
  });

  it.each(['outage', 'malformed', 'wrong-room', 'no-edit'] as const)('fails closed for %s authorization responses', async (failure) => {
    mode = failure;
    await expect(hooks().onAuthenticate(payload({ token: editPat }))).rejects.toMatchObject({ statusCode: failure === 'wrong-room' || failure === 'no-edit' ? 403 : 503 });
  });

  it('fails closed for missing API configuration and bounded authorization timeouts', async () => {
    await expect(createAuthHooks({ apiUrl: '' }).onAuthenticate(payload({ token: editPat }))).rejects.toMatchObject({ statusCode: 503 });
    mode = 'slow';
    await expect(createAuthHooks({ apiUrl, timeoutMs: 10 }).onAuthenticate(payload({ token: editPat }))).rejects.toMatchObject({ statusCode: 503 });
  });

  it('permits only explicit test identity injection and rejects pure reviewers even in tests', async () => {
    const auth = createAuthHooks({ authenticate: async () => ({ ...editor, permissions: ['view', 'review', 'edit'] }) });
    await expect(auth.onAuthenticate(payload({ token: 'test-only-credential', room: 'post-test-fixture' }))).resolves.toBeDefined();
    const reviewer = createAuthHooks({ authenticate: async () => ({ ...editor, permissions: ['review'] }) });
    await expect(reviewer.onAuthenticate(payload({ token: 'test-only-credential' }))).rejects.toMatchObject({ statusCode: 403 });
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => createAuthHooks({ authenticate: async () => editor })).toThrow('cannot be used in production');
  });

  it('requires bound edit context at load time', async () => {
    await expect(hooks().onLoadDocument({ context: {}, documentName: room } as any)).rejects.toMatchObject({ statusCode: 401 });
    await expect(hooks().onLoadDocument({ context: { user: { ...editor, permissions: ['view'] } }, documentName: room } as any)).rejects.toMatchObject({ statusCode: 403 });
    await expect(hooks().onLoadDocument({ context: { user: editor, documentName: 'post-other' }, documentName: room } as any)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('revalidates token-sync messages rather than accepting forged role tokens on an authenticated connection', async () => {
    collab = await createCollabServer({ port: 0, authOptions: { apiUrl }, quiet: true });
    await collab.listen();
    const data: any = {
      ...payload({ token: editPat }), instance: collab.server.hocuspocus,
      document: new Y.Doc(), socketId: 'token-sync-fixture', connection: { request: new Request('http://collab.test') },
    };
    await expect(collab.server.hocuspocus.hooks('onTokenSync', data)).resolves.toMatchObject({ user: { permissions: ['edit'] } });
    data.token = 'token-admin-forged';
    await expect(collab.server.hocuspocus.hooks('onTokenSync', data)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('preserves editor cookie/PAT WS sync but never syncs warm working rooms to forged tokens or viewers/reviewers', async () => {
    collab = await createCollabServer({ port: 0, authOptions: { apiUrl, allowedOrigins: [origin] }, quiet: true });
    const { url } = await collab.listen();
    function client(token?: string, cookie?: string) {
      const doc = new Y.Doc();
      const CookieWs = class extends WebSocket {
        constructor(address: string, protocols?: string | string[]) {
          super(address, protocols, { headers: cookie ? { Cookie: cookie, Origin: origin } : {} });
        }
      };
      const provider = new HocuspocusProvider({ url, name: room, document: doc, token, WebSocketPolyfill: CookieWs as any });
      providers.push(provider);
      return { doc, provider };
    }
    const cookieEditor = client(undefined, cookies.editor);
    await synced(cookieEditor.provider);
    cookieEditor.doc.getText('working-secret').insert(0, 'Only authorized editors receive this');
    await expect.poll(() => collab!.server.hocuspocus.documents.get(room)?.getText('working-secret').toString()).toBe('Only authorized editors receive this');
    const patEditor = client(editPat);
    await synced(patEditor.provider);
    expect(patEditor.doc.getText('working-secret').toString()).toBe('Only authorized editors receive this');

    for (const credentials of [{ token: 'token-admin-forged' }, { cookie: cookies.viewer }, { cookie: cookies.reviewer }, { token: readPat }]) {
      const denied = client(credentials.token, credentials.cookie);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Expected WS authentication rejection')), 5000);
        denied.provider.on('authenticationFailed', () => { clearTimeout(timer); resolve(); });
      });
      expect(denied.provider.isSynced).toBe(false);
      expect(denied.doc.getText('working-secret').toString()).toBe('');
    }
    expect(collab.server.hocuspocus.getConnectionsCount()).toBe(2);
  });
});

async function synced(provider: HocuspocusProvider): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS sync timeout')), 5000);
    provider.on('synced', () => { clearTimeout(timer); resolve(); });
    provider.on('authenticationFailed', () => { clearTimeout(timer); reject(new Error('Unexpected WS authentication failure')); });
  });
}
