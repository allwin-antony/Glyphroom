import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { createApiApp } from '../src/app.js';
import { AuthService } from '../src/services/auth.js';
import { AuditService } from '../src/services/audit.js';
import { NotificationService } from '../src/services/notifications.js';
import { BackendPluginRegistry } from '../src/plugins/registry.js';
import {
  auditLogs,
  personalAccessTokens,
  pluginEventOutbox,
  postCollaborators,
  postReviews,
  posts,
  postVersions,
  spaceMembers,
  spaces,
  users,
} from '../src/db/schema.js';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { createPostgresTestDatabase } from './helpers/postgres-db.js';
import type { Database } from '../src/db/index.js';
import type { CollabService } from '../src/services/collab.js';

const SECRET = 'publication-integrity-session-secret-32-chars';
const NO_BODY = Symbol('no-body');

const personRoles = {
  author: 'author',
  reviewer: 'moderator',
  admin: 'admin',
  moderator: 'moderator',
  editor: 'reader',
  reviewOnly: 'reader',
  spaceAuthor: 'author',
  maintainer: 'reader',
  owner: 'reader',
  adminAuthor: 'admin',
} as const;

type PersonKey = keyof typeof personRoles;
type Decision = 'pending' | 'approved' | 'changes_requested';

function yjsState(markdown: string): Buffer {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  if (markdown) paragraph.insert(0, [new Y.XmlText(markdown)]);
  doc.getXmlFragment('prosemirror').insert(0, [paragraph]);
  const state = Buffer.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return state;
}

interface FixtureOptions {
  author?: PersonKey;
  status?: 'draft' | 'in_review' | 'approved' | 'published' | 'archived';
  snapshot?: string;
  triggerReason?: 'manual_save' | 'review_submission' | 'publication' | 'hourly_checkpoint';
  pin?: string | null;
  approval?: Decision | false;
  reviewer?: PersonKey;
  publishedMarkdown?: string | null;
  space?: boolean;
  latestSnapshot?: string;
  latestTriggerReason?: 'manual_save' | 'review_submission';
}

interface PublicationFixture {
  post: typeof posts.$inferSelect;
  checkpoint: typeof postVersions.$inferSelect;
  latest?: typeof postVersions.$inferSelect;
}

