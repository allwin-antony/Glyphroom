import { randomUUID, createHash } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { createApiApp } from '../src/app.js';
import { AuthService } from '../src/services/auth.js';
import { users, posts, postVersions, postReviews, postCollaborators, personalAccessTokens } from '../src/db/schema.js';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { createPostgresTestDatabase } from './helpers/postgres-db.js';
import type { Database } from '../src/db/index.js';

const SECRET = 'review-binding-test-session-secret-32-characters';

function state(text: string) {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  if (text) paragraph.insert(0, [new Y.XmlText(text)]);
  doc.getXmlFragment('prosemirror').insert(0, [paragraph]);
  const bytes = Buffer.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return bytes;
}

for (const postgres of [false, true]) {
  describe.skipIf(postgres && !process.env.GLYPHROOM_TEST_DATABASE_URL)(
    `review checkpoint decision binding (${postgres ? 'PostgreSQL' : 'in-memory'})`, () => {
      let db: Database;
      let instance: Awaited<ReturnType<typeof createApiApp>>;
      let closeDb: () => Promise<void>;
      let pool: any;
      const people = new Map<string, { id: string; headers: Record<string, string> }>();

      beforeEach(async () => {
        const database = postgres ? await createPostgresTestDatabase() : createInMemoryDatabase();
        db = database.db;
        pool = database.pool;
        closeDb = 'close' in database ? database.close : () => database.pool.end();
        const auth = new AuthService(db, SECRET);
        for (const [name, role] of [['author', 'author'], ['reviewer', 'moderator'], ['viewer', 'reader'],
          ['reader', 'reader'], ['admin', 'admin']] as const) {
          const [user] = await db.insert(users).values({ email: `${name}@binding.test`, fullName: name, role }).returning();
          const cookie = auth.createSessionToken(user);
          people.set(name, { id: user.id, headers: { cookie: `blogger_session=${cookie}`, 'x-csrf-token': auth.generateCsrfToken(cookie) } });
        }
        instance = await createApiApp({ db, sessionSecret: SECRET });
        await instance.app.ready();
      });
      afterEach(async () => { vi.restoreAllMocks(); await instance?.close(); await closeDb?.(); });

      async function fixture() {
        const id = randomUUID();
        const [post] = await db.insert(posts).values({ id, slug: `binding-${id}`, title: 'Binding fixture',
          authorId: people.get('author')!.id, status: 'in_review', yjsState: state('WORKING'), workingMarkdown: 'WORKING',
          publishedMarkdown: 'PREVIOUS_PUBLICATION',
        }).returning();
        const versions = [];
        for (const [versionNumber, markdown] of [[1, 'FIRST_SUBMISSION'], [2, '']] as const) {
          const [version] = await db.insert(postVersions).values({ postId: id, versionNumber, triggerReason: 'review_submission',
            yjsStateSnapshot: state(markdown), markdownSnapshot: markdown, createdBy: people.get('author')!.id }).returning();
          versions.push(version);
        }
        await db.update(posts).set({ submittedVersionId: versions[0].id }).where(eq(posts.id, id));
        await db.insert(postCollaborators).values([
          { postId: id, userId: people.get('viewer')!.id, permission: 'view' },
          { postId: id, userId: people.get('reviewer')!.id, permission: 'review' },
        ]);
        return { post, first: versions[0], second: versions[1] };
      }

      function decide(id: string, submittedVersionId?: string, decision = 'approved', caller = 'reviewer', app = instance.app) {
        return app.inject({ method: 'POST', url: `/api/v1/posts/${id}/reviews`, headers: people.get(caller)!.headers,
          payload: { decision, submittedVersionId, notes: 'Reviewed the displayed checkpoint.' } });
      }

      it('requires an explicit displayed ID and rejects stale preview decisions while preserving valid empty submissions', async () => {
        const { post, first, second } = await fixture();
        expect((await decide(post.id)).statusCode).toBe(400);
        expect((await decide(post.id, 'not-a-uuid')).statusCode).toBe(400);
        expect((await decide(post.id, randomUUID())).statusCode).toBe(409);
        await db.update(posts).set({ submittedVersionId: second.id }).where(eq(posts.id, post.id));
        expect((await decide(post.id, first.id)).statusCode).toBe(409);
        expect(await db.select().from(postReviews)).toHaveLength(0);
        const response = await decide(post.id, second.id);
        expect(response.statusCode, response.body).toBe(201);
        expect(response.json().review.submittedVersionId).toBe(second.id);
        const [saved] = await db.select().from(posts).where(eq(posts.id, post.id));
        expect(saved.status).toBe('approved');
        expect(saved.submittedVersionId).toBe(second.id);
        expect(saved.publishedMarkdown).toBe('PREVIOUS_PUBLICATION');
      });

      it('rejects absent, cross-post, wrong-kind and inactive pins without substituting the latest submission', async () => {
        const { post, first } = await fixture();
        const other = await fixture();
        for (const pin of [null, other.first.id, first.id]) {
          if (pin === first.id) await db.update(postVersions).set({ triggerReason: 'manual_save' }).where(eq(postVersions.id, first.id));
          await db.update(posts).set({ submittedVersionId: pin }).where(eq(posts.id, post.id));
          expect((await decide(post.id, pin ?? first.id)).statusCode).toBe(409);
          expect(await db.select().from(postReviews)).toHaveLength(0);
        }
        await db.update(posts).set({ status: 'draft' }).where(eq(posts.id, post.id));
        expect((await decide(post.id, first.id)).statusCode).toBe(409);
      });

      it('keeps self-review forbidden and rechecks role, account and PAT review scope', async () => {
        const { post, first } = await fixture();
        for (const caller of ['author', 'viewer', 'reader']) expect((await decide(post.id, first.id, 'approved', caller)).statusCode).toBe(403);
        await db.update(users).set({ role: 'reader' }).where(eq(users.id, people.get('admin')!.id));
        expect((await decide(post.id, first.id, 'approved', 'admin')).statusCode).toBe(403);
        expect((await instance.app.inject({ url: `/api/v1/posts/${post.id}/reviews`, headers: people.get('admin')!.headers })).statusCode).toBe(403);
        await db.update(users).set({ isActive: false }).where(eq(users.id, people.get('reviewer')!.id));
        expect((await decide(post.id, first.id)).statusCode).toBe(401);
        expect((await instance.app.inject({ url: `/api/v1/posts/${post.id}/reviews`, headers: people.get('reviewer')!.headers })).statusCode).toBe(401);
        await db.update(users).set({ isActive: true }).where(eq(users.id, people.get('reviewer')!.id));
        const token = `eb_pat_${randomUUID()}`;
        await db.insert(personalAccessTokens).values({ userId: people.get('reviewer')!.id, name: 'read only',
          tokenHash: createHash('sha256').update(token).digest('hex'), scopes: ['post:read'] });
        const response = await instance.app.inject({ method: 'POST', url: `/api/v1/posts/${post.id}/reviews`,
          headers: { authorization: `Bearer ${token}` }, payload: { decision: 'approved', submittedVersionId: first.id } });
        expect(response.statusCode).toBe(403);
        expect(await db.select().from(postReviews)).toHaveLength(0);
      });

      it('limits review notes to editors or the active review grant and pin', async () => {
        const { post, first, second } = await fixture();
        for (const [version, notes] of [[first, 'HISTORICAL_REVIEW_SECRET'], [second, 'ACTIVE_REVIEW_NOTE']] as const) {
          await db.insert(postReviews).values({ postId: post.id, submittedVersionId: version.id,
            reviewerId: people.get('reviewer')!.id, decision: 'approved', notes });
        }
        await db.update(posts).set({ status: 'approved', submittedVersionId: second.id }).where(eq(posts.id, post.id));
        const read = (caller: string) => instance.app.inject({ url: `/api/v1/posts/${post.id}/reviews`, headers: people.get(caller)!.headers });
        for (const caller of ['viewer', 'reader']) {
          const denied = await read(caller);
          expect(denied.statusCode).toBe(403);
          expect(denied.body).not.toContain('REVIEW_');
        }
        const reviewer = await read('reviewer');
        expect(reviewer.statusCode).toBe(200);
        expect(reviewer.json().reviews).toHaveLength(1);
        expect(reviewer.body).not.toContain('HISTORICAL_REVIEW_SECRET');
        expect((await read('author')).json().reviews).toHaveLength(2);
        await db.update(posts).set({ status: 'published', submittedVersionId: null }).where(eq(posts.id, post.id));
        expect((await read('reviewer')).statusCode).toBe(403);
      });

      it.skipIf(!postgres)('serializes competing decisions across API instances on the same displayed checkpoint', async () => {
        const { post, first } = await fixture();
        const other = await createApiApp({ db, sessionSecret: SECRET });
        try {
          const responses = await Promise.all([decide(post.id, first.id), decide(post.id, first.id, 'changes_requested', 'admin', other.app)]);
          expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
          expect(await db.select().from(postReviews).where(eq(postReviews.postId, post.id))).toHaveLength(1);
        } finally { await other.close(); }
      });

      it.skipIf(!postgres)('rolls back decision and status together on outbox failure', async () => {
        const { post, first } = await fixture();
        vi.spyOn(instance.outboxService, 'enqueue').mockRejectedValueOnce(new Error('outbox unavailable'));
        expect((await decide(post.id, first.id)).statusCode).toBe(503);
        expect(await db.select().from(postReviews)).toHaveLength(0);
        const [saved] = await db.select().from(posts).where(eq(posts.id, post.id));
        expect(saved.status).toBe('in_review');
        expect(saved.submittedVersionId).toBe(first.id);
      });

      it.skipIf(!postgres)('keeps note eligibility coherent when a concurrent decision withdraws the active pin', async () => {
        const { post, first } = await fixture();
        let reachedNotes!: () => void;
        let releaseNotes!: () => void;
        const reached = new Promise<void>((resolve) => { reachedNotes = resolve; });
        const release = new Promise<void>((resolve) => { releaseNotes = resolve; });
        // The last released pool client is used by the GET transaction. Pause
        // only its notes SELECT, after eligibility/pin checks, preserving real locks.
        const client = await pool.connect();
        const query = client.query.bind(client);
        let paused = false;
        vi.spyOn(client, 'query').mockImplementation((...args: any[]) => {
          const text = typeof args[0] === 'string' ? args[0] : args[0]?.text;
          if (!paused && text?.startsWith('select') && text.includes('from "post_reviews"')) {
            paused = true;
            reachedNotes();
            return release.then(() => query(...args));
          }
          return query(...args);
        });
        client.release();
        const notes = Promise.resolve(instance.app.inject({ url: `/api/v1/posts/${post.id}/reviews`, headers: people.get('reviewer')!.headers }));
        await reached;
        const decision = Promise.resolve(decide(post.id, first.id, 'changes_requested'));
        try {
          await expect.poll(async () => Number((await pool.query(`SELECT count(*) AS count FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE 'select%from "posts"%for update%'`)).rows[0].count), { timeout: 3000 }).toBeGreaterThan(0);
        } finally { releaseNotes(); }
        expect((await notes).json().reviews).toEqual([]);
        expect((await decision).statusCode).toBe(201);
        expect((await instance.app.inject({ url: `/api/v1/posts/${post.id}/reviews`, headers: people.get('reviewer')!.headers })).statusCode).toBe(403);
      });
    });
}
