import { createHash, randomUUID } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { createApiApp } from '../src/app.js';
import { AuthService } from '../src/services/auth.js';
import { AuditService } from '../src/services/audit.js';
import { NotificationService } from '../src/services/notifications.js';
import { CollabService, CollabServiceError } from '../src/services/collab.js';
import { posts, postVersions, users, pluginEventOutbox } from '../src/db/schema.js';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { createPostgresTestDatabase } from './helpers/postgres-db.js';
import { createCollabServer } from '../../collab/src/server.js';
import { PostgresPersistenceAdapter } from '../../collab/src/persistence/postgres.js';
import type { Database } from '../src/db/index.js';

const SECRET = 'capture-test-session-secret-32-characters';

function snapshot(markdown: string) {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  if (markdown) paragraph.insert(0, [new Y.XmlText(markdown)]);
  doc.getXmlFragment('prosemirror').insert(0, [paragraph]);
  const yjsState = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return { yjsState, workingMarkdown: markdown, fingerprint: createHash('sha256').update(yjsState).digest('hex') };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

for (const realPostgres of [false, true]) {
  describe.skipIf(realPostgres && !process.env.GLYPHROOM_TEST_DATABASE_URL)(
    `fail-closed review capture (${realPostgres ? 'real PostgreSQL + collab HTTP' : 'in-memory contracts'})`, () => {
      let db: Database;
      let app: Awaited<ReturnType<typeof createApiApp>>['app'];
      let instance: Awaited<ReturnType<typeof createApiApp>>;
      let closeDb: () => Promise<void>;
      let collab: Awaited<ReturnType<typeof createCollabServer>> | undefined;
      let service: CollabService;
      let authorId: string;
      let headers: Record<string, string>;

      beforeEach(async () => {
        const database = realPostgres ? await createPostgresTestDatabase() : createInMemoryDatabase();
        db = database.db;
        closeDb = 'close' in database ? database.close : () => database.pool.end();
        const [author] = await db.insert(users).values({ email: 'author@capture.test', fullName: 'Author', role: 'author' }).returning();
        authorId = author.id;
        const auth = new AuthService(db, SECRET);
        const cookie = auth.createSessionToken(author);
        headers = { cookie: `blogger_session=${cookie}`, 'x-csrf-token': auth.generateCsrfToken(cookie) };
        if (realPostgres) {
          collab = await createCollabServer({ port: 0, address: '127.0.0.1', gatewaySecret: 'capture-test-gateway-secret',
            adapter: new PostgresPersistenceAdapter({ pool: database.pool, allowAutoInsert: false }), quiet: true });
          const { port } = await collab.listen();
          service = new CollabService({ collabUrl: `http://127.0.0.1:${port}`, gatewaySecret: 'capture-test-gateway-secret' });
        } else {
          service = { flushDocument: vi.fn(async (id: string) => ({ inMemory: false, documentName: `post-${id}` })) } as unknown as CollabService;
        }
        instance = await createApiApp({ db, sessionSecret: SECRET, collabService: service });
        app = instance.app;
        await app.ready();
      });

      afterEach(async () => {
        vi.restoreAllMocks();
        await instance?.close();
        await collab?.destroy();
        collab = undefined;
        await closeDb?.();
      });

      async function fixture(markdown = 'ORIGINAL_WORKING', status: 'draft' | 'published' = 'draft') {
        const id = randomUUID();
        const state = snapshot(markdown);
        const [post] = await db.insert(posts).values({ id, slug: `capture-${id}`, title: 'Capture fixture', authorId,
          status, yjsState: Buffer.from(state.yjsState), workingMarkdown: 'STALE_CACHE',
          publishedMarkdown: status === 'published' ? 'PREVIOUS_PUBLICATION' : null,
        }).returning();
        return post;
      }

      function submit(id: string, api = app) {
        return api.inject({ method: 'POST', url: `/api/v1/posts/${id}/submit-review`, headers });
      }

      async function unchanged(id: string) {
        const [post] = await db.select().from(posts).where(eq(posts.id, id));
        expect(post.status).toBe('draft');
        expect(post.submittedVersionId).toBeNull();
        expect(await db.select().from(postVersions).where(eq(postVersions.postId, id))).toHaveLength(0);
        expect(await db.select().from(pluginEventOutbox).where(eq(pluginEventOutbox.eventType, 'post:submitted_for_review'))).toHaveLength(0);
      }

      it('requires a successful capture acknowledgement and rejects malformed or incoherent snapshots', async () => {
        const post = await fixture();
        const valid = { inMemory: true, documentName: `post-${post.id}`, ...snapshot('CAPTURE') };
        const errors = [new CollabServiceError('UNAVAILABLE', 'timeout'), new CollabServiceError('UNAUTHORIZED', 'bad credentials'),
          new CollabServiceError('PERSISTENCE_FAILED', 'failed'), new Error('unavailable')];
        const flush = vi.spyOn(service, 'flushDocument');
        for (const error of errors) {
          flush.mockRejectedValueOnce(error);
          const response = await submit(post.id);
          expect(response.statusCode).toBe(503);
          expect(response.body).not.toContain('ORIGINAL_WORKING');
          await unchanged(post.id);
        }
        for (const result of [{ ...valid, documentName: `post-${randomUUID()}` }, { ...valid, workingMarkdown: 'STALE' },
          { ...valid, yjsState: new Uint8Array([1]) }, { ...valid, fingerprint: '0'.repeat(64) },
          { inMemory: false, documentName: valid.documentName, workingMarkdown: '' }]) {
          flush.mockResolvedValueOnce(result as any);
          expect((await submit(post.id)).statusCode).toBe(503);
          await unchanged(post.id);
        }
      });

      it('rereads after inactive acknowledgement and derives a coherent checkpoint without cache fallback', async () => {
        const post = await fixture();
        const latest = snapshot('AFTER_INACTIVE_ACK');
        const actual = service.flushDocument.bind(service);
        vi.spyOn(service, 'flushDocument').mockImplementationOnce(async (id) => {
          const result = await actual(id);
          expect(result.inMemory).toBe(false);
          await db.update(posts).set({ yjsState: Buffer.from(latest.yjsState), workingMarkdown: 'WRONG_CACHE' }).where(eq(posts.id, id));
          return result;
        });
        const response = await submit(post.id);
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json().submittedVersion.markdownSnapshot).toBe('AFTER_INACTIVE_ACK');
        const [version] = await db.select().from(postVersions).where(eq(postVersions.postId, post.id));
        expect(version.yjsStateSnapshot).toEqual(Buffer.from(latest.yjsState));
        const [working] = await db.select().from(posts).where(eq(posts.id, post.id));
        expect(working.workingMarkdown).toBe('WRONG_CACHE');
        expect(working.yjsState).toEqual(Buffer.from(latest.yjsState));
      });

      it('preserves empty capture and later working edits, including during re-review of a publication', async () => {
        const post = await fixture('ORIGINAL', 'published');
        const empty = snapshot('');
        const later = snapshot('LATER_WORKING');
        vi.spyOn(service, 'flushDocument').mockImplementationOnce(async (id) => {
          await db.update(posts).set({ yjsState: Buffer.from(later.yjsState), workingMarkdown: later.workingMarkdown }).where(eq(posts.id, id));
          return { inMemory: true, documentName: `post-${id}`, ...empty };
        });
        const response = await submit(post.id);
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json().submittedVersion.markdownSnapshot).toBe('');
        const [working] = await db.select().from(posts).where(eq(posts.id, post.id));
        expect(working.publishedMarkdown).toBe('PREVIOUS_PUBLICATION');
        expect(working.workingMarkdown).toBe('LATER_WORKING');
        expect(working.yjsState).toEqual(Buffer.from(later.yjsState));
      });

      it('rejects unavailable inactive state instead of manufacturing a title or cache snapshot', async () => {
        const post = await fixture();
        await db.update(posts).set({ yjsState: Buffer.from([1]), workingMarkdown: 'CACHE_IS_NOT_A_CAPTURE' }).where(eq(posts.id, post.id));
        expect((await submit(post.id)).statusCode).toBe(503);
        await unchanged(post.id);
      });

      it('rechecks edit access after capture and does not treat post-commit delivery failure as rollback', async () => {
        const post = await fixture();
        const actual = service.flushDocument.bind(service);
        vi.spyOn(service, 'flushDocument').mockImplementationOnce(async (id) => {
          const result = await actual(id);
          await db.update(users).set({ isActive: false }).where(eq(users.id, authorId));
          return result;
        });
        expect((await submit(post.id)).statusCode).toBe(403);
        await unchanged(post.id);
        await db.update(users).set({ isActive: true }).where(eq(users.id, authorId));
        vi.spyOn(AuditService.prototype, 'appendLog').mockRejectedValueOnce(new Error('audit outage'));
        vi.spyOn(NotificationService.prototype, 'notifyAdminsAndModerators').mockRejectedValueOnce(new Error('delivery outage'));
        expect((await submit(post.id)).statusCode).toBe(200);
        expect((await submit(post.id)).statusCode).toBe(409);
        expect(await db.select().from(postVersions).where(eq(postVersions.postId, post.id))).toHaveLength(1);
      });

      it.skipIf(!realPostgres)('serializes simultaneous submissions from two API instances without a row lock across flush', async () => {
        const post = await fixture();
        const second = await createApiApp({ db, sessionSecret: SECRET, collabService: service });
        const arrived = deferred();
        let count = 0;
        const actual = service.flushDocument.bind(service);
        vi.spyOn(service, 'flushDocument').mockImplementation(async (id) => {
          if (++count === 2) arrived.resolve();
          await arrived.promise;
          // A row lock held across flush would deadlock this independent update.
          await db.update(posts).set({ title: 'Changed while capturing' }).where(eq(posts.id, id));
          return actual(id);
        });
        try {
          const results = await Promise.all([submit(post.id), submit(post.id, second.app)]);
          expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
          const versions = await db.select().from(postVersions).where(eq(postVersions.postId, post.id));
          expect(versions).toHaveLength(1);
          expect(versions[0].versionNumber).toBe(1);
          const [saved] = await db.select().from(posts).where(eq(posts.id, post.id));
          expect(saved.submittedVersionId).toBe(versions[0].id);
        } finally { await second.close(); }
      });

      it.skipIf(!realPostgres)('rolls back the checkpoint and pin together when durable outbox insertion fails', async () => {
        const post = await fixture();
        vi.spyOn(instance.outboxService, 'enqueue').mockRejectedValueOnce(new Error('outbox unavailable'));
        expect((await submit(post.id)).statusCode).toBe(503);
        await unchanged(post.id);
      });

      it.skipIf(!realPostgres)('rejects an old capture after a competing submit/revert cycle (ABA)', async () => {
        const post = await fixture();
        const captured = deferred();
        const release = deferred();
        const actual = service.flushDocument.bind(service);
        vi.spyOn(service, 'flushDocument').mockImplementationOnce(async (id) => {
          const result = await actual(id);
          captured.resolve();
          await release.promise;
          return result;
        });
        const old = Promise.resolve(submit(post.id));
        await captured.promise;
        expect((await submit(post.id)).statusCode).toBe(200);
        expect((await app.inject({ method: 'PATCH', url: `/api/v1/posts/${post.id}`, headers, payload: { status: 'draft' } })).statusCode).toBe(200);
        release.resolve();
        expect((await old).statusCode).toBe(409);
        expect(await db.select().from(postVersions).where(eq(postVersions.postId, post.id))).toHaveLength(1);
      });

      it.skipIf(!realPostgres)('captures actual live collab room state over authenticated HTTP, including empty content', async () => {
        const post = await fixture();
        const room = `post-${post.id}`;
        const connection = await collab!.server.hocuspocus.openDirectConnection(room, {
          user: { id: authorId, role: 'author', name: 'Author', permissions: ['edit'] }, documentName: room,
        });
        await connection.transact((doc) => { const fragment = doc.getXmlFragment('prosemirror'); fragment.delete(0, fragment.length); });
        const response = await submit(post.id);
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json().submittedVersion.markdownSnapshot).toBe('');
        const [version] = await db.select().from(postVersions).where(and(eq(postVersions.postId, post.id), eq(postVersions.triggerReason, 'review_submission')));
        const decoded = new Y.Doc();
        Y.applyUpdate(decoded, version.yjsStateSnapshot);
        expect(decoded.getXmlFragment('prosemirror').length).toBe(0);
        decoded.destroy();
        await connection.disconnect();
      });
    });
}