async function createHarness(postgres: boolean) {
  const database = postgres ? await createPostgresTestDatabase() : createInMemoryDatabase();
  const db = database.db as Database;
  const pool = database.pool;
  const closeDb = 'close' in database ? database.close : () => database.pool.end();
  const auth = new AuthService(db, SECRET);
  const people = new Map<PersonKey, typeof users.$inferSelect & { headers: Record<string, string> }>();

  for (const [name, role] of Object.entries(personRoles) as Array<[PersonKey, typeof personRoles[PersonKey]]>) {
    const [person] = await db.insert(users).values({
      email: `${name.toLowerCase()}@publication.test`,
      fullName: name,
      role,
      isActive: true,
    }).returning();
    const token = auth.createSessionToken(person);
    people.set(name, {
      ...person,
      headers: {
        cookie: `blogger_session=${token}`,
        'x-csrf-token': auth.generateCsrfToken(token),
      },
    });
  }

  const [space] = await db.insert(spaces).values({
    slug: `publication-${randomUUID()}`,
    name: 'Publication integrity',
  }).returning();
  await db.insert(spaceMembers).values([
    { spaceId: space.id, userId: people.get('spaceAuthor')!.id, role: 'author' },
    { spaceId: space.id, userId: people.get('maintainer')!.id, role: 'maintainer' },
    { spaceId: space.id, userId: people.get('owner')!.id, role: 'owner' },
  ]);

  const collab = {
    flushDocument: vi.fn(async () => { throw new Error('publication must not flush collaboration state'); }),
    restoreDocument: vi.fn(async () => { throw new Error('publication must not restore collaboration state'); }),
    tombstoneDocument: vi.fn(async () => { throw new Error('publication must not tombstone collaboration state'); }),
  } as unknown as CollabService;
  const registry = new BackendPluginRegistry();
  const instance = await createApiApp({ db, sessionSecret: SECRET, collabService: collab, pluginRegistry: registry });
  await instance.app.ready();

  async function fixture(options: FixtureOptions = {}): Promise<PublicationFixture> {
    const author = people.get(options.author ?? 'author')!;
    const workingMarkdown = `WORKING_PRIVATE_${randomUUID()}`;
    const state = yjsState(workingMarkdown);
    const publishedMarkdown = options.publishedMarkdown === undefined ? null : options.publishedMarkdown;
    const [inserted] = await db.insert(posts).values({
      slug: `publication-${randomUUID()}`,
      title: 'Publication fixture',
      excerpt: 'PRIVATE_EXCERPT',
      authorId: author.id,
      status: options.status ?? 'approved',
      spaceId: options.space ? space.id : null,
      visibility: 'space',
      yjsState: state,
      workingMarkdown,
      publishedMarkdown,
      publishedAt: typeof publishedMarkdown === 'string' ? new Date('2026-01-02T03:04:05.000Z') : null,
    }).returning();
    const [checkpoint] = await db.insert(postVersions).values({
      postId: inserted.id,
      versionNumber: 1,
      triggerReason: options.triggerReason ?? 'review_submission',
      yjsStateSnapshot: yjsState(options.snapshot ?? 'PINNED_APPROVED_CHECKPOINT'),
      markdownSnapshot: options.snapshot ?? 'PINNED_APPROVED_CHECKPOINT',
      createdBy: author.id,
    }).returning();
    let latest: typeof postVersions.$inferSelect | undefined;
    if (options.latestSnapshot !== undefined) {
      [latest] = await db.insert(postVersions).values({
        postId: inserted.id,
        versionNumber: 2,
        triggerReason: options.latestTriggerReason ?? 'manual_save',
        yjsStateSnapshot: yjsState(options.latestSnapshot),
        markdownSnapshot: options.latestSnapshot,
        createdBy: author.id,
      }).returning();
    }
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
    return { post, checkpoint, latest };
  }

  async function addCheckpoint(target: PublicationFixture, markdown: string) {
    const [checkpoint] = await db.insert(postVersions).values({
      postId: target.post.id,
      versionNumber: target.latest ? 3 : 2,
      triggerReason: 'review_submission',
      yjsStateSnapshot: yjsState(markdown),
      markdownSnapshot: markdown,
      createdBy: target.post.authorId,
    }).returning();
    await db.insert(postReviews).values({
      postId: target.post.id,
      submittedVersionId: checkpoint.id,
      reviewerId: people.get('reviewer')!.id,
      decision: 'approved',
      resolvedAt: new Date(),
    });
    return checkpoint;
  }

  function mutatePublication(
    target: PublicationFixture,
    route: 'publish' | 'republish' = 'publish',
    caller: PersonKey = 'admin',
    payload: unknown | typeof NO_BODY = { submittedVersionId: target.checkpoint.id },
    headers = people.get(caller)!.headers,
  ) {
    return instance.app.inject({
      method: 'POST',
      url: `/api/v1/posts/${target.post.id}/${route}`,
      headers,
      ...(payload === NO_BODY ? {} : { payload }),
    });
  }

  function patch(target: PublicationFixture, payload: Record<string, unknown>, caller: PersonKey = 'admin') {
    return instance.app.inject({
      method: 'PATCH',
      url: `/api/v1/posts/${target.post.id}`,
      headers: people.get(caller)!.headers,
      payload,
    });
  }

  async function makePat(scopes: string[], caller: PersonKey = 'admin') {
    const token = `eb_pat_${randomUUID()}`;
    await db.insert(personalAccessTokens).values({
      userId: people.get(caller)!.id,
      name: `publication-${randomUUID()}`,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      scopes,
    });
    return { authorization: `Bearer ${token}` };
  }

  async function publishedEvents() {
    return db.select().from(pluginEventOutbox).where(eq(pluginEventOutbox.eventType, 'post:published'));
  }

  return {
    db,
    pool,
    instance,
    eventBus: registry.getEventBus(),
    people,
    space,
    collab: collab as any,
    fixture,
    addCheckpoint,
    mutatePublication,
    patch,
    makePat,
    publishedEvents,
    close: async () => {
      await instance.close();
      await closeDb();
    },
  };
}

function expectReceipt(response: Awaited<ReturnType<Awaited<ReturnType<typeof createHarness>>['mutatePublication']>>, target: PublicationFixture) {
  expect(response.statusCode, response.body).toBe(200);
  expect(Object.keys(response.json())).toEqual(['post']);
  expect(Object.keys(response.json().post).sort()).toEqual(['id', 'status', 'publishedVersionId', 'publishedAt'].sort());
  expect(response.json().post).toMatchObject({
    id: target.post.id,
    status: 'published',
    publishedVersionId: target.checkpoint.id,
  });
  expect(response.json().post.publishedAt).toEqual(expect.any(String));
}

