import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import * as Y from 'yjs';
import { and, eq } from 'drizzle-orm';
import { createApiApp } from '../src/app.js';
import { auditLogs, notifications, postCollaborators, posts, postVersions, spaceMembers, spaces, users } from '../src/db/schema.js';
import type { Database } from '../src/db/index.js';
import { CollabServiceError, deriveDocumentSnapshot } from '../src/services/collab.js';
import { createInMemoryDatabase } from './helpers/test-db.js';

type Snapshot = ReturnType<typeof deriveDocumentSnapshot>;

function snapshot(markdown: string): Snapshot {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  if (markdown) paragraph.insert(0, [new Y.XmlText(markdown)]);
  doc.getXmlFragment('prosemirror').insert(0, [paragraph]);
  try {
    return deriveDocumentSnapshot(Y.encodeStateAsUpdate(doc));
  } finally {
    doc.destroy();
  }
}

function causalRestore(currentState: Uint8Array, targetState: Uint8Array): Snapshot {
  const current = new Y.Doc();
  const target = new Y.Doc();
  try {
    Y.applyUpdate(current, currentState);
    Y.applyUpdate(target, targetState);
    const destination = current.getXmlFragment('prosemirror');
    const content = target.getXmlFragment('prosemirror').toArray()
      .map((node) => (node as Y.XmlElement | Y.XmlText).clone());
    current.transact(() => {
      destination.delete(0, destination.length);
      if (content.length) destination.insert(0, content);
    }, 'test-restore');
    return deriveDocumentSnapshot(Y.encodeStateAsUpdate(current));
  } finally {
    current.destroy();
    target.destroy();
  }
}

