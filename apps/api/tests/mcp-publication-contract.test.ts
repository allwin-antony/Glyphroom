import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApiApp } from '../src/app.js';
import { AuthService } from '../src/services/auth.js';
import {
  auditLogs,
  personalAccessTokens,
  pluginEventOutbox,
  postReviews,
  posts,
  postVersions,
  spaceMembers,
  spaces,
  users,
} from '../src/db/schema.js';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { ApiClient } from '../../mcp-server/src/api/client.js';
import type { Database } from '../src/db/index.js';

const SECRET = 'mcp-publication-contract-session-secret';

type PersonName = 'author' | 'reviewer' | 'admin' | 'maintainer' | 'reader';
type Person = typeof users.$inferSelect & { headers: Record<string, string> };

async function createHarness() {
  const database = createInMemoryDatabase();
  const db = database.db as Database;
  const auth = new AuthService(db, SECRET);
  const people = new Map<PersonName, Person>();

  for (const [name, role] of [
    ['author', 'author'],
    ['reviewer', 'moderator'],
    ['admin', 'admin'],
    ['maintainer', 'reader'],
    ['reader', 'reader'],
  ] as const) {
    const [person] = await db.insert(users).values({
      email: `${name}@mcp-publication.test`,
      fullName: name,
      role,
    }).returning();
    const token = auth.createSessionToken(person);
    people.set(name, { ...person, headers: { cookie: `blogger_session=${token}` } });
  }

  const [space] = await db.insert(spaces).values({
    slug: `mcp-publication-${randomUUID()}`,
    name: 'MCP publication contract',
  }).returning();
  await db.insert(spaceMembers).values({
    spaceId: space.id,
    userId: people.get('maintainer')!.id,
    role: 'maintainer',
  });

  const instance = await createApiApp({ db, sessionSecret: SECRET });
  const apiUrl = await instance.app.listen({ port: 0, host: '127.0.0.1' });

  async function fixture(options: {
    author?: PersonName;
    status?: 'draft' | 'in_review' | 'approved';
    pin?: string | null;
    snapshot?: string;
    triggerReason?: 'manual_save' | 'review_submission';
    approval?: false | 'pending' | 'approved' | 'changes_requested';
    reviewer?: PersonName;
  } = {}) {
    const author = people.get(options.author ?? 'author')!;
    const [inserted] = await db.insert(posts).values({
      slug: `mcp-publication-${randomUUID()}`,
      title: 'MCP publication checkpoint',
      excerpt: 'PRIVATE_POST_METADATA',
      authorId: author.id,
      spaceId: space.id,
      status: options.status ?? 'approved',
      yjsState: Buffer.from('not-a-yjs-update'),
      workingMarkdown: null,
    }).returning();
    const [checkpoint] = await db.insert(postVersions).values({
      postId: inserted.id,
      versionNumber: 1,
      triggerReason: options.triggerReason ?? 'review_submission',
      yjsStateSnapshot: Buffer.from('private-checkpoint-yjs'),
      markdownSnapshot: options.snapshot ?? '',
      createdBy: author.id,
    }).returning();
    const submittedVersionId = options.pin === undefined ? checkpoint.id : options.pin;
    const [post] = await db.update(posts).set({ submittedVersionId }).where(eq(posts.id, inserted.id)).returning();
    if (options.approval !== false) {
      await db.insert(postReviews).values({
        postId: post.id,
        submittedVersionId: checkpoint.id,
        reviewerId: people.get(options.reviewer ?? 'reviewer')!.id,
        decision: options.approval ?? 'approved',
        notes: 'PRIVATE_REVIEW_NOTE',
        resolvedAt: new Date(),
      });
    }
    return { post, checkpoint };
  }

  async function addCheckpoint(
    postId: string,
    authorId: string,
    versionNumber: number,
    triggerReason: 'manual_save' | 'review_submission' = 'review_submission',
  ) {
    const [checkpoint] = await db.insert(postVersions).values({
      postId,
      versionNumber,
      triggerReason,
      yjsStateSnapshot: Buffer.from('private-new-checkpoint-yjs'),
      markdownSnapshot: 'PRIVATE_NEW_CHECKPOINT',
      createdBy: authorId,
    }).returning();
    return checkpoint;
  }

  async function makePat(personName: PersonName, scopes: string[]) {
    const person = people.get(personName)!;
    const token = `eb_pat_${randomUUID().replaceAll('-', '')}`;
    const [pat] = await db.insert(personalAccessTokens).values({
      userId: person.id,
      name: `mcp-publication-${randomUUID()}`,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      scopes,
    }).returning({ id: personalAccessTokens.id });
    return {
      token,
      headers: { authorization: `Bearer ${token}` },
      actor: { userId: person.id, tokenId: pat.id, fullName: person.fullName, scopes },
    };
  }

  return {
    db,
    pool: database.pool,
    people,
    app: instance.app,
    apiUrl,
    fixture,
    addCheckpoint,
    makePat,
    readCheckpoint: (postId: string, headers = people.get('admin')!.headers) => fetch(
      `${apiUrl}/api/v1/posts/${encodeURIComponent(postId)}/publication-checkpoint`, { headers },
    ),
    close: async () => {
      await instance.close();
      await database.pool.end();
    },
  };
}