describe('publication checkpoint integrity contracts', () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  beforeEach(async () => { harness = await createHarness(false); });
  afterEach(async () => { vi.restoreAllMocks(); await harness?.close(); });

  it('publishes only the independently approved active checkpoint through both aliases, preserving empty content and working state', async () => {
    const direct = await harness.fixture({
      snapshot: 'PINNED_DIRECT_CHECKPOINT',
      latestSnapshot: 'LATEST_UNRELATED_VERSION',
    });
    const directVersions = await harness.db.select().from(postVersions).where(eq(postVersions.postId, direct.post.id));
    const directResponse = await harness.mutatePublication(
      direct,
      'publish',
      'admin',
      { submittedVersionId: direct.checkpoint.id.toUpperCase() },
    );
    expectReceipt(directResponse, direct);
    expect(directResponse.body).not.toContain('PINNED_DIRECT_CHECKPOINT');
    expect(directResponse.body).not.toContain(direct.post.workingMarkdown!);
    const [savedDirect] = await harness.db.select().from(posts).where(eq(posts.id, direct.post.id));
    expect(savedDirect.publishedMarkdown).toBe('PINNED_DIRECT_CHECKPOINT');
    expect(savedDirect.workingMarkdown).toBe(direct.post.workingMarkdown);
    expect(savedDirect.yjsState).toEqual(direct.post.yjsState);
    expect(savedDirect.submittedVersionId).toBeNull();
    expect(await harness.db.select().from(postVersions).where(eq(postVersions.postId, direct.post.id))).toHaveLength(directVersions.length);

    const emptyDirect = await harness.fixture({ snapshot: '' });
    const emptyDirectResponse = await harness.mutatePublication(emptyDirect);
    expectReceipt(emptyDirectResponse, emptyDirect);
    const [savedEmptyDirect] = await harness.db.select().from(posts).where(eq(posts.id, emptyDirect.post.id));
    expect(savedEmptyDirect.publishedMarkdown).toBe('');

    const alias = await harness.fixture({ snapshot: '', publishedMarkdown: '', latestSnapshot: 'UNREVIEWED_ALIAS_LATEST' });
    expect(alias.post.publishedVersionId).toBeNull();
    const aliasVersions = await harness.db.select().from(postVersions).where(eq(postVersions.postId, alias.post.id));
    const aliasResponse = await harness.mutatePublication(
      alias,
      'republish',
      'admin',
      { submittedVersionId: alias.checkpoint.id.toUpperCase(), changeSummary: 'must not substitute for review' },
    );
    expectReceipt(aliasResponse, alias);
    const [savedAlias] = await harness.db.select().from(posts).where(eq(posts.id, alias.post.id));
    expect(savedAlias.publishedMarkdown).toBe('');
    expect(savedAlias.workingMarkdown).toBe(alias.post.workingMarkdown);
    expect(savedAlias.yjsState).toEqual(alias.post.yjsState);
    expect(savedAlias.publishedAt).toEqual(alias.post.publishedAt);
    expect(await harness.db.select().from(postVersions).where(eq(postVersions.postId, alias.post.id))).toHaveLength(aliasVersions.length);
    expect(harness.collab.flushDocument).not.toHaveBeenCalled();

    const events = await harness.publishedEvents();
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({ postId: direct.post.id, publishedVersionId: direct.checkpoint.id }),
      expect.objectContaining({ postId: emptyDirect.post.id, publishedVersionId: emptyDirect.checkpoint.id }),
      expect.objectContaining({ postId: alias.post.id, publishedVersionId: alias.checkpoint.id }),
    ]));
  });

  it('validates route and body UUIDs without parsing a body before workflow admission', async () => {
    const headers = harness.people.get('admin')!.headers;
    const invalidId = await harness.instance.app.inject({
      method: 'POST',
      url: '/api/v1/posts/not-a-uuid/publish',
      headers,
      payload: { submittedVersionId: randomUUID() },
    });
    expect(invalidId.statusCode).toBe(400);

    const missing = await harness.instance.app.inject({
      method: 'POST',
      url: `/api/v1/posts/${randomUUID()}/publish`,
      headers,
      payload: { submittedVersionId: randomUUID() },
    });
    expect(missing.statusCode).toBe(404);

    const draft = await harness.fixture({ status: 'draft' });
    const unapprovedWithoutBody = await harness.mutatePublication(draft, 'publish', 'admin', NO_BODY);
    expect(unapprovedWithoutBody.statusCode).toBe(409);
    expect(unapprovedWithoutBody.json().message).toContain('published after approval');

    const approved = await harness.fixture();
    expect((await harness.mutatePublication(approved, 'publish', 'admin', NO_BODY)).statusCode).toBe(400);
    expect((await harness.mutatePublication(approved, 'publish', 'admin', { submittedVersionId: 'not-a-uuid' })).statusCode).toBe(400);
    expect((await harness.mutatePublication(approved, 'republish')).statusCode).toBe(409);

    const approvedRevision = await harness.fixture({ publishedMarkdown: 'OLD_PUBLICATION' });
    expect((await harness.mutatePublication(
      approvedRevision,
      'republish',
      'admin',
      { changeSummary: 'not a review checkpoint' },
    )).statusCode).toBe(400);

    const published = await harness.fixture({ status: 'published', pin: null, publishedMarkdown: 'OLD_PUBLICATION' });
    const bypass = await harness.mutatePublication(published, 'republish', 'admin', NO_BODY);
    expect(bypass.statusCode).toBe(409);
    expect(bypass.body).not.toContain(published.post.workingMarkdown!);
    expect(harness.collab.flushDocument).not.toHaveBeenCalled();
  });

  it.each([
    ['omitted', undefined], ['empty', ''], ['text', '  Publisher notes\n'], ['limit', 'n'.repeat(2000)],
  ])('retains %s notes only as publisher operation metadata through publication and durable outbox delivery/replay', async (_case, notes) => {
    const target = await harness.fixture({ publishedMarkdown: 'OLD_PUBLICATION' });
    const versions = await harness.db.select().from(postVersions).where(eq(postVersions.postId, target.post.id));
    const reviews = await harness.db.select().from(postReviews).where(eq(postReviews.postId, target.post.id));
    const body = { submittedVersionId: target.checkpoint.id, ...(notes !== undefined ? { notes } : {}) };

    expectReceipt(await harness.mutatePublication(target, 'republish', 'admin', body), target);

    const [event] = await harness.publishedEvents();
    const expectedPayload = { postId: target.post.id, publishedVersionId: target.checkpoint.id,
      authorId: target.post.authorId, spaceId: target.post.spaceId, title: target.post.title,
      ...(notes !== undefined ? { notes } : {}) };
    expect(event.payload).toEqual(expectedPayload);
    const [audit] = await harness.db.select().from(auditLogs).where(eq(auditLogs.action, 'post_republished'));
    expect(audit.metadata).toEqual({ versionId: target.checkpoint.id, versionNumber: target.checkpoint.versionNumber,
      ...(notes !== undefined ? { notes } : {}) });
    expect(await harness.db.select().from(postVersions).where(eq(postVersions.postId, target.post.id))).toEqual(versions);
    expect(await harness.db.select().from(postReviews).where(eq(postReviews.postId, target.post.id))).toEqual(reviews);
    const [saved] = await harness.db.select().from(posts).where(eq(posts.id, target.post.id));
    expect(saved.publishedMarkdown).toBe(target.checkpoint.markdownSnapshot);
    expect(saved.workingMarkdown).toBe(target.post.workingMarkdown);

    const emit = vi.spyOn(harness.eventBus, 'emit').mockRejectedValue(new Error('delivery unavailable'));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await harness.db.update(pluginEventOutbox).set({ availableAt: new Date(Date.now() - 1000) }).where(eq(pluginEventOutbox.id, event.id));
      await harness.instance.outboxService.processPending();
    }
    const [failed] = await harness.publishedEvents();
    expect(failed.status).toBe('failed');
    expect(failed.payload).toEqual(expectedPayload);
    expect(await harness.instance.outboxService.retryFailed(event.id)).toBe(1);
    emit.mockRestore();
    expect((await harness.instance.outboxService.processPending()).succeeded).toBe(1);
    const [delivered] = await harness.publishedEvents();
    expect(delivered.status).toBe('delivered');
    expect(delivered.payload).toEqual(expectedPayload);
    expect((await harness.mutatePublication(target, 'republish', 'admin', { ...body, notes: 'Duplicate attempt' })).statusCode).toBe(409);
    expect(await harness.publishedEvents()).toHaveLength(1);
  });

  it('rejects invalid publisher notes before changing the post, checkpoint or outbox', async () => {
    const target = await harness.fixture();
    for (const notes of ['n'.repeat(2001), null, 123]) {
      expect((await harness.mutatePublication(target, 'publish', 'admin', { submittedVersionId: target.checkpoint.id, notes })).statusCode).toBe(400);
    }
    const [saved] = await harness.db.select().from(posts).where(eq(posts.id, target.post.id));
    expect(saved).toMatchObject({ status: 'approved', submittedVersionId: target.checkpoint.id,
      publishedVersionId: null, publishedMarkdown: null });
    expect(await harness.publishedEvents()).toHaveLength(0);
    expect(await harness.db.select().from(auditLogs).where(eq(auditLogs.action, 'post_published'))).toHaveLength(0);
  });

  it('rejects null, missing, stale, cross-post and wrong-kind pins without latest-version fallback or private errors', async () => {
    const cases: Array<{ target: PublicationFixture; body: string }> = [];
    const absent = await harness.fixture({ pin: null, latestSnapshot: 'LATEST_MUST_NOT_WIN' });
    cases.push({ target: absent, body: absent.checkpoint.id });

    const missingId = randomUUID();
    const missing = await harness.fixture({ pin: missingId, latestSnapshot: 'LATEST_MISSING_PIN' });
    cases.push({ target: missing, body: missingId });

    const other = await harness.fixture({ snapshot: 'OTHER_POST_PRIVATE' });
    const cross = await harness.fixture({ snapshot: 'TARGET_PRIVATE' });
    await harness.db.update(posts).set({ submittedVersionId: other.checkpoint.id }).where(eq(posts.id, cross.post.id));
    cross.post.submittedVersionId = other.checkpoint.id;
    cases.push({ target: cross, body: other.checkpoint.id });

    const wrongKind = await harness.fixture({ triggerReason: 'manual_save' });
    cases.push({ target: wrongKind, body: wrongKind.checkpoint.id });

    const stale = await harness.fixture({ latestSnapshot: 'STALE_UNPINNED', latestTriggerReason: 'review_submission' });
    cases.push({ target: stale, body: stale.latest!.id });

    for (const { target, body } of cases) {
      const response = await harness.mutatePublication(target, 'publish', 'admin', { submittedVersionId: body });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: 'Conflict', message: 'Approved review checkpoint changed or unavailable' });
      expect(response.body).not.toContain('PRIVATE');
      expect(response.body).not.toContain('LATEST_');
      const [saved] = await harness.db.select().from(posts).where(eq(posts.id, target.post.id));
      expect(saved.status).toBe('approved');
      expect(saved.publishedMarkdown).toBe(target.post.publishedMarkdown);
    }
    expect(await harness.publishedEvents()).toHaveLength(0);
  });

  it('requires an independent approved decision, including when the post author is an administrator', async () => {
    for (const approval of [false, 'pending', 'changes_requested'] as const) {
      const target = await harness.fixture({ approval });
      const response = await harness.mutatePublication(target);
      expect(response.statusCode).toBe(409);
      expect(response.body).not.toContain('PRIVATE_REVIEW_NOTE');
    }

    const selfOnly = await harness.fixture({ reviewer: 'author' });
    expect((await harness.mutatePublication(selfOnly)).statusCode).toBe(409);

    const adminAuthor = await harness.fixture({ author: 'adminAuthor', reviewer: 'adminAuthor' });
    expect((await harness.mutatePublication(adminAuthor, 'publish', 'adminAuthor')).statusCode).toBe(409);
    await harness.db.insert(postReviews).values({
      postId: adminAuthor.post.id,
      submittedVersionId: adminAuthor.checkpoint.id,
      reviewerId: harness.people.get('reviewer')!.id,
      decision: 'approved',
      resolvedAt: new Date(),
    });
    expectReceipt(await harness.mutatePublication(adminAuthor, 'publish', 'adminAuthor'), adminAuthor);
  });

  it('preserves publish authority while denying authors, editors, space authors and reviewers', async () => {
    const denied = await harness.fixture({ space: true });
    await harness.db.insert(postCollaborators).values([
      { postId: denied.post.id, userId: harness.people.get('editor')!.id, permission: 'edit' },
      { postId: denied.post.id, userId: harness.people.get('reviewOnly')!.id, permission: 'review' },
    ]);
    for (const caller of ['author', 'editor', 'spaceAuthor', 'reviewOnly'] as const) {
      const response = await harness.mutatePublication(denied, 'publish', caller);
      expect(response.statusCode, caller).toBe(403);
    }

    for (const caller of ['admin', 'moderator', 'maintainer', 'owner'] as const) {
      const target = await harness.fixture({ space: true });
      const response = await harness.mutatePublication(target, 'publish', caller);
      expectReceipt(response, target);
    }
  });

  it('accepts both PAT publish scope aliases and rejects every non-publish scope substitute', async () => {
    const direct = await harness.fixture();
    const directHeaders = await harness.makePat(['post:publish']);
    expectReceipt(await harness.mutatePublication(direct, 'publish', 'admin', undefined, directHeaders), direct);

    const alias = await harness.fixture({ publishedMarkdown: 'OLD_PUBLICATION' });
    const aliasHeaders = await harness.makePat(['posts:publish']);
    expectReceipt(await harness.mutatePublication(alias, 'republish', 'admin', undefined, aliasHeaders), alias);

    const denied = await harness.fixture();
    const deniedHeaders = await harness.makePat(['post:read', 'post:edit', 'post:review', 'admin']);
    const response = await harness.mutatePublication(denied, 'publish', 'admin', undefined, deniedHeaders);
    expect(response.statusCode).toBe(403);
    const [saved] = await harness.db.select().from(posts).where(eq(posts.id, denied.post.id));
    expect(saved.status).toBe('approved');
  });

  it('keeps the prior publication readable during re-review and emits a private-field-free mutation receipt', async () => {
    const target = await harness.fixture({
      snapshot: 'NEW_REVIEWED_PUBLICATION',
      publishedMarkdown: 'RETAINED_OLD_PUBLICATION',
    });
    const before = await harness.instance.app.inject({ method: 'GET', url: `/api/v1/posts/${target.post.id}` });
    expect(before.statusCode).toBe(200);
    expect(before.json().post.derivedMarkdown).toBe('RETAINED_OLD_PUBLICATION');
    expect(before.body).not.toContain('NEW_REVIEWED_PUBLICATION');
    expect(before.body).not.toContain(target.post.workingMarkdown!);

    const response = await harness.mutatePublication(target, 'republish');
    expectReceipt(response, target);
    expect(response.body).not.toContain('NEW_REVIEWED_PUBLICATION');
    expect(response.body).not.toContain(target.post.workingMarkdown!);
    expect(response.body).not.toContain('PRIVATE_EXCERPT');
  });

  it('fails closed when a mocked impossible checkpoint row has a non-string snapshot', async () => {
    const target = await harness.fixture();
    const client = await harness.pool.connect();
    const query = client.query.bind(client);
    const spy = vi.spyOn(client, 'query').mockImplementation(async (...args: any[]) => {
      const result = await query(...args);
      const text = typeof args[0] === 'string' ? args[0] : args[0]?.text;
      if (text?.includes('from "post_versions"') && result?.rows?.length) {
        result.rows = result.rows.map((row: any) => Array.isArray(row)
          ? row.map((value: unknown, index: number) => index === 2 ? null : value)
          : { ...row, markdownSnapshot: null, markdown_snapshot: null });
      }
      return result;
    });
    client.release();
    try {
      const response = await harness.mutatePublication(target);
      expect(response.statusCode).toBe(409);
      expect(response.body).not.toContain('PINNED_APPROVED_CHECKPOINT');
    } finally {
      spy.mockRestore();
    }
  });
});

