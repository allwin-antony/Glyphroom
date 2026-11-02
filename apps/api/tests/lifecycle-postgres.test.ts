import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { exportDerivedMarkdown } from '@enterprise-blogger/shared';
import { createPostgresTestDatabase } from './helpers/postgres-db.js';
import { createCollabServer, type CollabServerInstance } from '../../collab/src/server.js';
import { PostgresPersistenceAdapter } from '../../collab/src/persistence/postgres.js';
import { CollabService, fingerprintDocumentState, deriveDocumentSnapshot } from '../src/services/collab.js';
import { createApiApp } from '../src/app.js';
import {
  users,
  posts,
  postVersions,
  postReviews,
  spaces,
  spaceMembers,
  postCollaborators,
  postAttachments,
  comments,
  postTags,
  tags,
  auditLogs,
} from '../src/db/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';

function createDocWithText(text: string): Y.Doc {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  if (text) {
    paragraph.insert(0, [new Y.XmlText(text)]);
  }
  doc.getXmlFragment('prosemirror').insert(0, [paragraph]);
  return doc;
}

function docBytes(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

function docSnapshot(doc: Y.Doc) {
  const bytes = docBytes(doc);
  const snapshot = deriveDocumentSnapshot(bytes);
  return {
    bytes,
    buffer: Buffer.from(bytes),
    markdown: snapshot.workingMarkdown,
    fingerprint: snapshot.fingerprint,
  };
}

function causalRestore(currentBytes: Uint8Array, targetBytes: Uint8Array): Uint8Array {
  const current = new Y.Doc();
  const target = new Y.Doc();
  try {
    Y.applyUpdate(current, currentBytes);
    Y.applyUpdate(target, targetBytes);
    const destination = current.getXmlFragment('prosemirror');
    const content = target.getXmlFragment('prosemirror').toArray()
      .map((node) => (node as Y.XmlElement | Y.XmlText).clone());
    current.transact(() => {
      destination.delete(0, destination.length);
      if (content.length) destination.insert(0, content);
    }, 'test-causal-restore');
    return Y.encodeStateAsUpdate(current);
  } finally {
    current.destroy();
    target.destroy();
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class DroppingForwardProxy {
  private server: http.Server;
  public url = '';
  public targetUrl: string;
  public dropRestoreResponse = false;
  public onBeforeRestoreDispatch?: (targetState: Uint8Array, expectedCurrentFingerprint: string) => Promise<void> | void;
  public onAfterFlushResponse?: (capture: {
    success: boolean; documentName: string; inMemory: boolean;
    yjsState?: string; workingMarkdown?: string; fingerprint?: string;
  }) => Promise<void> | void;
  public onRestorePersisted?: () => void;

  constructor(targetUrl: string) {
    this.targetUrl = targetUrl;
    this.server = http.createServer(async (req, res) => {
      const target = new URL(this.targetUrl);
      const isRestore = req.url?.includes('/restore');
      const isFlush = req.url?.includes('/flush');

      const forwardError = (err: unknown) => {
        if (!res.headersSent) {
          res.writeHead(502);
          res.end(JSON.stringify({ error: 'Proxy error', message: err instanceof Error ? err.message : String(err) }));
        }
      };

      try {
        let restoreBody: Buffer | undefined;
        if (isRestore && this.onBeforeRestoreDispatch) {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          restoreBody = Buffer.concat(chunks);
          const body = JSON.parse(restoreBody.toString());
          // The internal URL contains the document ID, not the historical version ID.
          await this.onBeforeRestoreDispatch(new Uint8Array(Buffer.from(body.yjsState, 'base64')), body.expectedCurrentFingerprint);
        }

        const options: http.RequestOptions = {
          hostname: target.hostname,
          port: target.port,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: `${target.hostname}:${target.port}` },
        };

        const proxyReq = http.request(options, async (proxyRes) => {
          try {
            const upstreamSucceeded = (proxyRes.statusCode ?? 0) >= 200 && (proxyRes.statusCode ?? 0) < 300;
            if (isFlush && upstreamSucceeded && this.onAfterFlushResponse) {
              const chunks: Buffer[] = [];
              for await (const chunk of proxyRes) chunks.push(Buffer.from(chunk));
              const body = Buffer.concat(chunks);
              // Only a complete successful capture response may advance or hold a race barrier.
              await this.onAfterFlushResponse(JSON.parse(body.toString()));
              res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
              res.end(body);
              return;
            }
            if (isRestore && upstreamSucceeded) {
              proxyRes.on('end', () => this.onRestorePersisted?.());
              if (this.dropRestoreResponse) {
                // Only a genuinely successful upstream restore may drop the acknowledgement.
                proxyRes.on('end', () => req.socket.destroy());
                proxyRes.on('error', () => { this.onRestorePersisted?.(); req.socket.destroy(); });
                proxyRes.resume();
                return;
              }
            }
            res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
            proxyRes.pipe(res);
          } catch (err) {
            forwardError(err);
          }
        });

        proxyReq.on('error', forwardError);
        if (restoreBody) proxyReq.end(restoreBody);
        else req.pipe(proxyReq);
      } catch (err) {
        forwardError(err);
      }
    });
  }

  async listen(): Promise<string> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as net.AddressInfo;
        this.url = `http://127.0.0.1:${addr.port}`;
        resolve(this.url);
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

describe.skipIf(!process.env.GLYPHROOM_TEST_DATABASE_URL)('Lifecycle PostgreSQL & Real Collaboration Persistence Integration', () => {
  let dbTest: Awaited<ReturnType<typeof createPostgresTestDatabase>>;
  let schema: string;
  let collabPool: pg.Pool;
  let observerPool: pg.Pool;
  let adapter: PostgresPersistenceAdapter;
  let collabServer: CollabServerInstance;
  let proxy: DroppingForwardProxy;
  let collabService: CollabService;
  let apiInstance: Awaited<ReturnType<typeof createApiApp>>;
  let authorUser: any;
  let authHeaders: Record<string, string>;
  const gatewaySecret = 'test-lifecycle-pg-gateway-secret-2026';
  let slugCounter = 0;

  beforeAll(async () => {
    // 1. Create disposable PostgreSQL test database and schema
    dbTest = await createPostgresTestDatabase();
    const { rows } = await dbTest.pool.query('SELECT current_schema() as s');
    schema = rows[0].s;

    // 2. Build dedicated collab and observer pools strictly bounded to the same disposable schema
    const connectionString = process.env.GLYPHROOM_TEST_DATABASE_URL;
    if (!connectionString) throw new Error('GLYPHROOM_TEST_DATABASE_URL is required for the PostgreSQL lifecycle suite');
    collabPool = new pg.Pool({ connectionString, options: `-c search_path=${schema},public` });
    observerPool = new pg.Pool({ connectionString, options: `-c search_path=${schema},public` });

    // Explicitly verify the API, collab adapter, and observer all observe the exact same disposable schema
    const [sApi] = (await dbTest.pool.query('SELECT current_schema() as s')).rows;
    const [sCollab] = (await collabPool.query('SELECT current_schema() as s')).rows;
    const [sObs] = (await observerPool.query('SELECT current_schema() as s')).rows;
    expect(sApi.s).toBe(schema);
    expect(sCollab.s).toBe(schema);
    expect(sObs.s).toBe(schema);
    expect(schema).not.toBe('public');

    // 3. Real PostgresPersistenceAdapter with auto-insertion disabled
    adapter = new PostgresPersistenceAdapter({
      pool: collabPool,
      allowAutoInsert: false,
    });

    // 4. Real Collab Server
    collabServer = await createCollabServer({
      port: 0,
      adapter,
      gatewaySecret,
      debounceMs: 50,
      maxDebounceMs: 200,
      quiet: true,
    });
    const { url: directCollabUrl } = await collabServer.listen();

    // 5. Forwarding proxy for network fault injection
    proxy = new DroppingForwardProxy(directCollabUrl);
    const proxyUrl = await proxy.listen();

    // 6. Real authenticated CollabService pointing through proxy to collab server
    collabService = new CollabService({
      collabUrl: proxyUrl,
      gatewaySecret,
      timeoutMs: 5000,
    });

    // 7. Real API app
    apiInstance = await createApiApp({
      db: dbTest.db,
      collabService,
      sessionSecret: 'test-lifecycle-session-secret-at-least-32-chars-long',
    });
    await apiInstance.app.ready();

    // 8. Seed default author and authenticate
    const passwordHash = await bcrypt.hash('LifecyclePass2026!', 4);
    const [createdAuthor] = await dbTest.db.insert(users).values({
      email: 'lifecycle.author@blogger.test',
      fullName: 'Lifecycle Real PG Author',
      role: 'author',
      ssoProvider: 'local',
      passwordHash,
      isActive: true,
    }).returning();
    authorUser = createdAuthor;

    const loginRes = await apiInstance.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'lifecycle.author@blogger.test', password: 'LifecyclePass2026!' },
    });
    expect(loginRes.statusCode).toBe(200);
    authHeaders = {
      cookie: loginRes.cookies.map((c: any) => `${c.name}=${c.value}`).join('; '),
      'x-csrf-token': loginRes.json().csrfToken,
    };
  });

  afterAll(async () => {
    if (proxy) {
      proxy.dropRestoreResponse = false;
      proxy.onBeforeRestoreDispatch = undefined;
      proxy.onAfterFlushResponse = undefined;
      proxy.onRestorePersisted = undefined;
    }
    await apiInstance?.close();
    await proxy?.close();
    await collabServer?.destroy();
    await adapter?.destroy();
    await collabPool?.end();
    await observerPool?.end();
    await dbTest?.close();
  });

  beforeEach(() => {
    proxy.dropRestoreResponse = false;
    proxy.onBeforeRestoreDispatch = undefined;
    proxy.onAfterFlushResponse = undefined;
    proxy.onRestorePersisted = undefined;
  });

  async function seedPostWithWorkingAndHistorical(workingText = 'Working Content A', historicalText = 'Historical Target B') {
    const docA = createDocWithText(workingText);
    const snapA = docSnapshot(docA);
    docA.destroy();

    const docB = createDocWithText(historicalText);
    const snapB = docSnapshot(docB);
    docB.destroy();

    const [post] = await dbTest.db.insert(posts).values({
      slug: `lifecycle-pg-${slugCounter++}-${Date.now()}`,
      title: 'Lifecycle Integration Post',
      authorId: authorUser.id,
      status: 'draft',
      yjsState: snapA.buffer,
      workingMarkdown: snapA.markdown,
    }).returning();

    const [versionB] = await dbTest.db.insert(postVersions).values({
      postId: post.id,
      versionNumber: 1,
      triggerReason: 'manual_save',
      yjsStateSnapshot: snapB.buffer,
      markdownSnapshot: snapB.markdown,
      createdBy: authorUser.id,
    }).returning();

    return { post, versionB, snapA, snapB };
  }

  // =========================================================================
  // Group A: Safety commits before destructive restore
  // =========================================================================
  describe('Group A: Safety commits before destructive restore', () => {
    it('commits safety version and releases post row lock before destructive restore RPC is dispatched', async () => {
      const { post, versionB, snapA, snapB } = await seedPostWithWorkingAndHistorical(
        'Genuine Working Content A',
        'Historical Target B',
      );

      let safetyVersionVerifiedDuringDispatch = false;
      let rowLockAcquiredDuringDispatch = false;

      // Intercept request at proxy right before dispatching the restore RPC to collab
      proxy.onBeforeRestoreDispatch = async () => {
        // 1. Independent connection must see committed safety version with A's genuine bytes and Markdown
        const safetyRes = await observerPool.query(
          `SELECT version_number, trigger_reason, yjs_state_snapshot, markdown_snapshot
           FROM post_versions
           WHERE post_id = $1 AND trigger_reason = 'hourly_checkpoint'
           ORDER BY version_number DESC LIMIT 1`,
          [post.id]
        );
        expect(safetyRes.rows.length).toBe(1);
        const safetyRow = safetyRes.rows[0];
        expect(safetyRow.version_number).toBe(2);
        expect(safetyRow.markdown_snapshot).toBe(snapA.markdown);
        expect(Buffer.from(safetyRow.yjs_state_snapshot).equals(snapA.buffer)).toBe(true);
        safetyVersionVerifiedDuringDispatch = true;

        // 2. Independent connection must be able to acquire and release the post row lock
        const client = await observerPool.connect();
        try {
          await client.query('BEGIN');
          const lockRes = await client.query('SELECT id FROM posts WHERE id = $1 FOR UPDATE NOWAIT', [post.id]);
          expect(lockRes.rows.length).toBe(1);
          await client.query('COMMIT');
          rowLockAcquiredDuringDispatch = true;
        } finally {
          client.release();
        }
      };

      const res = await apiInstance.app.inject({
        method: 'POST',
        url: `/api/v1/posts/${post.id}/versions/${versionB.id}/restore`,
        headers: authHeaders,
      });

      expect(res.statusCode).toBe(200);
      expect(safetyVersionVerifiedDuringDispatch).toBe(true);
      expect(rowLockAcquiredDuringDispatch).toBe(true);

      // Verify working content was replaced with target B after successful restore
      const [saved] = await dbTest.db.select().from(posts).where(eq(posts.id, post.id));
      const savedSnap = deriveDocumentSnapshot(new Uint8Array(saved.yjsState));
      expect(savedSnap.workingMarkdown).toBe(snapB.markdown);

      // Verify success audit log
      const audits = await dbTest.db.select().from(auditLogs).where(
        and(eq(auditLogs.action, 'post_version_restored'), eq(auditLogs.entityId, post.id))
      );
      expect(audits.length).toBe(1);
      expect((audits[0].metadata as any)?.restoredFromVersionId).toBe(versionB.id);
    });

    it('injects an actual checkpoint insertion failure via schema trigger and fails closed', async () => {
      const { post, versionB, snapA } = await seedPostWithWorkingAndHistorical();

      // Inject actual schema-local failing trigger
      await observerPool.query(`
        CREATE OR REPLACE FUNCTION trg_fail_safety_checkpoint() RETURNS trigger AS $$
        BEGIN
          IF NEW.trigger_reason = 'hourly_checkpoint' THEN
            RAISE EXCEPTION 'injected safety checkpoint insertion failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS fail_safety_trigger ON post_versions;
        CREATE TRIGGER fail_safety_trigger
          BEFORE INSERT ON post_versions
          FOR EACH ROW EXECUTE FUNCTION trg_fail_safety_checkpoint();
      `);

      let restoreDispatchCount = 0;
      proxy.onBeforeRestoreDispatch = async () => { restoreDispatchCount += 1; };

      try {
        const res = await apiInstance.app.inject({
          method: 'POST',
          url: `/api/v1/posts/${post.id}/versions/${versionB.id}/restore`,
          headers: authHeaders,
        });

        // Fail closed with Service Unavailable
        expect(res.statusCode).toBe(503);

        // Content must remain A
        const [saved] = await dbTest.db.select().from(posts).where(eq(posts.id, post.id));
        const savedSnap = deriveDocumentSnapshot(new Uint8Array(saved.yjsState));
        expect(savedSnap.workingMarkdown).toBe(snapA.markdown);

        // No destructive restore dispatch may happen after a failed safety commit.
        expect(restoreDispatchCount).toBe(0);

        // Rollback/history: the failed attempt must not leak a safety checkpoint.
        const failedAttemptVersions = await dbTest.db.select().from(postVersions).where(
          eq(postVersions.postId, post.id)
        );
        expect(failedAttemptVersions).toHaveLength(1);
        expect(failedAttemptVersions.every((v) => v.triggerReason !== 'hourly_checkpoint')).toBe(true);

        // No restore success audit
        const audits = await dbTest.db.select().from(auditLogs).where(
          and(eq(auditLogs.action, 'post_version_restored'), eq(auditLogs.entityId, post.id))
        );
        expect(audits.length).toBe(0);
      } finally {
        await observerPool.query('DROP TRIGGER IF EXISTS fail_safety_trigger ON post_versions');
      }
    });

    it('injects an actual deferred failure at transaction commit via schema constraint trigger and fails closed', async () => {
      const { post, versionB, snapA } = await seedPostWithWorkingAndHistorical();

      // Inject actual schema-local deferred constraint trigger
      await observerPool.query(`
        CREATE OR REPLACE FUNCTION trg_fail_deferred_checkpoint() RETURNS trigger AS $$
        BEGIN
          IF NEW.trigger_reason = 'hourly_checkpoint' THEN
            RAISE EXCEPTION 'injected deferred failure at transaction commit';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS fail_deferred_trigger ON post_versions;
        CREATE CONSTRAINT TRIGGER fail_deferred_trigger
          AFTER INSERT ON post_versions
          DEFERRABLE INITIALLY DEFERRED
          FOR EACH ROW EXECUTE FUNCTION trg_fail_deferred_checkpoint();
      `);

      let restoreDispatchCount = 0;
      proxy.onBeforeRestoreDispatch = async () => { restoreDispatchCount += 1; };

      try {
        const res = await apiInstance.app.inject({
          method: 'POST',
          url: `/api/v1/posts/${post.id}/versions/${versionB.id}/restore`,
          headers: authHeaders,
        });

        expect(res.statusCode).toBe(503);

        // Content must remain A
        const [saved] = await dbTest.db.select().from(posts).where(eq(posts.id, post.id));
        const savedSnap = deriveDocumentSnapshot(new Uint8Array(saved.yjsState));
        expect(savedSnap.workingMarkdown).toBe(snapA.markdown);

        // No destructive restore dispatch may happen after a failed safety commit.
        expect(restoreDispatchCount).toBe(0);

        // Rollback/history: the failed attempt must not leak a safety checkpoint.
        const failedAttemptVersions = await dbTest.db.select().from(postVersions).where(
          eq(postVersions.postId, post.id)
        );
        expect(failedAttemptVersions).toHaveLength(1);
        expect(failedAttemptVersions.every((v) => v.triggerReason !== 'hourly_checkpoint')).toBe(true);

        // No restore success audit
        const audits = await dbTest.db.select().from(auditLogs).where(
          and(eq(auditLogs.action, 'post_version_restored'), eq(auditLogs.entityId, post.id))
        );
        expect(audits.length).toBe(0);
      } finally {
        await observerPool.query('DROP TRIGGER IF EXISTS fail_deferred_trigger ON post_versions');
      }
    });
  });

  // =========================================================================
  // Group B: Successful persistence followed by lost acknowledgement
  // =========================================================================
  describe('Group B: Successful persistence followed by lost acknowledgement', () => {
    it('handles lost restore acknowledgement, retains safety, and recovers cleanly after restart', async () => {
      const { post, versionB, snapA, snapB } = await seedPostWithWorkingAndHistorical(
        'Original Unlost Content A',
        'Target Historical Content B',
      );

      // 1. Configure proxy to drop response after collab server completes restore
      proxy.dropRestoreResponse = true;
      const restorePersistedGate = deferred();
      proxy.onRestorePersisted = () => {
        restorePersistedGate.resolve();
      };

      const res = await apiInstance.app.inject({
        method: 'POST',
        url: `/api/v1/posts/${post.id}/versions/${versionB.id}/restore`,
        headers: authHeaders,
      });

      // API returned failure/uncertain outcome, NOT success
      expect(res.statusCode).toBe(503);
      expect(res.json().success).not.toBe(true);

      // The proxy drops only after a genuinely successful upstream restore; await the persisted gate.
      await restorePersistedGate.promise;

      // No restore-success audit recorded
      const audits = await dbTest.db.select().from(auditLogs).where(
        and(eq(auditLogs.action, 'post_version_restored'), eq(auditLogs.entityId, post.id))
      );
      expect(audits.length).toBe(0);

      // Safety version with A was committed and remains recoverable
      const [safetyVersion] = await dbTest.db.select().from(postVersions).where(
        and(eq(postVersions.postId, post.id), eq(postVersions.versionNumber, 2))
      );
      expect(safetyVersion).toBeDefined();
      expect(safetyVersion.triggerReason).toBe('hourly_checkpoint');
      expect(safetyVersion.markdownSnapshot).toBe(snapA.markdown);
      expect(Buffer.from(safetyVersion.yjsStateSnapshot).equals(snapA.buffer)).toBe(true);

      // Independent observer reads the post row after the dropped acknowledgement and confirms working B persisted.
      const observerPost = await observerPool.query(
        'SELECT yjs_state, working_markdown FROM posts WHERE id = $1',
        [post.id],
      );
      expect(observerPost.rows.length).toBe(1);
      expect(observerPost.rows[0].working_markdown).toBe(snapB.markdown);
      const observerSnapshot = deriveDocumentSnapshot(new Uint8Array(observerPost.rows[0].yjs_state));
      expect(observerSnapshot.workingMarkdown).toBe(snapB.markdown);
      expect(observerSnapshot.workingMarkdown).toBe(observerPost.rows[0].working_markdown);

      // 2. Restart the collaboration runtime without resetting PostgreSQL
      await collabServer.destroy();
      collabServer = await createCollabServer({
        port: 0,
        adapter,
        gatewaySecret,
        debounceMs: 50,
        maxDebounceMs: 200,
        quiet: true,
      });
      const { url: newCollabUrl } = await collabServer.listen();
      proxy.targetUrl = newCollabUrl;
      proxy.dropRestoreResponse = false;

      // 3. Confirm original A checkpoint still exists and restore it
      const [checkedSafety] = await dbTest.db.select().from(postVersions).where(eq(postVersions.id, safetyVersion.id));
      expect(checkedSafety).toBeDefined();

      const retryRes = await apiInstance.app.inject({
        method: 'POST',
        url: `/api/v1/posts/${post.id}/versions/${safetyVersion.id}/restore`,
        headers: authHeaders,
      });
      expect(retryRes.statusCode).toBe(200);

      // Retry created a new safety checkpoint containing B; the original safety A must remain unchanged.
      const versionsAfterRetry = await dbTest.db.select().from(postVersions).where(
        eq(postVersions.postId, post.id)
      );
      const originalSafetyAfterRetry = versionsAfterRetry.find((v) => v.id === safetyVersion.id);
      expect(originalSafetyAfterRetry).toBeDefined();
      expect(originalSafetyAfterRetry!.yjsStateSnapshot).toEqual(safetyVersion.yjsStateSnapshot);
      expect(originalSafetyAfterRetry!.markdownSnapshot).toBe(safetyVersion.markdownSnapshot);
      const retrySafety = versionsAfterRetry.find(
        (v) => v.triggerReason === 'hourly_checkpoint' && v.id !== safetyVersion.id
      );
      expect(retrySafety).toBeDefined();
      expect(retrySafety!.triggerReason).toBe('hourly_checkpoint');
      expect(retrySafety!.markdownSnapshot).toBe(snapB.markdown);
      const retrySafetySnapshot = deriveDocumentSnapshot(new Uint8Array(retrySafety!.yjsStateSnapshot));
      expect(retrySafetySnapshot.workingMarkdown).toBe(snapB.markdown);
      expect(retrySafetySnapshot.workingMarkdown).toBe(retrySafety!.markdownSnapshot);

      // 4. Verify A in authoritative live state
      const direct = await collabServer.server.hocuspocus.openDirectConnection(`post-${post.id}`, {
        user: { id: authorUser.id, role: 'author', name: 'Author', permissions: ['edit'] },
      });
      let liveMarkdown = '';
      await direct.transact((liveDoc: Y.Doc) => {
        liveMarkdown = exportDerivedMarkdown(yDocToProsemirrorJSON(liveDoc, 'prosemirror') as any);
      });
      expect(liveMarkdown).toBe(snapA.markdown);
      await direct.disconnect({ unloadImmediately: false });

      // 5. Verify A after reload from persistence
      const persistedBytes = await adapter.fetch(`post-${post.id}`);
      expect(persistedBytes).not.toBeNull();
      const loadedDoc = new Y.Doc();
      Y.applyUpdate(loadedDoc, persistedBytes!);
      const loadedMarkdown = exportDerivedMarkdown(yDocToProsemirrorJSON(loadedDoc, 'prosemirror') as any);
      loadedDoc.destroy();
      expect(loadedMarkdown).toBe(snapA.markdown);

      // Exactly one successful restore audit exists (the retried attempt); the failed dropped request must not have recorded one.
      const auditsAfterRetry = await dbTest.db.select().from(auditLogs).where(
        and(eq(auditLogs.action, 'post_version_restored'), eq(auditLogs.entityId, post.id))
      );
      expect(auditsAfterRetry).toHaveLength(1);
      expect((auditsAfterRetry[0].metadata as any)?.restoredFromVersionId).toBe(safetyVersion.id);
    });
  });

  // =========================================================================
  // Group C: Concurrent version allocation and stale fingerprints
  // =========================================================================
  describe('Group C: Concurrent version allocation and stale fingerprints', () => {
    it('serializes concurrent restores: version numbers remain unique and stale fingerprint is rejected with 409', async () => {
      const { post, snapA } = await seedPostWithWorkingAndHistorical('Base Working Content');

      // Seed two distinct historical versions
      const snapTarget1 = docSnapshot(createDocWithText('Target Version 1 Text'));
      const snapTarget2 = docSnapshot(createDocWithText('Target Version 2 Text'));

      const [v1] = await dbTest.db.insert(postVersions).values({
        postId: post.id,
        versionNumber: 2,
        triggerReason: 'manual_save',
        yjsStateSnapshot: snapTarget1.buffer,
        markdownSnapshot: snapTarget1.markdown,
        createdBy: authorUser.id,
      }).returning();

      const [v2] = await dbTest.db.insert(postVersions).values({
        postId: post.id,
        versionNumber: 3,
        triggerReason: 'manual_save',
        yjsStateSnapshot: snapTarget2.buffer,
        markdownSnapshot: snapTarget2.markdown,
        createdBy: authorUser.id,
      }).returning();

      // Keep A active so each completed capture response carries its actual bytes and fingerprint.
      const warmConnection = await collabServer.server.hocuspocus.openDirectConnection(`post-${post.id}`, {
        user: { id: authorUser.id, role: 'author', name: 'Author', permissions: ['edit'] },
      });
      const bothCaptured = deferred();
      const bothAdmitted = deferred();
      const winnerPersisted = deferred();
      let captureCount = 0;
      let admissionCount = 0;
      let winnerDispatchCount = 0;
      let loserDispatchCount = 0;
      const schedule: string[] = [];
      proxy.onAfterFlushResponse = async (capture) => {
        expect(capture.success).toBe(true);
        expect(capture.documentName).toBe(`post-${post.id}`);
        expect(capture.inMemory).toBe(true);
        const capturedBytes = Buffer.from(capture.yjsState!, 'base64');
        expect(capturedBytes.equals(snapA.buffer)).toBe(true);
        expect(deriveDocumentSnapshot(new Uint8Array(capturedBytes)).workingMarkdown).toBe(snapA.markdown);
        expect(capture.workingMarkdown).toBe(snapA.markdown);
        expect(capture.fingerprint).toBe(snapA.fingerprint);
        captureCount += 1;
        schedule.push('capture A completed');
        if (captureCount === 2) bothCaptured.resolve();
        await bothCaptured.promise;
      };
      proxy.onBeforeRestoreDispatch = async (targetState, expectedCurrentFingerprint) => {
        expect(expectedCurrentFingerprint).toBe(snapA.fingerprint);
        admissionCount += 1;
        if (admissionCount === 2) bothAdmitted.resolve();
        if (Buffer.from(targetState).equals(snapTarget1.buffer)) {
          winnerDispatchCount += 1;
          await bothCaptured.promise;
          await bothAdmitted.promise;
          // Arrival of both restore RPCs means both real safety transactions have committed.
          const committedSafety = await observerPool.query(
            `SELECT version_number, yjs_state_snapshot, markdown_snapshot FROM post_versions
             WHERE post_id = $1 AND trigger_reason = 'hourly_checkpoint' ORDER BY version_number`,
            [post.id],
          );
          expect(committedSafety.rows.map((v) => v.version_number)).toEqual([4, 5]);
          for (const safety of committedSafety.rows) {
            expect(safety.markdown_snapshot).toBe(snapA.markdown);
            expect(Buffer.from(safety.yjs_state_snapshot).equals(snapA.buffer)).toBe(true);
            expect(deriveDocumentSnapshot(new Uint8Array(safety.yjs_state_snapshot)).workingMarkdown).toBe(snapA.markdown);
          }
          schedule.push('both safety commits observed before winner dispatch');
        } else {
          expect(Buffer.from(targetState).equals(snapTarget2.buffer)).toBe(true);
          loserDispatchCount += 1;
          await winnerPersisted.promise;
          schedule.push('loser dispatch released after winner persisted');
        }
      };
      proxy.onRestorePersisted = () => {
        schedule.push('winner persisted upstream 2xx');
        winnerPersisted.resolve();
      };

      const restore1Promise = apiInstance.app.inject({
        method: 'POST',
        url: `/api/v1/posts/${post.id}/versions/${v1.id}/restore`,
        headers: authHeaders,
      });
      const restore2Promise = apiInstance.app.inject({
        method: 'POST',
        url: `/api/v1/posts/${post.id}/versions/${v2.id}/restore`,
        headers: authHeaders,
      });
      const scheduleTimeout = deferred<never>();
      const timer = setTimeout(() => scheduleTimeout.reject(new Error('Timed out forcing both captures, safety commits, and winner persistence')), 4000);
      let res1: any;
      let res2: any;
      try {
        const pair = await Promise.race([Promise.all([restore1Promise, restore2Promise]), scheduleTimeout.promise]);
        res1 = pair[0];
        res2 = pair[1];
        expect(captureCount).toBe(2);
        expect(admissionCount).toBe(2);
        expect(winnerDispatchCount).toBe(1);
        expect(loserDispatchCount).toBe(1);
        expect(schedule).toEqual([
          'capture A completed', 'capture A completed',
          'both safety commits observed before winner dispatch',
          'winner persisted upstream 2xx',
          'loser dispatch released after winner persisted',
        ]);
        console.info('[lifecycle restore/restore schedule]', schedule.join(' -> '));
      } finally {
        clearTimeout(timer);
        bothCaptured.resolve();
        bothAdmitted.resolve();
        winnerPersisted.resolve();
        proxy.onAfterFlushResponse = undefined;
        proxy.onBeforeRestoreDispatch = undefined;
        proxy.onRestorePersisted = undefined;
        await Promise.allSettled([restore1Promise, restore2Promise]);
        await warmConnection.disconnect({ unloadImmediately: false });
      }

      // First dispatched restore deterministically wins; the second is stale after the winner persisted.
      expect(res1.statusCode).toBe(200);
      expect(res2.statusCode).toBe(409);

      const winnerBody = res1.json() as any;
      expect(winnerBody.success).toBe(true);
      expect(winnerBody.restoredVersionNumber).toBe(2);
      expect(winnerBody.message).toBe('Successfully restored version v2');
      expect(winnerBody.markdownSnapshot).toBe(snapTarget1.markdown);

      const loserBody = res2.json() as any;
      expect(loserBody.success).not.toBe(true);
      expect(loserBody.error).toBe('Conflict');
      expect(loserBody.message).toBe('The working document changed during restore. Reload and try again.');

      // All version numbers in post_versions must be strictly unique and sequential.
      const allVersions = await dbTest.db.select().from(postVersions).where(eq(postVersions.postId, post.id));
      expect(allVersions).toHaveLength(5);
      const versionNumbers = allVersions.map((v) => v.versionNumber).sort((a, b) => a - b);
      expect(versionNumbers).toEqual([1, 2, 3, 4, 5]);
      const safetyVersions = allVersions
        .filter((v) => v.triggerReason === 'hourly_checkpoint')
        .sort((a, b) => a.versionNumber - b.versionNumber);
      expect(safetyVersions).toHaveLength(2);
      const winnerSafety = safetyVersions[0];
      expect(winnerSafety.versionNumber).toBe(4);
      expect(winnerSafety.markdownSnapshot).toBe(snapA.markdown);
      expect(Buffer.from(winnerSafety.yjsStateSnapshot).equals(snapA.buffer)).toBe(true);
      const loserSafety = safetyVersions[1];
      expect(loserSafety.versionNumber).toBe(5);
      expect(loserSafety.triggerReason).toBe('hourly_checkpoint');
      expect(loserSafety.markdownSnapshot).toBe(snapA.markdown);
      expect(Buffer.from(loserSafety.yjsStateSnapshot).equals(snapA.buffer)).toBe(true);
      for (const safety of safetyVersions) {
        const snapshot = deriveDocumentSnapshot(new Uint8Array(safety.yjsStateSnapshot));
        expect(snapshot.workingMarkdown).toBe(snapA.markdown);
        expect(snapshot.workingMarkdown).toBe(safety.markdownSnapshot);
      }

      // Final winning working bytes+markdown is the winner's target.
      const [saved] = await dbTest.db.select().from(posts).where(eq(posts.id, post.id));
      const savedSnap = deriveDocumentSnapshot(new Uint8Array(saved.yjsState));
      expect(savedSnap.workingMarkdown).toBe(snapTarget1.markdown);
      expect(saved.workingMarkdown).toBe(snapTarget1.markdown);
    });

    it('interleaves restore versus submission safely: version numbers remain unique and pins are preserved', async () => {
      const { post, versionB, snapA, snapB } = await seedPostWithWorkingAndHistorical('Draft Working Content');

      const warmConnection = await collabServer.server.hocuspocus.openDirectConnection(`post-${post.id}`, {
        user: { id: authorUser.id, role: 'author', name: 'Author', permissions: ['edit'] },
      });
      const restoreCaptured = deferred();
      const releaseRestoreCapture = deferred();
      let captureCount = 0;
      let restoreDispatchCount = 0;
      const schedule: string[] = [];
      // The first request is known to be restore: submission starts only once this response is held.
      // Holding the completed response blocks restore BEFORE its safety allocation transaction.
      proxy.onAfterFlushResponse = async (capture) => {
        expect(capture.success).toBe(true);
        expect(capture.documentName).toBe(`post-${post.id}`);
        expect(capture.inMemory).toBe(true);
        const capturedBytes = Buffer.from(capture.yjsState!, 'base64');
        expect(capturedBytes.equals(snapA.buffer)).toBe(true);
        expect(deriveDocumentSnapshot(new Uint8Array(capturedBytes)).workingMarkdown).toBe(snapA.markdown);
        expect(capture.workingMarkdown).toBe(snapA.markdown);
        expect(capture.fingerprint).toBe(snapA.fingerprint);
        captureCount += 1;
        if (captureCount === 1) {
          schedule.push('restore capture A completed and held');
          restoreCaptured.resolve();
          await releaseRestoreCapture.promise;
        } else {
          schedule.push('submission capture A completed');
        }
      };
      proxy.onBeforeRestoreDispatch = (targetState, expectedCurrentFingerprint) => {
        expect(Buffer.from(targetState).equals(snapB.buffer)).toBe(true);
        expect(expectedCurrentFingerprint).toBe(snapA.fingerprint);
        restoreDispatchCount += 1;
        schedule.push('restore safety committed and target B dispatched');
      };
      const restorePromise = apiInstance.app.inject({
        method: 'POST',
        url: `/api/v1/posts/${post.id}/versions/${versionB.id}/restore`,
        headers: authHeaders,
      });
      const requests: Promise<unknown>[] = [restorePromise];
      const scheduleTimeout = deferred<never>();
      const timer = setTimeout(() => scheduleTimeout.reject(new Error('Timed out forcing submission commit before restore safety allocation')), 4000);
      let submitRes: any;
      let restoreRes: any;
      try {
        await Promise.race([restoreCaptured.promise, scheduleTimeout.promise]);
        const submitPromise = apiInstance.app.inject({
          method: 'POST',
          url: `/api/v1/posts/${post.id}/submit-review`,
          headers: authHeaders,
        });
        requests.push(submitPromise);
        submitRes = await Promise.race([submitPromise, scheduleTimeout.promise]);
        expect(submitRes.statusCode).toBe(200);
        // Independent observation proves a real v2 submission commit, with no restore safety yet.
        const committed = await observerPool.query(
          `SELECT p.status, p.submitted_version_id, v.id, v.version_number, v.trigger_reason,
                  v.yjs_state_snapshot, v.markdown_snapshot
           FROM posts p JOIN post_versions v ON v.post_id = p.id WHERE p.id = $1 ORDER BY v.version_number`,
          [post.id],
        );
        expect(committed.rows.map((v) => v.version_number)).toEqual([1, 2]);
        const submission = committed.rows[1];
        expect(submission.status).toBe('in_review');
        expect(submission.submitted_version_id).toBe(submission.id);
        expect(submission.id).toBe(submitRes.json().submittedVersion.id);
        expect(submission.trigger_reason).toBe('review_submission');
        expect(submission.markdown_snapshot).toBe(snapA.markdown);
        expect(Buffer.from(submission.yjs_state_snapshot).equals(snapA.buffer)).toBe(true);
        expect(deriveDocumentSnapshot(new Uint8Array(submission.yjs_state_snapshot)).workingMarkdown).toBe(snapA.markdown);
        expect(restoreDispatchCount).toBe(0);
        schedule.push('submission v2 commit observed before restore capture release');
        releaseRestoreCapture.resolve();
        restoreRes = await Promise.race([restorePromise, scheduleTimeout.promise]);
        expect(captureCount).toBe(2);
        expect(restoreDispatchCount).toBe(1);
        expect(schedule).toEqual([
          'restore capture A completed and held', 'submission capture A completed',
          'submission v2 commit observed before restore capture release',
          'restore safety committed and target B dispatched',
        ]);
        console.info('[lifecycle restore/submit schedule]', schedule.join(' -> '));
      } finally {
        clearTimeout(timer);
        restoreCaptured.resolve();
        releaseRestoreCapture.resolve();
        proxy.onAfterFlushResponse = undefined;
        proxy.onBeforeRestoreDispatch = undefined;
        await Promise.allSettled(requests);
        await warmConnection.disconnect({ unloadImmediately: false });
      }

      // Submission succeeds and pins its genuine captured checkpoint.
      expect(submitRes.statusCode).toBe(200);
      const submitBody = submitRes.json() as any;
      expect(submitBody.post.status).toBe('in_review');
      expect(submitBody.submittedVersion).toBeDefined();
      expect(submitBody.submittedVersion.versionNumber).toBe(2);
      expect(submitBody.submittedVersion.triggerReason).toBe('review_submission');
      expect(submitBody.submittedVersion.markdownSnapshot).toBe(snapA.markdown);
      expect(submitBody.post.submittedVersionId).toBe(submitBody.submittedVersion.id);
      expect(Buffer.from(submitBody.submittedVersion.yjsStateSnapshot.data).equals(snapA.buffer)).toBe(true);

      // Restore then succeeds; the final working state is the restored target.
      expect(restoreRes.statusCode).toBe(200);
      const restoreBody = restoreRes.json() as any;
      expect(restoreBody.success).toBe(true);
      expect(restoreBody.restoredVersionNumber).toBe(1);
      expect(restoreBody.markdownSnapshot).toBe(snapB.markdown);

      // The pin must reference the genuine review_submission checkpoint, not a later restore safety version.
      const [currentPost] = await dbTest.db.select().from(posts).where(eq(posts.id, post.id));
      expect(currentPost.status).toBe('in_review');
      expect(currentPost.submittedVersionId).toBe(submitBody.submittedVersion.id);
      const [pinnedVersion] = await dbTest.db.select().from(postVersions).where(
        eq(postVersions.id, currentPost.submittedVersionId)
      );
      expect(pinnedVersion).toBeDefined();
      expect(pinnedVersion.triggerReason).toBe('review_submission');
      expect(pinnedVersion.versionNumber).toBe(2);
      expect(pinnedVersion.markdownSnapshot).toBe(snapA.markdown);
      expect(Buffer.from(pinnedVersion.yjsStateSnapshot).equals(snapA.buffer)).toBe(true);
      expect(deriveDocumentSnapshot(new Uint8Array(pinnedVersion.yjsStateSnapshot)).workingMarkdown).toBe(pinnedVersion.markdownSnapshot);

      // Version numbers remain unique and sequential; final working state is restored B.
      const allVersions = await dbTest.db.select().from(postVersions).where(eq(postVersions.postId, post.id));
      expect(allVersions).toHaveLength(3);
      const versionNumbers = allVersions.map((v) => v.versionNumber).sort((a, b) => a - b);
      expect(versionNumbers).toEqual([1, 2, 3]);
      const safetyVersions = allVersions.filter((v) => v.triggerReason === 'hourly_checkpoint');
      expect(safetyVersions).toHaveLength(1);
      expect(safetyVersions[0].versionNumber).toBe(3);
      expect(safetyVersions[0].markdownSnapshot).toBe(snapA.markdown);
      expect(Buffer.from(safetyVersions[0].yjsStateSnapshot).equals(snapA.buffer)).toBe(true);
      expect(deriveDocumentSnapshot(new Uint8Array(safetyVersions[0].yjsStateSnapshot)).workingMarkdown).toBe(snapA.markdown);
      const [saved] = await dbTest.db.select().from(posts).where(eq(posts.id, post.id));
      const savedSnap = deriveDocumentSnapshot(new Uint8Array(saved.yjsState));
      expect(savedSnap.workingMarkdown).toBe(snapB.markdown);
      expect(saved.workingMarkdown).toBe(snapB.markdown);
    });
  });

  // =========================================================================
  // Group D: Inactive capture and fresh authorization
  // =========================================================================
  describe('Group D: Inactive capture and fresh authorization', () => {
    it('rereads persisted working content for inactive capture and uses fresh state for safety checkpoint and fingerprint', async () => {
      const { post, versionB } = await seedPostWithWorkingAndHistorical('Original Inactive Content');
      const modifiedSnap = docSnapshot(createDocWithText('Direct Database Update Before Ack'));

      // Ensure document is not in memory by requesting flush when empty
      let updatedDuringCapture = false;

      // Intercept flush to update database directly before acknowledgement returns
      const origFlush = collabService.flushDocument.bind(collabService);
      collabService.flushDocument = async (postId: string) => {
        const result = await origFlush(postId);
        if (!updatedDuringCapture) {
          updatedDuringCapture = true;
          // Update PostgreSQL directly with new content while capture is in-flight
          await observerPool.query(
            'UPDATE posts SET yjs_state = $1, working_markdown = $2 WHERE id = $3',
            [modifiedSnap.buffer, 'Direct Database Update Before Ack', post.id]
          );
        }
        return result;
      };

      let dispatchedRestore: { expectedCurrentFingerprint: string; targetState: Uint8Array } | undefined;
      const origRestore = collabService.restoreDocument.bind(collabService);
      collabService.restoreDocument = async (postId: string, yjsStateSnapshot: Uint8Array, expectedCurrentFingerprint: string) => {
        dispatchedRestore = { expectedCurrentFingerprint, targetState: yjsStateSnapshot };
        return origRestore(postId, yjsStateSnapshot, expectedCurrentFingerprint);
      };

      try {
        const res = await apiInstance.app.inject({
          method: 'POST',
          url: `/api/v1/posts/${post.id}/versions/${versionB.id}/restore`,
          headers: authHeaders,
        });

        // Inactive capture rereads the freshly persisted row after acknowledgement, so the restore deterministically succeeds.
        expect(res.statusCode).toBe(200);
        expect(dispatchedRestore).toBeDefined();
        expect(dispatchedRestore!.expectedCurrentFingerprint).toBe(fingerprintDocumentState(modifiedSnap.buffer));

        // Safety checkpoint must contain the reread content, not the earlier row
        const safetyVersions = await dbTest.db.select().from(postVersions).where(
          and(eq(postVersions.postId, post.id), eq(postVersions.triggerReason, 'hourly_checkpoint'))
        );
        expect(safetyVersions).toHaveLength(1);
        const latestSafety = safetyVersions[safetyVersions.length - 1];
        expect(latestSafety.markdownSnapshot).toBe('Direct Database Update Before Ack');
        expect(Buffer.from(latestSafety.yjsStateSnapshot).equals(modifiedSnap.buffer)).toBe(true);

        // Final working state is the restored target.
        const [saved] = await dbTest.db.select().from(posts).where(eq(posts.id, post.id));
        const savedSnap = deriveDocumentSnapshot(new Uint8Array(saved.yjsState));
        expect(savedSnap.workingMarkdown).toBe('Historical Target B');
      } finally {
        collabService.flushDocument = origFlush;
        collabService.restoreDocument = origRestore;
      }
    });

    it('independently rejects restore when non-author admin is demoted during capture', async () => {
      // 1. Post owned by other user
      const [otherAuthor] = await dbTest.db.insert(users).values({
        email: 'other.author@blogger.test',
        fullName: 'Other Author',
        role: 'author',
        ssoProvider: 'local',
        isActive: true,
      }).returning();

      const [adminUser] = await dbTest.db.insert(users).values({
        email: 'admin.demoted@blogger.test',
        fullName: 'Demoted Admin',
        role: 'admin',
        ssoProvider: 'local',
        passwordHash: await bcrypt.hash('AdminPass2026!', 4),
        isActive: true,
      }).returning();

      const loginAdmin = await apiInstance.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'admin.demoted@blogger.test', password: 'AdminPass2026!' },
      });
      const adminHeaders = {
        cookie: loginAdmin.cookies.map((c: any) => `${c.name}=${c.value}`).join('; '),
        'x-csrf-token': loginAdmin.json().csrfToken,
      };

      const docA = createDocWithText('Post by Other Author');
      const snapA = docSnapshot(docA);
      docA.destroy();

      const [post] = await dbTest.db.insert(posts).values({
        slug: `demote-test-${Date.now()}`,
        title: 'Admin Post',
        authorId: otherAuthor.id,
        status: 'draft',
        yjsState: snapA.buffer,
        workingMarkdown: snapA.markdown,
      }).returning();

      const docB = createDocWithText('Target Target');
      const snapB = docSnapshot(docB);
      docB.destroy();

      const [v1] = await dbTest.db.insert(postVersions).values({
        postId: post.id,
        versionNumber: 1,
        triggerReason: 'manual_save',
        yjsStateSnapshot: snapB.buffer,
        markdownSnapshot: snapB.markdown,
        createdBy: otherAuthor.id,
      }).returning();

      // Intercept capture: demote admin to reader in DB before checkpoint
      const origFlush = collabService.flushDocument.bind(collabService);
      collabService.flushDocument = async (postId: string) => {
        await observerPool.query('UPDATE users SET role = $1 WHERE id = $2', ['reader', adminUser.id]);
        return origFlush(postId);
      };

      try {
        const res = await apiInstance.app.inject({
          method: 'POST',
          url: `/api/v1/posts/${post.id}/versions/${v1.id}/restore`,
          headers: adminHeaders,
        });

        expect(res.statusCode).toBe(403);

        // No safety checkpoint created
        const safety = await dbTest.db.select().from(postVersions).where(
          and(eq(postVersions.postId, post.id), eq(postVersions.triggerReason, 'hourly_checkpoint'))
        );
        expect(safety.length).toBe(0);
      } finally {
        collabService.flushDocument = origFlush;
      }
    });

    it('independently rejects restore when user account is deactivated during capture', async () => {
      const { post, versionB } = await seedPostWithWorkingAndHistorical();

      const origFlush = collabService.flushDocument.bind(collabService);
      collabService.flushDocument = async (postId: string) => {
        await observerPool.query('UPDATE users SET is_active = false WHERE id = $1', [authorUser.id]);
        return origFlush(postId);
      };

      try {
        const res = await apiInstance.app.inject({
          method: 'POST',
          url: `/api/v1/posts/${post.id}/versions/${versionB.id}/restore`,
          headers: authHeaders,
        });

        expect(res.statusCode).toBe(403);
        const safety = await dbTest.db.select().from(postVersions).where(
          and(eq(postVersions.postId, post.id), eq(postVersions.triggerReason, 'hourly_checkpoint'))
        );
        expect(safety.length).toBe(0);
      } finally {
        await observerPool.query('UPDATE users SET is_active = true WHERE id = $1', [authorUser.id]);
        collabService.flushDocument = origFlush;
      }
    });

    it('independently rejects restore when direct edit grant is revoked during capture', async () => {
      const [owner] = await dbTest.db.insert(users).values({
        email: 'grant.owner@blogger.test',
        fullName: 'Grant Owner',
        role: 'author',
        isActive: true,
      }).returning();

      const { post, versionB } = await seedPostWithWorkingAndHistorical();
      await dbTest.db.update(posts).set({ authorId: owner.id }).where(eq(posts.id, post.id));

      // Direct edit grant to authorUser
      await dbTest.db.insert(postCollaborators).values({
        postId: post.id,
        userId: authorUser.id,
        permission: 'edit',
      });

      const origFlush = collabService.flushDocument.bind(collabService);
      collabService.flushDocument = async (postId: string) => {
        // Revoke grant to 'view'
        await observerPool.query(
          'UPDATE post_collaborators SET permission = $1 WHERE post_id = $2 AND user_id = $3',
          ['view', post.id, authorUser.id]
        );
        return origFlush(postId);
      };

      try {
        const res = await apiInstance.app.inject({
          method: 'POST',
          url: `/api/v1/posts/${post.id}/versions/${versionB.id}/restore`,
          headers: authHeaders,
        });

        expect(res.statusCode).toBe(403);
        const safety = await dbTest.db.select().from(postVersions).where(
          and(eq(postVersions.postId, post.id), eq(postVersions.triggerReason, 'hourly_checkpoint'))
        );
        expect(safety.length).toBe(0);
      } finally {
        collabService.flushDocument = origFlush;
      }
    });

    it('independently rejects restore when space edit grant is revoked during capture', async () => {
      const [owner] = await dbTest.db.insert(users).values({
        email: 'space.owner@blogger.test',
        fullName: 'Space Post Owner',
        role: 'author',
        isActive: true,
      }).returning();

      const [space] = await dbTest.db.insert(spaces).values({
        slug: `space-grant-${Date.now()}`,
        name: 'Space With Edit Grants',
      }).returning();

      const { post, versionB } = await seedPostWithWorkingAndHistorical();
      await dbTest.db.update(posts).set({ authorId: owner.id, spaceId: space.id, visibility: 'space' })
        .where(eq(posts.id, post.id));

      // Member with author role in space
      await dbTest.db.insert(spaceMembers).values({
        spaceId: space.id,
        userId: authorUser.id,
        role: 'author',
      });

      const origFlush = collabService.flushDocument.bind(collabService);
      collabService.flushDocument = async (postId: string) => {
        // Demote space membership to viewer
        await observerPool.query(
          'UPDATE space_members SET role = $1 WHERE space_id = $2 AND user_id = $3',
          ['viewer', space.id, authorUser.id]
        );
        return origFlush(postId);
      };

      try {
        const res = await apiInstance.app.inject({
          method: 'POST',
          url: `/api/v1/posts/${post.id}/versions/${versionB.id}/restore`,
          headers: authHeaders,
        });

        expect(res.statusCode).toBe(403);
        const safety = await dbTest.db.select().from(postVersions).where(
          and(eq(postVersions.postId, post.id), eq(postVersions.triggerReason, 'hourly_checkpoint'))
        );
        expect(safety.length).toBe(0);
      } finally {
        collabService.flushDocument = origFlush;
      }
    });
  });

  // =========================================================================
  // Group E: Real delete cascades and no resurrection
  // =========================================================================
  describe('Group E: Real delete cascades and no resurrection', () => {
    it('executes API delete: validates tombstone, cascades all FK rows, unlinks disk attachment, and prevents resurrection', async () => {
      const { post, versionB } = await seedPostWithWorkingAndHistorical('To Be Deleted Post Content');

      // 1. Seed reviewer and post_reviews
      const [reviewer] = await dbTest.db.insert(users).values({
        email: `reviewer-${Date.now()}@blogger.test`,
        fullName: 'Assigned Reviewer',
        role: 'author',
        isActive: true,
      }).returning();

      const [review] = await dbTest.db.insert(postReviews).values({
        postId: post.id,
        reviewerId: reviewer.id,
        submittedVersionId: versionB.id,
        decision: 'pending',
      }).returning();

      // 2. Seed real file attachment in temporary directory
      const tmpDir = '/tmp/opencode/glyphroom-lifecycle-pg-2026-11-02/attachments';
      fs.mkdirSync(tmpDir, { recursive: true });
      const attachmentFilePath = path.join(tmpDir, `attachment-${post.id}.bin`);
      fs.writeFileSync(attachmentFilePath, Buffer.from('Real attachment binary data fixture'));
      const sha256 = crypto.createHash('sha256').update('Real attachment binary data fixture').digest('hex');

      const [att] = await dbTest.db.insert(postAttachments).values({
        postId: post.id,
        fileName: 'test-attachment.bin',
        fileSize: 36,
        mimeType: 'application/octet-stream',
        sha256,
        storagePath: attachmentFilePath,
        scanStatus: 'clean',
        uploadedBy: authorUser.id,
      }).returning();

      // 3. Seed comments, collaborators, and tags
      const [comment] = await dbTest.db.insert(comments).values({
        postId: post.id,
        authorId: reviewer.id,
        content: 'Review feedback on deleted post',
      }).returning();

      await dbTest.db.insert(postCollaborators).values({
        postId: post.id,
        userId: reviewer.id,
        permission: 'view',
      });

      const [tag] = await dbTest.db.insert(tags).values({
        name: `Tag-${post.id.slice(0, 8)}`,
        slug: `tag-${post.id.slice(0, 8)}`,
      }).returning();

      await dbTest.db.insert(postTags).values({
        postId: post.id,
        tagId: tag.id,
      });

      // Verify all dependent rows exist before delete
      expect(fs.existsSync(attachmentFilePath)).toBe(true);
      expect((await dbTest.db.select().from(postReviews).where(eq(postReviews.id, review.id))).length).toBe(1);
      expect((await dbTest.db.select().from(postAttachments).where(eq(postAttachments.id, att.id))).length).toBe(1);
      expect((await dbTest.db.select().from(comments).where(eq(comments.id, comment.id))).length).toBe(1);

      // Track tombstone call on collab server
      let tombstoneAcknowledged = false;
      const origTombstone = collabService.tombstoneDocument.bind(collabService);
      collabService.tombstoneDocument = async (postId: string) => {
        const result = await origTombstone(postId);
        expect(result.tombstoned).toBe(true);
        expect(result.documentName).toBe(`post-${postId}`);
        tombstoneAcknowledged = true;
        return result;
      };

      // Warm an active collab room, then hold the pre-delete persistence store across the deletion barrier.
      const warmConnection = await collabServer.server.hocuspocus.openDirectConnection(`post-${post.id}`, {
        user: { id: authorUser.id, role: 'author', name: 'Author', permissions: ['edit'] },
      });
      let storeRelease!: () => void;
      const storeGate = new Promise<void>((resolve) => { storeRelease = resolve; });
      let storeEnteredResolve!: () => void;
      const storeEntered = new Promise<void>((resolve) => { storeEnteredResolve = resolve; });
      const innerStore = adapter.store.bind(adapter);
      (adapter as any).store = async (name: string, state: Uint8Array, doc?: Y.Doc) => {
        storeEnteredResolve();
        if (storeGate) { await storeGate; }
        return innerStore(name, state, doc);
      };

      try {
        // 4. Dispatch DELETE via API, holding the pre-delete persistence store across the deletion barrier.
        const deletePromise = apiInstance.app.inject({
          method: 'DELETE',
          url: `/api/v1/posts/${post.id}`,
          headers: authHeaders,
        });
        await storeEntered;
        // Deletion is now paused on the held pre-delete store; release and await the tombstone acknowledgement.
        storeRelease();
        const deleteRes = await deletePromise;

        expect(deleteRes.statusCode).toBe(200);
        expect(tombstoneAcknowledged).toBe(true);

        // A post-deletion reconnect must be quarantined and must not resurrect or grant permissions.
        await expect(
          collabServer.server.hocuspocus.openDirectConnection(`post-${post.id}`, {
            user: { id: authorUser.id, role: 'author', name: 'Author', permissions: ['edit'] },
          }),
        ).rejects.toMatchObject({ code: 'DOCUMENT_QUARANTINED' });

        // 5. Post and expected dependent rows must be completely removed by cascade
        expect((await dbTest.db.select().from(posts).where(eq(posts.id, post.id))).length).toBe(0);
        expect((await dbTest.db.select().from(postVersions).where(eq(postVersions.postId, post.id))).length).toBe(0);
        expect((await dbTest.db.select().from(postReviews).where(eq(postReviews.postId, post.id))).length).toBe(0);
        expect((await dbTest.db.select().from(postAttachments).where(eq(postAttachments.postId, post.id))).length).toBe(0);
        expect((await dbTest.db.select().from(comments).where(eq(comments.postId, post.id))).length).toBe(0);
        expect((await dbTest.db.select().from(postCollaborators).where(eq(postCollaborators.postId, post.id))).length).toBe(0);
        expect((await dbTest.db.select().from(postTags).where(eq(postTags.postId, post.id))).length).toBe(0);

        // Disk attachment fixture must be unlinked
        expect(fs.existsSync(attachmentFilePath)).toBe(false);

        // 6. Delayed stores cannot recreate the post
        const testDoc = createDocWithText('Resurrection Attempt');
        const testBytes = docBytes(testDoc);
        testDoc.destroy();

        // Existing adapter silently drops delayed stores for tombstoned documents
        await adapter.store(`post-${post.id}`, testBytes);
        expect((await dbTest.db.select().from(posts).where(eq(posts.id, post.id))).length).toBe(0);

        // 7. Fresh persistence adapter cannot resurrect the post
        const freshAdapter = new PostgresPersistenceAdapter({
          pool: collabPool,
          allowAutoInsert: false,
        });
        expect(await freshAdapter.fetch(`post-${post.id}`)).toBeNull();
        await expect(freshAdapter.store(`post-${post.id}`, testBytes)).rejects.toThrow();
        expect((await dbTest.db.select().from(posts).where(eq(posts.id, post.id))).length).toBe(0);
      } finally {
        collabService.tombstoneDocument = origTombstone;
        delete (adapter as any).store;
        if (fs.existsSync(attachmentFilePath)) {
          fs.unlinkSync(attachmentFilePath);
        }
      }
    });
  });
});