function observeFetch(afterResponse?: (request: { method: string; url: string; body?: string }, response: Response) => Promise<void>) {
  const realFetch = globalThis.fetch;
  const requests: Array<{ method: string; url: string; body?: string; status?: number; responseBody?: unknown }> = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const request: typeof requests[number] = { method, url, ...(typeof init?.body === 'string' ? { body: init.body } : {}) };
    requests.push(request);
    const response = await realFetch(...args);
    request.status = response.status;
    request.responseBody = await response.clone().json();
    await afterResponse?.(request, response);
    return response;
  });
  return { requests, spy };
}

describe('MCP publication checkpoint actual API contract', () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  beforeEach(async () => { harness = await createHarness(); });
  afterEach(async () => {
    vi.restoreAllMocks();
    await harness?.close();
  });

  it.each([
    ['admin', 'post:publish'],
    ['maintainer', 'posts:publish'],
  ] as const)('publishes an empty approved checkpoint as %s with only %s while working content stays unavailable', async (person, scope) => {
    const target = await harness.fixture({ snapshot: '' });
    const pat = await harness.makePat(person, [scope]);
    const versions = await harness.db.select().from(postVersions).where(eq(postVersions.postId, target.post.id));

    const unavailable = await fetch(`${harness.apiUrl}/api/v1/posts/${target.post.id}`, { headers: pat.headers });
    expect(unavailable.status).toBe(409);
    expect(await unavailable.text()).not.toContain('PRIVATE_');

    const { requests, spy } = observeFetch();
    const client = new ApiClient({
      baseUrl: `${harness.apiUrl}/api/v1`,
      defaultToken: pat.token,
      actor: pat.actor,
    });

    const receipt = await client.publishPost(target.post.id);

    expect(receipt.post).toMatchObject({
      id: target.post.id,
      status: 'published',
      publishedVersionId: target.checkpoint.id,
    });
    expect(Object.keys(receipt.post).sort()).toEqual(['id', 'status', 'publishedVersionId', 'publishedAt'].sort());
    expect(requests.map(({ method, url }) => [method, new URL(url).pathname])).toEqual([
      ['GET', `/api/v1/posts/${target.post.id}/publication-checkpoint`],
      ['POST', `/api/v1/posts/${target.post.id}/publish`],
    ]);
    expect(JSON.parse(requests[1].body!)).toEqual({ submittedVersionId: target.checkpoint.id });
    expect(requests[0].responseBody).toEqual({
      post: { id: target.post.id, status: 'approved', submittedVersionId: target.checkpoint.id },
    });
    expect(requests.map((request) => request.status)).toEqual([200, 200]);
    spy.mockRestore();

    const [saved] = await harness.db.select().from(posts).where(eq(posts.id, target.post.id));
    expect(saved).toMatchObject({
      status: 'published',
      submittedVersionId: null,
      publishedVersionId: target.checkpoint.id,
      publishedMarkdown: '',
      workingMarkdown: null,
    });
    expect(saved.yjsState).toEqual(target.post.yjsState);
    expect(receipt.post.publishedAt).toBe(saved.publishedAt!.toISOString());
    expect(await harness.db.select().from(postVersions).where(eq(postVersions.postId, target.post.id))).toEqual(versions);
    const events = await harness.db.select().from(pluginEventOutbox).where(eq(pluginEventOutbox.eventType, 'post:published'));
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ postId: target.post.id, publishedVersionId: target.checkpoint.id });
    expect(events[0].payload).not.toHaveProperty('notes');
    const [audit] = await harness.db.select().from(auditLogs).where(eq(auditLogs.action, 'post_published'));
    expect(audit.metadata).toEqual({ versionId: target.checkpoint.id, versionNumber: target.checkpoint.versionNumber });

    const stillUnavailable = await fetch(`${harness.apiUrl}/api/v1/posts/${target.post.id}`, { headers: pat.headers });
    expect(stillUnavailable.status).toBe(409);
  });

  it.each([
    ['empty', ''], ['text', '  Publisher operation notes\n'], ['limit', 'n'.repeat(2000)],
  ])('forwards and retains %s publisher notes with the exact approved pin, leaving review notes and history unchanged', async (_case, notes) => {
    const target = await harness.fixture({ snapshot: 'PINNED_CONTENT' });
    const versions = await harness.db.select().from(postVersions).where(eq(postVersions.postId, target.post.id));
    const reviews = await harness.db.select().from(postReviews).where(eq(postReviews.postId, target.post.id));
    const pat = await harness.makePat('admin', ['posts:publish']);
    const { requests } = observeFetch();
    const client = new ApiClient({ baseUrl: harness.apiUrl, defaultToken: pat.token, actor: pat.actor });

    const receipt = await client.publishPost(target.post.id, notes);

    expect(receipt.post.publishedVersionId).toBe(target.checkpoint.id);
    expect(JSON.parse(requests[1].body!)).toEqual({ submittedVersionId: target.checkpoint.id, notes });
    expect(requests.map((request) => [request.method, request.status])).toEqual([['GET', 200], ['POST', 200]]);
    const [event] = await harness.db.select().from(pluginEventOutbox).where(eq(pluginEventOutbox.eventType, 'post:published'));
    expect(event.payload).toMatchObject({ postId: target.post.id, publishedVersionId: target.checkpoint.id, notes });
    const [audit] = await harness.db.select().from(auditLogs).where(eq(auditLogs.action, 'post_published'));
    expect(audit).toMatchObject({ actorType: 'agent', actorUserId: pat.actor.userId, patId: pat.actor.tokenId,
      metadata: { versionId: target.checkpoint.id, versionNumber: target.checkpoint.versionNumber, notes } });
    expect(await harness.db.select().from(postVersions).where(eq(postVersions.postId, target.post.id))).toEqual(versions);
    expect(await harness.db.select().from(postReviews).where(eq(postReviews.postId, target.post.id))).toEqual(reviews);
    const [saved] = await harness.db.select().from(posts).where(eq(posts.id, target.post.id));
    expect(saved.publishedMarkdown).toBe('PINNED_CONTENT');
    expect(saved.yjsState).toEqual(target.post.yjsState);
  });

  it('rejects 2001-character publication notes through the actual client and API without retaining or publishing them', async () => {
    const target = await harness.fixture();
    const pat = await harness.makePat('admin', ['post:publish']);
    const { requests } = observeFetch();
    const client = new ApiClient({ baseUrl: harness.apiUrl, defaultToken: pat.token, actor: pat.actor });

    await expect(client.publishPost(target.post.id, 'n'.repeat(2001))).rejects.toMatchObject({ status: 400 });

    expect(JSON.parse(requests[1].body!)).toEqual({ submittedVersionId: target.checkpoint.id, notes: 'n'.repeat(2001) });
    expect(requests.map((request) => request.status)).toEqual([200, 400]);
    expect(await harness.db.select().from(pluginEventOutbox)).toHaveLength(0);
    expect(await harness.db.select().from(auditLogs).where(eq(auditLogs.action, 'post_published'))).toHaveLength(0);
    const [saved] = await harness.db.select().from(posts).where(eq(posts.id, target.post.id));
    expect(saved).toMatchObject({ status: 'approved', submittedVersionId: target.checkpoint.id, publishedVersionId: null });
  });

  it('returns only canonical approved-pin metadata and accepts the plural publish PAT alias', async () => {
    const target = await harness.fixture({ snapshot: 'PRIVATE_APPROVED_SNAPSHOT' });
    const unrelated = await harness.addCheckpoint(target.post.id, target.post.authorId, 2, 'manual_save');
    const pat = await harness.makePat('admin', ['posts:publish']);

    const response = await harness.readCheckpoint(target.post.id.toUpperCase(), pat.headers);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      post: { id: target.post.id, status: 'approved', submittedVersionId: target.checkpoint.id },
    });
    expect(body).not.toContain('PRIVATE_');
    expect(body).not.toContain(unrelated.id);
  });

  it('rejects unavailable or invalid active checkpoints with one read and no publication or fallback', async () => {
    const missing = await harness.fixture({ pin: null });
    const malformed = await harness.fixture({ pin: 'not-a-uuid' });
    const dangling = await harness.fixture({ pin: randomUUID() });
    const historical = await harness.fixture();
    const manual = await harness.addCheckpoint(historical.post.id, historical.post.authorId, 2, 'manual_save');
    await harness.db.update(posts).set({ submittedVersionId: manual.id }).where(eq(posts.id, historical.post.id));
    const other = await harness.fixture();
    const crossPost = await harness.fixture();
    await harness.db.update(posts).set({ submittedVersionId: other.checkpoint.id }).where(eq(posts.id, crossPost.post.id));
    const mismatchedApproval = await harness.fixture();
    await harness.db.update(postReviews).set({ postId: other.post.id })
      .where(eq(postReviews.submittedVersionId, mismatchedApproval.checkpoint.id));
    const selfOnly = await harness.fixture({ author: 'admin', reviewer: 'admin' });
    const pending = await harness.fixture({ approval: 'pending' });
    const unreviewed = await harness.fixture({ approval: false });
    const rejected = await harness.fixture({ approval: 'changes_requested' });
    const badSnapshot = await harness.fixture();
    // Model corrupt historical data without replacing the endpoint or its DB reads.
    await harness.pool.query('ALTER TABLE post_versions ALTER COLUMN markdown_snapshot DROP NOT NULL');
    await harness.pool.query('UPDATE post_versions SET markdown_snapshot = NULL WHERE id = $1', [badSnapshot.checkpoint.id]);
    const pat = await harness.makePat('admin', ['post:publish']);
    const client = new ApiClient({ baseUrl: harness.apiUrl, defaultToken: pat.token, actor: pat.actor });
    const { requests } = observeFetch();
    const targets = [missing, malformed, dangling, historical, crossPost, mismatchedApproval,
      selfOnly, pending, unreviewed, rejected, badSnapshot];

    for (const target of targets) {
      await expect(client.publishPost(target.post.id)).rejects.toMatchObject({ status: 409 });
    }
    expect(requests).toHaveLength(targets.length);
    expect(requests.every((request) => request.method === 'GET' && request.status === 409)).toBe(true);
    expect(JSON.stringify(requests.map((request) => request.responseBody))).not.toContain('PRIVATE_');
    expect(await harness.db.select().from(pluginEventOutbox)).toHaveLength(0);
  });

  it('rejects non-UUID checkpoint routes rather than resolving slugs', async () => {
    const target = await harness.fixture();
    for (const identifier of ['not-a-uuid', target.post.slug]) {
      const response = await harness.readCheckpoint(identifier);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Bad Request', message: 'Invalid post ID' });
    }
  });

  it('rechecks authentication, current account activity, publish authority, PAT scope, and approved status', async () => {
    const target = await harness.fixture();
    expect((await harness.readCheckpoint(target.post.id, {})).status).toBe(401);
    expect((await harness.readCheckpoint(target.post.id, { authorization: 'Bearer eb_pat_invalid' })).status).toBe(401);

    const wrongScope = await harness.makePat('admin', ['post:read', 'post:edit', 'post:review', 'admin']);
    expect((await harness.readCheckpoint(target.post.id, wrongScope.headers)).status).toBe(403);

    for (const person of ['author', 'reader'] as const) {
      const pat = await harness.makePat(person, ['post:publish']);
      expect((await harness.readCheckpoint(target.post.id, pat.headers)).status).toBe(403);
    }

    const inReview = await harness.fixture({ status: 'in_review' });
    expect((await harness.readCheckpoint(inReview.post.id)).status).toBe(409);

    expect((await harness.readCheckpoint(randomUUID())).status).toBe(404);

    const adminPat = await harness.makePat('admin', ['post:publish']);
    // The signed session still claims admin, but the endpoint must reread its current role.
    await harness.db.update(users).set({ role: 'reader' }).where(eq(users.id, harness.people.get('admin')!.id));
    expect((await harness.readCheckpoint(target.post.id)).status).toBe(403);
    await harness.db.update(users).set({ isActive: false }).where(eq(users.id, harness.people.get('admin')!.id));
    expect((await harness.readCheckpoint(target.post.id)).status).toBe(401);
    expect((await harness.readCheckpoint(target.post.id, adminPat.headers)).status).toBe(401);
  });

  it('posts a discovered pin once and does not refetch or retry when it becomes stale', async () => {
    const target = await harness.fixture();
    const replacement = await harness.addCheckpoint(target.post.id, target.post.authorId, 2);
    await harness.db.insert(postReviews).values({
      postId: target.post.id,
      submittedVersionId: replacement.id,
      reviewerId: harness.people.get('reviewer')!.id,
      decision: 'approved',
      resolvedAt: new Date(),
    });
    const pat = await harness.makePat('admin', ['posts:publish']);
    let swapped = false;
    const { requests } = observeFetch(async (request, response) => {
      if (!swapped && request.method === 'GET' && request.url.endsWith('/publication-checkpoint') && response.ok) {
        swapped = true;
        await harness.db.update(posts).set({ submittedVersionId: replacement.id }).where(eq(posts.id, target.post.id));
      }
    });
    const client = new ApiClient({ baseUrl: harness.apiUrl, defaultToken: pat.token, actor: pat.actor });

    await expect(client.publishPost(target.post.id, 'Stale publisher notes')).rejects.toMatchObject({ status: 409 });

    expect(swapped).toBe(true);
    expect(requests.map(({ method, url }) => [method, new URL(url).pathname])).toEqual([
      ['GET', `/api/v1/posts/${target.post.id}/publication-checkpoint`],
      ['POST', `/api/v1/posts/${target.post.id}/publish`],
    ]);
    expect(JSON.parse(requests[1].body!)).toEqual({ submittedVersionId: target.checkpoint.id, notes: 'Stale publisher notes' });
    const [saved] = await harness.db.select().from(posts).where(eq(posts.id, target.post.id));
    expect(saved).toMatchObject({ status: 'approved', submittedVersionId: replacement.id,
      publishedMarkdown: null, publishedVersionId: null, publishedAt: null });
    expect(await harness.db.select().from(pluginEventOutbox)).toHaveLength(0);
  });
});