describe.skipIf(!process.env.GLYPHROOM_TEST_DATABASE_URL)('real PostgreSQL publication serialization and atomicity', () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  beforeEach(async () => { harness = await createHarness(true); });
  afterEach(async () => { vi.restoreAllMocks(); await harness?.close(); });

  async function blockPost(postId: string) {
    const client = await harness.pool.connect();
    await client.query('BEGIN');
    const [{ pid }] = (await client.query('SELECT pg_backend_pid() AS pid')).rows;
    await client.query('SELECT id FROM posts WHERE id = $1 FOR UPDATE', [postId]);
    let finished = false;
    return {
      client,
      pid: Number(pid),
      commit: async () => {
        if (finished) return;
        finished = true;
        await client.query('COMMIT');
        client.release();
      },
      rollback: async () => {
        if (finished) return;
        finished = true;
        await client.query('ROLLBACK');
        client.release();
      },
    };
  }

  async function waitForPostLockWaiters(blockerPid: number, count: number) {
    await expect.poll(async () => Number((await harness.pool.query(`
      WITH RECURSIVE waiters(pid) AS (
        SELECT activity.pid
        FROM pg_stat_activity activity
        WHERE $1::integer = ANY(pg_blocking_pids(activity.pid))
        UNION
        SELECT activity.pid
        FROM pg_stat_activity activity
        JOIN waiters ON waiters.pid = ANY(pg_blocking_pids(activity.pid))
      )
      SELECT count(*) AS count
      FROM waiters
      JOIN pg_stat_activity activity USING (pid)
      WHERE activity.datname = current_database()
        AND activity.wait_event_type = 'Lock'
        AND lower(activity.query) LIKE '%from "posts"%'
        AND lower(activity.query) LIKE '%for update%'
    `, [blockerPid])).rows[0].count), { timeout: 5000, interval: 25 }).toBeGreaterThanOrEqual(count);
  }

  it('serializes publish against its republish alias with one receipt and one durable event', async () => {
    const target = await harness.fixture({ publishedMarkdown: 'OLD_PUBLICATION' });
    const blocker = await blockPost(target.post.id);
    try {
      const direct = Promise.resolve(harness.mutatePublication(target, 'publish', 'admin', { submittedVersionId: target.checkpoint.id, notes: 'Direct publisher notes' }));
      await waitForPostLockWaiters(blocker.pid, 1);
      const alias = Promise.resolve(harness.mutatePublication(target, 'republish', 'admin', { submittedVersionId: target.checkpoint.id, notes: 'Alias publisher notes' }));
      await waitForPostLockWaiters(blocker.pid, 2);
      await blocker.commit();
      const responses = await Promise.all([direct, alias]);
      expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
      const events = await harness.publishedEvents();
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({ publishedVersionId: target.checkpoint.id,
        notes: responses[0].statusCode === 200 ? 'Direct publisher notes' : 'Alias publisher notes' });
      expect(await harness.db.select().from(postVersions).where(eq(postVersions.postId, target.post.id))).toHaveLength(1);
    } finally {
      await blocker.rollback();
    }
  });

  it('serializes publication and withdrawal in both lock-queue orders', async () => {
    const withdrawalFirst = await harness.fixture();
    const firstBlocker = await blockPost(withdrawalFirst.post.id);
    try {
      const withdrawal = Promise.resolve(harness.patch(withdrawalFirst, { status: 'draft' }));
      await waitForPostLockWaiters(firstBlocker.pid, 1);
      const publication = Promise.resolve(harness.mutatePublication(withdrawalFirst));
      await waitForPostLockWaiters(firstBlocker.pid, 2);
      await firstBlocker.commit();
      expect((await withdrawal).statusCode).toBe(200);
      expect((await publication).statusCode).toBe(409);
      const [saved] = await harness.db.select().from(posts).where(eq(posts.id, withdrawalFirst.post.id));
      expect(saved.status).toBe('draft');
      expect(saved.submittedVersionId).toBeNull();
    } finally {
      await firstBlocker.rollback();
    }

    const publicationFirst = await harness.fixture();
    const secondBlocker = await blockPost(publicationFirst.post.id);
    try {
      const publication = Promise.resolve(harness.mutatePublication(publicationFirst));
      await waitForPostLockWaiters(secondBlocker.pid, 1);
      const withdrawal = Promise.resolve(harness.patch(publicationFirst, { status: 'draft' }));
      await waitForPostLockWaiters(secondBlocker.pid, 2);
      await secondBlocker.commit();
      expect((await publication).statusCode).toBe(200);
      expect((await withdrawal).statusCode).toBe(409);
      const [saved] = await harness.db.select().from(posts).where(eq(posts.id, publicationFirst.post.id));
      expect(saved.status).toBe('published');
      expect(saved.publishedVersionId).toBe(publicationFirst.checkpoint.id);
    } finally {
      await secondBlocker.rollback();
    }
  });

  it('rejects delayed old-pin publication and delayed withdrawal after an approved pin replacement', async () => {
    const delayedPublish = await harness.fixture();
    const replacement = await harness.addCheckpoint(delayedPublish, 'REPLACEMENT_CHECKPOINT');
    const publishBlocker = await blockPost(delayedPublish.post.id);
    try {
      const response = Promise.resolve(harness.mutatePublication(delayedPublish));
      await waitForPostLockWaiters(publishBlocker.pid, 1);
      await publishBlocker.client.query('UPDATE posts SET submitted_version_id = $1 WHERE id = $2', [replacement.id, delayedPublish.post.id]);
      await publishBlocker.commit();
      expect((await response).statusCode).toBe(409);
      const [saved] = await harness.db.select().from(posts).where(eq(posts.id, delayedPublish.post.id));
      expect(saved.status).toBe('approved');
      expect(saved.submittedVersionId).toBe(replacement.id);
    } finally {
      await publishBlocker.rollback();
    }

    const delayedWithdrawal = await harness.fixture();
    const replacementForWithdrawal = await harness.addCheckpoint(delayedWithdrawal, 'WITHDRAWAL_REPLACEMENT');
    const withdrawalBlocker = await blockPost(delayedWithdrawal.post.id);
    try {
      const response = Promise.resolve(harness.patch(delayedWithdrawal, { status: 'draft' }));
      await waitForPostLockWaiters(withdrawalBlocker.pid, 1);
      await withdrawalBlocker.client.query('UPDATE posts SET submitted_version_id = $1 WHERE id = $2', [
        replacementForWithdrawal.id,
        delayedWithdrawal.post.id,
      ]);
      await withdrawalBlocker.commit();
      expect((await response).statusCode).toBe(409);
      const [saved] = await harness.db.select().from(posts).where(eq(posts.id, delayedWithdrawal.post.id));
      expect(saved.status).toBe('approved');
      expect(saved.submittedVersionId).toBe(replacementForWithdrawal.id);
    } finally {
      await withdrawalBlocker.rollback();
    }
  });

  it('allows metadata-only PATCH in both lock-queue orders without overwriting publication workflow fields', async () => {
    const metadataFirst = await harness.fixture();
    const firstBlocker = await blockPost(metadataFirst.post.id);
    try {
      const metadata = Promise.resolve(harness.patch(metadataFirst, { title: 'Metadata committed first' }));
      await waitForPostLockWaiters(firstBlocker.pid, 1);
      const publication = Promise.resolve(harness.mutatePublication(metadataFirst));
      await waitForPostLockWaiters(firstBlocker.pid, 2);
      await firstBlocker.commit();
      expect((await metadata).statusCode).toBe(200);
      expect((await publication).statusCode).toBe(200);
      const [saved] = await harness.db.select().from(posts).where(eq(posts.id, metadataFirst.post.id));
      expect(saved.title).toBe('Metadata committed first');
      expect(saved.status).toBe('published');
      expect(saved.publishedVersionId).toBe(metadataFirst.checkpoint.id);
      expect(saved.workingMarkdown).toBe(metadataFirst.post.workingMarkdown);
    } finally {
      await firstBlocker.rollback();
    }

    const publicationFirst = await harness.fixture();
    const secondBlocker = await blockPost(publicationFirst.post.id);
    try {
      const publication = Promise.resolve(harness.mutatePublication(publicationFirst));
      await waitForPostLockWaiters(secondBlocker.pid, 1);
      const metadata = Promise.resolve(harness.patch(publicationFirst, { title: 'Metadata committed second' }));
      await waitForPostLockWaiters(secondBlocker.pid, 2);
      await secondBlocker.commit();
      expect((await publication).statusCode).toBe(200);
      expect((await metadata).statusCode).toBe(200);
      const [saved] = await harness.db.select().from(posts).where(eq(posts.id, publicationFirst.post.id));
      expect(saved.title).toBe('Metadata committed second');
      expect(saved.status).toBe('published');
      expect(saved.submittedVersionId).toBeNull();
      expect(saved.publishedVersionId).toBe(publicationFirst.checkpoint.id);
      expect(saved.workingMarkdown).toBe(publicationFirst.post.workingMarkdown);
    } finally {
      await secondBlocker.rollback();
    }
  });

  it('rechecks inactive accounts, downgraded roles and removed space grants after waiting for the post lock', async () => {
    const inactive = await harness.fixture();
    const inactiveBlocker = await blockPost(inactive.post.id);
    try {
      const response = Promise.resolve(harness.mutatePublication(inactive));
      await waitForPostLockWaiters(inactiveBlocker.pid, 1);
      await harness.db.update(users).set({ isActive: false }).where(eq(users.id, harness.people.get('admin')!.id));
      await inactiveBlocker.commit();
      expect((await response).statusCode).toBe(401);
    } finally {
      await inactiveBlocker.rollback();
    }
    await harness.db.update(users).set({ isActive: true }).where(eq(users.id, harness.people.get('admin')!.id));

    const downgraded = await harness.fixture();
    const downgradedBlocker = await blockPost(downgraded.post.id);
    try {
      const response = Promise.resolve(harness.mutatePublication(downgraded));
      await waitForPostLockWaiters(downgradedBlocker.pid, 1);
      await harness.db.update(users).set({ role: 'reader' }).where(eq(users.id, harness.people.get('admin')!.id));
      await downgradedBlocker.commit();
      expect((await response).statusCode).toBe(403);
    } finally {
      await downgradedBlocker.rollback();
    }

    const removedGrant = await harness.fixture({ space: true });
    const grantBlocker = await blockPost(removedGrant.post.id);
    try {
      const response = Promise.resolve(harness.mutatePublication(removedGrant, 'publish', 'maintainer'));
      await waitForPostLockWaiters(grantBlocker.pid, 1);
      await harness.db.delete(spaceMembers).where(and(
        eq(spaceMembers.spaceId, harness.space.id),
        eq(spaceMembers.userId, harness.people.get('maintainer')!.id),
      ));
      await grantBlocker.commit();
      expect((await response).statusCode).toBe(403);
    } finally {
      await grantBlocker.rollback();
    }
  });

  it('rolls back post, pin and a real transactional outbox insert when enqueue throws afterward', async () => {
    const target = await harness.fixture();
    const enqueue = harness.instance.outboxService.enqueue.bind(harness.instance.outboxService);
    vi.spyOn(harness.instance.outboxService, 'enqueue').mockImplementationOnce(async (...args: any[]) => {
      await enqueue(...args);
      throw new Error('failure after transactional insert');
    });
    const response = await harness.mutatePublication(target, 'publish', 'admin', { submittedVersionId: target.checkpoint.id, notes: 'Rolled back publisher notes' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Service Unavailable', message: 'Unable to publish the approved checkpoint' });
    const [saved] = await harness.db.select().from(posts).where(eq(posts.id, target.post.id));
    expect(saved.status).toBe('approved');
    expect(saved.submittedVersionId).toBe(target.checkpoint.id);
    expect(saved.publishedMarkdown).toBeNull();
    expect(await harness.publishedEvents()).toHaveLength(0);
    expectReceipt(await harness.mutatePublication(target, 'publish', 'admin', { submittedVersionId: target.checkpoint.id, notes: 'Successful retry notes' }), target);
    const [event] = await harness.publishedEvents();
    expect(event.payload).toMatchObject({ publishedVersionId: target.checkpoint.id, notes: 'Successful retry notes' });
    expect(await harness.publishedEvents()).toHaveLength(1);
  });

  it('treats audit and notification failures as post-commit delivery failures and does not double-enqueue on retry', async () => {
    const target = await harness.fixture();
    const audit = vi.spyOn(AuditService.prototype, 'appendLog').mockRejectedValueOnce(new Error('audit unavailable'));
    const notification = vi.spyOn(NotificationService.prototype, 'create').mockRejectedValueOnce(new Error('notifications unavailable'));
    expectReceipt(await harness.mutatePublication(target, 'publish', 'admin', { submittedVersionId: target.checkpoint.id, notes: '' }), target);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: {
      versionId: target.checkpoint.id, versionNumber: target.checkpoint.versionNumber, notes: '',
    } }));
    expect(notification).toHaveBeenCalledTimes(1);
    expect((await harness.mutatePublication(target, 'publish', 'admin', { submittedVersionId: target.checkpoint.id, notes: 'Duplicate attempt notes' })).statusCode).toBe(409);
    const events = await harness.publishedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ publishedVersionId: target.checkpoint.id, notes: '' });
  });
});