describe('post lifecycle mutations fail closed', () => {
  let db: Database;
  let app: any;
  let close: () => Promise<void>;
  let collab: any;
  let authorId: string;
  let headers: Record<string, string>;
  let slug = 0;

  beforeEach(async () => {
    db = createInMemoryDatabase().db;
    const [author] = await db.insert(users).values({
      email: 'lifecycle.author@blogger.corp.internal',
      fullName: 'Lifecycle Author',
      role: 'author',
      ssoProvider: 'local',
      passwordHash: await bcrypt.hash('LifecyclePass2026!', 4),
      isActive: true,
    }).returning();
    authorId = author.id;
    collab = {
      flushDocument: vi.fn(),
      restoreDocument: vi.fn(),
      tombstoneDocument: vi.fn(),
    };
    const instance = await createApiApp({
      db,
      sessionSecret: 'test-secret-32-chars-long-minimum-length',
      collabService: collab,
    });
    app = instance.app;
    close = instance.close;
    await app.ready();
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'lifecycle.author@blogger.corp.internal', password: 'LifecyclePass2026!' },
    });
    headers = {
      cookie: login.cookies.map((cookie: any) => `${cookie.name}=${cookie.value}`).join('; '),
      'x-csrf-token': login.json().csrfToken,
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await close?.();
  });

  async function fixture(currentMarkdown = 'Current working state', targetMarkdown = 'Historical target') {
    const current = snapshot(currentMarkdown);
    const target = snapshot(targetMarkdown);
    const [post] = await db.insert(posts).values({
      slug: `lifecycle-${slug++}`,
      title: 'Lifecycle fixture',
      authorId,
      status: 'draft',
      yjsState: Buffer.from(current.yjsState),
      workingMarkdown: current.workingMarkdown,
    }).returning();
    const [version] = await db.insert(postVersions).values({
      postId: post.id,
      versionNumber: 1,
      triggerReason: 'manual_save',
      yjsStateSnapshot: Buffer.from(target.yjsState),
      markdownSnapshot: target.workingMarkdown,
      createdBy: authorId,
    }).returning();
    return { post, version, current, target };
  }

  async function lifecycleAudit(action: string, postId: string) {
    return db.select().from(auditLogs).where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, postId)));
  }

  function restore(postId: string, versionId: string) {
    return app.inject({ method: 'POST', url: `/api/v1/posts/${postId}/versions/${versionId}/restore`, headers });
  }

  async function expectRestoreUnchanged(postId: string, before: Snapshot, safetyCount = 0) {
    const [saved] = await db.select().from(posts).where(eq(posts.id, postId));
    expect(deriveDocumentSnapshot(saved.yjsState).fingerprint).toBe(before.fingerprint);
    const versions = await db.select().from(postVersions).where(eq(postVersions.postId, postId));
    expect(versions).toHaveLength(1 + safetyCount);
    const safety = versions.filter((version) => version.triggerReason === 'hourly_checkpoint');
    expect(safety).toHaveLength(safetyCount);
    for (const version of safety) {
      expect(version.yjsStateSnapshot).toEqual(Buffer.from(before.yjsState));
      expect(version.markdownSnapshot).toBe(before.workingMarkdown);
      expect(version.createdBy).toBe(authorId);
    }
    expect(await lifecycleAudit('post_version_restored', postId)).toHaveLength(0);
    expect(await db.select().from(notifications)).toHaveLength(0);
  }

  it.each(['missing service', 'authentication failure', 'timeout', 'malformed acknowledgement', 'RPC failure'])(
    'keeps the relational post when delete has %s',
    async (failure) => {
      const { post } = await fixture();
      if (failure === 'missing service') collab.tombstoneDocument = undefined;
      else if (failure === 'authentication failure') {
        collab.tombstoneDocument.mockRejectedValue(new CollabServiceError('UNAUTHORIZED', 'denied'));
      } else if (failure === 'timeout') {
        collab.tombstoneDocument.mockRejectedValue(new CollabServiceError('UNAVAILABLE', 'timeout', true));
      } else if (failure === 'malformed acknowledgement') {
        collab.tombstoneDocument.mockResolvedValue({ tombstoned: false, documentName: `post-${post.id}` });
      } else collab.tombstoneDocument.mockRejectedValue(new Error('RPC failed'));

      const response = await app.inject({ method: 'DELETE', url: `/api/v1/posts/${post.id}`, headers });
      expect(response.statusCode).toBe(503);
      expect(await db.select().from(posts).where(eq(posts.id, post.id))).toHaveLength(1);
      expect(await lifecycleAudit('post_deleted', post.id)).toHaveLength(0);
    },
  );

  it('deletes only after an identity-bound tombstone acknowledgement', async () => {
    const { post } = await fixture();
    collab.tombstoneDocument.mockResolvedValue({ tombstoned: true, documentName: `post-${post.id}` });
    const response = await app.inject({ method: 'DELETE', url: `/api/v1/posts/${post.id}`, headers });
    expect(response.statusCode).toBe(200);
    expect(collab.tombstoneDocument).toHaveBeenCalledWith(post.id);
    expect(await db.select().from(posts).where(eq(posts.id, post.id))).toHaveLength(0);
    expect(await lifecycleAudit('post_deleted', post.id)).toHaveLength(1);
  });

  it.each(['missing service', 'authentication failure', 'timeout', 'bad active capture', 'bad inactive capture'])(
    'does not restore or create history after %s during capture',
    async (failure) => {
      const { post, version, current } = await fixture();
      if (failure === 'missing service') collab.flushDocument = undefined;
      else if (failure === 'authentication failure') {
        collab.flushDocument.mockRejectedValue(new CollabServiceError('UNAUTHORIZED', 'denied'));
      } else if (failure === 'timeout') {
        collab.flushDocument.mockRejectedValue(new CollabServiceError('UNAVAILABLE', 'timeout'));
      } else if (failure === 'bad active capture') {
        collab.flushDocument.mockResolvedValue({
          inMemory: true,
          documentName: `post-${post.id}`,
          ...current,
          fingerprint: '0'.repeat(64),
        });
      } else {
        collab.flushDocument.mockResolvedValue({
          inMemory: false,
          documentName: `post-${post.id}`,
          fingerprint: current.fingerprint,
        });
      }

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/posts/${post.id}/versions/${version.id}/restore`,
        headers,
      });
      expect(response.statusCode).toBe(503);
      expect(collab.restoreDocument).not.toHaveBeenCalled();
      await expectRestoreUnchanged(post.id, current);
    },
  );

  it('rejects incoherent target version bytes before any collaboration mutation', async () => {
    const { post, version, current } = await fixture();
    await db.update(postVersions).set({ markdownSnapshot: 'Not the Yjs projection' })
      .where(eq(postVersions.id, version.id));
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post.id}/versions/${version.id}/restore`,
      headers,
    });
    expect(response.statusCode).toBe(409);
    expect(collab.flushDocument).not.toHaveBeenCalled();
    await expectRestoreUnchanged(post.id, current);
  });

  it.each(['concurrency conflict', 'authentication failure', 'RPC failure', 'uncertain timeout',
    'malformed restore acknowledgement', 'coherent wrong-target acknowledgement'])(
    'retains committed safety without success after restore %s',
    async (failure) => {
      const { post, version, current, target } = await fixture();
      collab.flushDocument.mockResolvedValue({
        inMemory: true,
        documentName: `post-${post.id}`,
        ...current,
      });
      if (failure === 'concurrency conflict') {
        collab.restoreDocument.mockRejectedValue(new CollabServiceError('CONFLICT', 'changed'));
      } else if (failure === 'authentication failure') {
        collab.restoreDocument.mockRejectedValue(new CollabServiceError('UNAUTHORIZED', 'denied'));
      } else if (failure === 'RPC failure') {
        collab.restoreDocument.mockRejectedValue(new Error('restore failed'));
      } else if (failure === 'uncertain timeout') {
        collab.restoreDocument.mockRejectedValue(new CollabServiceError('UNAVAILABLE', 'acknowledgement lost', true));
      } else if (failure === 'coherent wrong-target acknowledgement') {
        collab.restoreDocument.mockResolvedValue({ inMemory: true, documentName: `post-${post.id}`, ...current });
      } else {
        collab.restoreDocument.mockResolvedValue({
          inMemory: true,
          documentName: `post-${post.id}`,
          ...target,
          fingerprint: '0'.repeat(64),
        });
      }

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/posts/${post.id}/versions/${version.id}/restore`,
        headers,
      });
      expect(response.statusCode).toBe(failure === 'concurrency conflict' ? 409 : 503);
      expect(response.json().success).not.toBe(true);
      expect(collab.restoreDocument).toHaveBeenCalledWith(post.id, target.yjsState, current.fingerprint);
      await expectRestoreUnchanged(post.id, current, 1);
    },
  );

  it.each(['before capture', 'after capture'].flatMap((timing) =>
    ['stale admin role', 'inactive actor', 'direct grant', 'space grant'].map((access) => ({ timing, access }))))(
    'rejects revoked $access $timing without a safety checkpoint',
    async ({ timing, access }) => {
      const { post, version, current } = await fixture();
      if (access !== 'inactive actor') {
        const [owner] = await db.insert(users).values({
          email: 'lifecycle.owner@blogger.corp.internal', fullName: 'Other owner', role: 'author', isActive: true,
        }).returning();
        await db.update(posts).set({ authorId: owner.id }).where(eq(posts.id, post.id));
      }
      let spaceId: string;
      if (access === 'stale admin role') {
        await db.update(users).set({ role: 'admin' }).where(eq(users.id, authorId));
        const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login',
          payload: { email: 'lifecycle.author@blogger.corp.internal', password: 'LifecyclePass2026!' } });
        headers = { cookie: login.cookies.map((cookie: any) => `${cookie.name}=${cookie.value}`).join('; '),
          'x-csrf-token': login.json().csrfToken };
      } else if (access === 'direct grant') {
        await db.insert(postCollaborators).values({ postId: post.id, userId: authorId, permission: 'edit' });
      } else if (access === 'space grant') {
        const [space] = await db.insert(spaces).values({ slug: 'lifecycle-space', name: 'Lifecycle space' }).returning();
        spaceId = space.id;
        await db.update(posts).set({ spaceId, visibility: 'space' }).where(eq(posts.id, post.id));
        await db.insert(spaceMembers).values({ spaceId, userId: authorId, role: 'author' });
      }
      const revoke = async () => {
        if (access === 'stale admin role') await db.update(users).set({ role: 'reader' }).where(eq(users.id, authorId));
        else if (access === 'inactive actor') await db.update(users).set({ isActive: false }).where(eq(users.id, authorId));
        else if (access === 'direct grant') await db.update(postCollaborators).set({ permission: 'view' })
          .where(and(eq(postCollaborators.postId, post.id), eq(postCollaborators.userId, authorId)));
        else await db.update(spaceMembers).set({ role: 'viewer' })
          .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, authorId)));
      };
      if (timing === 'before capture') await revoke();
      collab.flushDocument.mockImplementation(async () => {
        if (timing === 'after capture') await revoke();
        return { inMemory: true, documentName: `post-${post.id}`, ...current };
      });

      const response = await restore(post.id, version.id);
      expect(response.statusCode).toBe(403);
      expect(collab.flushDocument).toHaveBeenCalledTimes(timing === 'after capture' ? 1 : 0);
      expect(collab.restoreDocument).not.toHaveBeenCalled();
      await expectRestoreUnchanged(post.id, current);
    },
  );

  it('awaits safety commit acknowledgement before restore, with neither RPC inside the transaction', async () => {
    const { post, version, current, target } = await fixture();
    await db.update(posts).set({ status: 'published', submittedVersionId: version.id,
      publishedVersionId: version.id, publishedMarkdown: 'Previous publication' }).where(eq(posts.id, post.id));
    const order: string[] = [];
    let transactionPending = false;
    let checkpointReady!: () => void;
    let releaseCommit!: () => void;
    const ready = new Promise<void>((resolve) => { checkpointReady = resolve; });
    const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
    const transaction = db.transaction.bind(db);
    vi.spyOn(db, 'transaction').mockImplementation((async (callback, config) => {
      transactionPending = true;
      const result = await transaction(callback, config);
      order.push('safety committed');
      checkpointReady();
      await commitGate;
      transactionPending = false;
      order.push('commit acknowledged');
      return result;
    }) as typeof db.transaction);
    collab.flushDocument.mockImplementation(async () => {
      expect(transactionPending).toBe(false);
      order.push('capture');
      return { inMemory: true, documentName: `post-${post.id}`, ...current };
    });
    collab.restoreDocument.mockImplementation(async () => {
      expect(transactionPending).toBe(false);
      expect(order).toEqual(['capture', 'safety committed', 'commit acknowledged']);
      await expectRestoreUnchanged(post.id, current, 1);
      order.push('restore');
      return { inMemory: true, documentName: `post-${post.id}`, ...causalRestore(current.yjsState, target.yjsState) };
    });
    const pending = Promise.resolve(restore(post.id, version.id));
    try {
      await Promise.race([ready, pending.then(() => { throw new Error('Restore completed before commit acknowledgement'); })]);
      expect(collab.restoreDocument).not.toHaveBeenCalled();
      releaseCommit();
      const response = await pending;
      expect(response.statusCode).toBe(200);
      expect(order).toEqual(['capture', 'safety committed', 'commit acknowledged', 'restore']);
      expect(await lifecycleAudit('post_version_restored', post.id)).toHaveLength(1);
      const [saved] = await db.select().from(posts).where(eq(posts.id, post.id));
      expect(saved).toMatchObject({ status: 'published', submittedVersionId: version.id,
        publishedVersionId: version.id, publishedMarkdown: 'Previous publication' });
      expect(saved.yjsState).toEqual(Buffer.from(current.yjsState));
    } finally {
      releaseCommit();
      await pending;
    }
  });

  it.each(['safety insertion', 'ambiguous commit acknowledgement'])(
    'never dispatches restore after failed %s', async (failure) => {
      const { post, version, current } = await fixture();
      collab.flushDocument.mockResolvedValue({ inMemory: true, documentName: `post-${post.id}`, ...current });
      const transaction = db.transaction.bind(db);
      vi.spyOn(db, 'transaction').mockImplementationOnce(async (callback, config) => {
        await transaction(async (tx) => {
          if (failure === 'safety insertion') vi.spyOn(tx, 'insert').mockImplementation(() => { throw new Error('Insert failed'); });
          return callback(tx);
        }, config);
        // Model a rejected commit acknowledgement even if its write committed.
        throw new Error('Commit acknowledgement lost');
      });
      const response = await restore(post.id, version.id);
      expect(response.statusCode).toBe(503);
      expect(collab.restoreDocument).not.toHaveBeenCalled();
      await expectRestoreUnchanged(post.id, current, failure === 'safety insertion' ? 0 : 1);
    },
  );

  it('checkpoints the inactive state reread after acknowledgement, without using its stale Markdown cache', async () => {
    const { post, version, target } = await fixture();
    const afterAck = snapshot('Persisted during capture');
    collab.flushDocument.mockImplementation(async () => {
      await db.update(posts).set({ yjsState: Buffer.from(afterAck.yjsState), workingMarkdown: 'Stale cache' })
        .where(eq(posts.id, post.id));
      return { inMemory: false, documentName: `post-${post.id}` };
    });
    collab.restoreDocument.mockRejectedValue(new CollabServiceError('CONFLICT', 'changed'));
    expect((await restore(post.id, version.id)).statusCode).toBe(409);
    expect(collab.restoreDocument).toHaveBeenCalledWith(post.id, target.yjsState, afterAck.fingerprint);
    await expectRestoreUnchanged(post.id, afterAck, 1);
    const [saved] = await db.select().from(posts).where(eq(posts.id, post.id));
    expect(saved.workingMarkdown).toBe('Stale cache');
  });

  it('keeps the original safety after an uncertain persisted restore and creates authentic safety on retry', async () => {
    const { post, version, current, target } = await fixture();
    const restored = causalRestore(current.yjsState, target.yjsState);
    collab.flushDocument.mockResolvedValueOnce({ inMemory: true, documentName: `post-${post.id}`, ...current })
      .mockResolvedValueOnce({ inMemory: true, documentName: `post-${post.id}`, ...restored });
    collab.restoreDocument.mockImplementationOnce(async () => {
      await db.update(posts).set({ yjsState: Buffer.from(restored.yjsState), workingMarkdown: restored.workingMarkdown })
        .where(eq(posts.id, post.id));
      throw new CollabServiceError('UNAVAILABLE', 'Restore acknowledgement lost', true);
    }).mockRejectedValueOnce(new CollabServiceError('CONFLICT', 'changed again'));

    expect((await restore(post.id, version.id)).statusCode).toBe(503);
    const [originalSafety] = await db.select().from(postVersions)
      .where(and(eq(postVersions.postId, post.id), eq(postVersions.versionNumber, 2)));
    expect(originalSafety.yjsStateSnapshot).toEqual(Buffer.from(current.yjsState));
    expect((await restore(post.id, version.id)).statusCode).toBe(409);
    const versions = await db.select().from(postVersions).where(eq(postVersions.postId, post.id));
    expect(versions).toHaveLength(3);
    expect(versions.find((candidate) => candidate.id === originalSafety.id)).toEqual(originalSafety);
    const retrySafety = versions.find((candidate) => candidate.versionNumber === 3)!;
    expect(retrySafety).toMatchObject({ triggerReason: 'hourly_checkpoint', markdownSnapshot: restored.workingMarkdown, createdBy: authorId });
    expect(retrySafety.yjsStateSnapshot).toEqual(Buffer.from(restored.yjsState));
    expect(collab.restoreDocument).toHaveBeenLastCalledWith(post.id, target.yjsState, restored.fingerprint);
    expect(await lifecycleAudit('post_version_restored', post.id)).toHaveLength(0);
  });

  it.each([
    { name: 'active capture', active: true, current: 'Live unsaved state' },
    { name: 'inactive capture', active: false, current: 'Persisted inactive state' },
    { name: 'valid empty capture', active: true, current: '' },
  ])('restores from a coherent $name and checkpoints the exact pre-restore state', async ({ active, current: text }) => {
    const { post, version, current, target } = await fixture(text);
    collab.flushDocument.mockImplementation(async () => active
      ? { inMemory: true, documentName: `post-${post.id}`, ...current }
      : { inMemory: false, documentName: `post-${post.id}` });
    collab.restoreDocument.mockImplementation(async (_postId: string, targetState: Uint8Array) => {
      const restored = causalRestore(current.yjsState, targetState);
      await db.update(posts).set({
        yjsState: Buffer.from(restored.yjsState),
        workingMarkdown: restored.workingMarkdown,
      }).where(eq(posts.id, post.id));
      return { inMemory: active, documentName: `post-${post.id}`, ...restored };
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post.id}/versions/${version.id}/restore`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(collab.restoreDocument).toHaveBeenCalledWith(post.id, target.yjsState, current.fingerprint);
    const versions = await db.select().from(postVersions).where(eq(postVersions.postId, post.id));
    const safety = versions.find((candidate) => candidate.versionNumber === 2)!;
    expect(safety.triggerReason).toBe('hourly_checkpoint');
    expect(safety.markdownSnapshot).toBe(current.workingMarkdown);
    expect(deriveDocumentSnapshot(safety.yjsStateSnapshot).fingerprint).toBe(current.fingerprint);
    const [saved] = await db.select().from(posts).where(eq(posts.id, post.id));
    expect(deriveDocumentSnapshot(saved.yjsState).workingMarkdown).toBe(target.workingMarkdown);
    expect(await lifecycleAudit('post_version_restored', post.id)).toHaveLength(1);
  });

  it('never overwrites a newer working edit after the collaboration restore', async () => {
    const { post, version, current, target } = await fixture();
    const newer = snapshot('Editor typed after restore');
    collab.flushDocument.mockResolvedValue({ inMemory: true, documentName: `post-${post.id}`, ...current });
    collab.restoreDocument.mockImplementation(async () => {
      const restored = causalRestore(current.yjsState, target.yjsState);
      await db.update(posts).set({
        yjsState: Buffer.from(restored.yjsState), workingMarkdown: restored.workingMarkdown,
      }).where(eq(posts.id, post.id));
      await db.update(posts).set({
        yjsState: Buffer.from(newer.yjsState), workingMarkdown: newer.workingMarkdown,
      }).where(eq(posts.id, post.id));
      return { inMemory: true, documentName: `post-${post.id}`, ...restored };
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${post.id}/versions/${version.id}/restore`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    const [saved] = await db.select().from(posts).where(eq(posts.id, post.id));
    expect(deriveDocumentSnapshot(saved.yjsState).fingerprint).toBe(newer.fingerprint);
  });
});
