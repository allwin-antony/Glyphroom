import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { DataType } from 'pg-mem';
import * as Y from 'yjs';
import { initProseMirrorDoc, prosemirrorJSONToYDoc, relativePositionToAbsolutePosition } from 'y-prosemirror';
import { blogSchema, exportDerivedMarkdown, type ProseMirrorNodeJSON } from '@enterprise-blogger/shared';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { createApiApp } from '../src/app.js';
import { AuthService } from '../src/services/auth.js';
import { comments, posts, postVersions, postCollaborators, spaceMembers, spaces, users } from '../src/db/schema.js';
import type { Database } from '../src/db/index.js';

const WORKING = 'WORKING_BODY_SENTINEL';
const SUBMITTED = 'SUBMITTED_BODY_SENTINEL';
const PUBLISHED = 'PUBLISHED_BODY_SENTINEL';
const PASSWORD = 'DetailPrivacy2026!';
const roles = {
  author: 'author', admin: 'admin', editor: 'reader', viewer: 'reader', reviewer: 'reader',
  reader: 'reader', unrelatedAuthor: 'author', moderator: 'moderator', mixedModerator: 'moderator',
  spaceAuthor: 'reader', spaceReviewer: 'reader', spaceViewer: 'reader', mixedReviewer: 'reader',
  maintainer: 'reader', owner: 'reader',
} as const;
type Caller = keyof typeof roles;

// pg-mem's parameter adapter UTF-8-coerces binary parameters. Decode hex in SQL
// so these fixtures exercise real, uncorrupted Yjs updates (including high bytes).
const bytea = (value: Buffer) => sql`decode(${value.toString('hex')}, 'hex')`;

function state(markdown: string, root = 'prosemirror', legacy?: string): Buffer {
  const doc = new Y.Doc();
  for (const [name, text] of [[root, markdown], ...(legacy === undefined ? [] : [['default', legacy]])]) {
    const fragment = doc.getXmlFragment(name);
    const paragraph = new Y.XmlElement('paragraph');
    if (text) paragraph.insert(0, [new Y.XmlText(text)]);
    fragment.insert(0, [paragraph]);
    if (!text) fragment.delete(0, 1); // Persist an intentionally empty root.
  }
  const result = Buffer.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return result;
}

const heading = (label: string): ProseMirrorNodeJSON => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: label }] });

function headingState(content: ProseMirrorNodeJSON[], root = 'prosemirror') {
  const json = { type: 'doc', content };
  const doc = prosemirrorJSONToYDoc(blogSchema, json, root);
  const bytes = Buffer.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return { bytes, markdown: exportDerivedMarkdown(json) };
}

// Decode exactly as CommentsTab does, against the saved document's original IDs.
function decodeAnchor(bytes: Uint8Array, comment: typeof comments.$inferSelect) {
  const ydoc = new Y.Doc();
  try {
    Y.applyUpdate(ydoc, bytes);
    const fragment = ydoc.getXmlFragment(ydoc.share.has('prosemirror') ? 'prosemirror' : 'default');
    const { doc, meta } = initProseMirrorDoc(fragment, blogSchema);
    const from = relativePositionToAbsolutePosition(ydoc, fragment, Y.createRelativePositionFromJSON(comment.yjsAnchorStart), meta.mapping);
    const to = relativePositionToAbsolutePosition(ydoc, fragment, Y.createRelativePositionFromJSON(comment.yjsAnchorEnd), meta.mapping);
    return { from, to, text: from === null || to === null ? null : doc.textBetween(from, to) };
  } finally { ydoc.destroy(); }
}

describe('post detail content-grant privacy', () => {
  let db: Database;
  let app: Awaited<ReturnType<typeof createApiApp>>['app'];
  let close: () => Promise<void>;
  let pool: ReturnType<typeof createInMemoryDatabase>['pool'];
  const ids = Object.fromEntries(Object.keys(roles).map((key) => [key, randomUUID()])) as Record<Caller, string>;
  const cookies = new Map<Caller, string>();
  const csrfTokens = new Map<Caller, string>();
  const spaceId = randomUUID();

  beforeAll(async () => {
    const memory = createInMemoryDatabase();
    db = memory.db;
    pool = memory.pool;
    memory.pgMem.public.registerFunction({ name: 'decode', args: [DataType.text, DataType.text],
      returns: DataType.bytea, implementation: (value: string) => Buffer.from(value, 'hex') });
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    await db.insert(users).values(Object.entries(roles).map(([name, role]) => ({
      id: ids[name as Caller], email: `${name.toLowerCase()}@detail.example.com`, fullName: name,
      role, passwordHash, ssoProvider: 'local', isActive: true,
    })));
    await db.insert(spaces).values({ id: spaceId, slug: 'detail-privacy', name: 'Detail privacy' });
    await db.insert(spaceMembers).values([
      { spaceId, userId: ids.spaceAuthor, role: 'author' },
      { spaceId, userId: ids.spaceReviewer, role: 'reviewer' },
      { spaceId, userId: ids.spaceViewer, role: 'viewer' },
      { spaceId, userId: ids.mixedReviewer, role: 'viewer' },
      { spaceId, userId: ids.maintainer, role: 'maintainer' },
      { spaceId, userId: ids.owner, role: 'owner' },
    ]);
    const instance = await createApiApp({ db, sessionSecret: 'detail-privacy-session-secret-32-characters' });
    app = instance.app;
    close = instance.close;
    await app.ready();
  });

  afterAll(async () => { await close?.(); });

  async function read(post: { id: string; slug: string }, caller?: Caller, slug = false) {
    if (caller && !cookies.has(caller)) {
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: {
        email: `${caller.toLowerCase()}@detail.example.com`, password: PASSWORD,
      } });
      expect(login.statusCode).toBe(200);
      cookies.set(caller, login.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '));
      csrfTokens.set(caller, new AuthService(db, 'detail-privacy-session-secret-32-characters')
        .generateCsrfToken(login.cookies.find((cookie) => cookie.name === 'blogger_session')!.value));
    }
    const response = await app.inject({ method: 'GET', url: `/api/v1/posts/${slug ? post.slug : post.id}`,
      headers: caller ? { cookie: cookies.get(caller)! } : undefined });
    const exported = await app.inject({ method: 'GET', url: `/api/v1/posts/${slug ? post.slug : post.id}/export-markdown`,
      headers: caller ? { cookie: cookies.get(caller)! } : undefined });
    expect(exported.statusCode, `export parity for ${caller ?? 'anonymous'}`).toBe(response.statusCode);
    if (response.statusCode === 200) {
      expect(exported.body).toBe(response.json().post.derivedMarkdown);
      expect(exported.headers['content-type']).toContain('text/markdown');
      expect(exported.headers['content-disposition']).toBe(`attachment; filename="${post.slug}.md"`);
    } else {
      expect(exported.json()).not.toHaveProperty('post');
      expect(exported.body).not.toContain(WORKING);
      expect(exported.body).not.toContain(SUBMITTED);
    }
    return response;
  }

  async function fixture(overrides: Partial<typeof posts.$inferInsert> = {}, snapshot = SUBMITTED) {
    const id = randomUUID();
    const [post] = await db.insert(posts).values({
      id, slug: `detail-${id}`, title: 'Public metadata', authorId: ids.author,
      status: 'in_review', spaceId, isPromoted: true, visibility: 'space',
      workingMarkdown: 'STALE_CACHE', publishedMarkdown: PUBLISHED,
      ...overrides,
      yjsState: bytea(overrides.yjsState ?? state(WORKING)),
    }).returning();
    const [version] = await db.insert(postVersions).values({
      postId: post.id, versionNumber: 1, triggerReason: 'review_submission',
      yjsStateSnapshot: bytea(state(snapshot)), markdownSnapshot: snapshot, createdBy: ids.author,
    }).returning();
    await db.update(posts).set({ submittedVersionId: version.id }).where(eq(posts.id, post.id));
    await db.insert(postCollaborators).values([
      { postId: post.id, userId: ids.editor, permission: 'edit' },
      { postId: post.id, userId: ids.viewer, permission: 'view' },
      { postId: post.id, userId: ids.reviewer, permission: 'review' },
      { postId: post.id, userId: ids.mixedModerator, permission: 'view' },
      { postId: post.id, userId: ids.mixedReviewer, permission: 'review' },
    ]);
    return { post, version };
  }

  async function anchorFixture(workingContent = [heading('Working Heading')]) {
    const working = headingState(workingContent);
    const submitted = headingState([heading('Submitted Heading')]);
    const published = headingState([heading('Published Heading')]);
    const { post, version } = await fixture({ yjsState: working.bytes, publishedMarkdown: published.markdown }, submitted.markdown);
    await db.update(postVersions).set({ yjsStateSnapshot: bytea(submitted.bytes) }).where(eq(postVersions.id, version.id));
    const [publication] = await db.insert(postVersions).values({ postId: post.id, versionNumber: 2,
      triggerReason: 'publication', yjsStateSnapshot: bytea(published.bytes), markdownSnapshot: published.markdown,
      createdBy: ids.author }).returning();
    const latest = headingState([heading('Latest Must Not Win')]);
    await db.insert(postVersions).values({ postId: post.id, versionNumber: 3, triggerReason: 'manual_save',
      yjsStateSnapshot: bytea(latest.bytes), markdownSnapshot: latest.markdown, createdBy: ids.author });
    await db.update(posts).set({ publishedVersionId: publication.id }).where(eq(posts.id, post.id));
    return { post, version, publication, working, submitted, published };
  }

  async function createComment(post: { id: string; slug: string }, payload: Record<string, unknown>, caller: Caller = 'author') {
    if (!cookies.has(caller)) await read(post, caller);
    return app.inject({ method: 'POST', url: `/api/v1/posts/${post.id}/comments`,
      headers: { cookie: cookies.get(caller)!, 'x-csrf-token': csrfTokens.get(caller)! }, payload });
  }

  it('saves UI-decodable heading anchors on roots and valid replies, retaining causal positions after preceding insertions', async () => {
    const target = await anchorFixture();
    const parentResponse = await createComment(target.post, { content: 'Unanchored parent' });
    expect(parentResponse.statusCode).toBe(201);
    const parent = parentResponse.json().comment;
    const rootResponse = await createComment(target.post, { content: 'Root', anchorHeading: ' **WORKING Heading** ',
      yjsAnchorStart: null, yjsAnchorEnd: null });
    const replyResponse = await createComment(target.post, { content: 'Reply', parentId: parent.id, anchorHeading: 'Working Heading' });
    expect(rootResponse.statusCode, rootResponse.body).toBe(201);
    expect(replyResponse.statusCode, replyResponse.body).toBe(201);
    const saved = await db.select().from(comments).where(eq(comments.postId, target.post.id));
    const root = saved.find((comment) => comment.id === rootResponse.json().comment.id)!;
    const anchoredReply = saved.find((comment) => comment.id === replyResponse.json().comment.id)!;
    expect(anchoredReply.parentId).toBe(parent.id);
    expect(saved.find((comment) => comment.id === parent.id)).toMatchObject({ yjsAnchorStart: null, yjsAnchorEnd: null });
    for (const comment of [root, anchoredReply]) {
      expect(comment.yjsAnchorStart).toEqual(rootResponse.json().comment.yjsAnchorStart);
      expect(decodeAnchor(target.working.bytes, comment)).toEqual({ from: 1, to: 16, text: 'Working Heading' });
      expect(decodeAnchor(target.submitted.bytes, comment).from).toBeNull();
    }
    const producer = new Y.Doc();
    const consumer = new Y.Doc();
    try {
      Y.applyUpdate(producer, target.working.bytes);
      Y.applyUpdate(consumer, target.working.bytes);
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.insert(0, [new Y.XmlText('Inserted before')]);
      producer.getXmlFragment('prosemirror').insert(0, [paragraph]);
      Y.applyUpdate(consumer, Y.encodeStateAsUpdate(producer));
      for (const comment of [root, anchoredReply]) {
        expect(decodeAnchor(Y.encodeStateAsUpdate(consumer), comment)).toEqual({ from: 18, to: 33, text: 'Working Heading' });
      }
    } finally { producer.destroy(); consumer.destroy(); }
    const [unchanged] = await db.select().from(posts).where(eq(posts.id, target.post.id));
    expect(unchanged.yjsState).toEqual(target.working.bytes);
    expect(unchanged.workingMarkdown).toBe('STALE_CACHE');
  });

  it('anchors only the authorized working, exact submitted or exact published state, never another body or latest version', async () => {
    const target = await anchorFixture();
    for (const [caller, source, label] of [
      ['author', 'working', 'Working Heading'], ['viewer', 'working', 'Working Heading'],
      ['mixedReviewer', 'working', 'Working Heading'], ['reviewer', 'submitted', 'Submitted Heading'],
    ] as const) {
      expect((await read(target.post, caller)).json().post.contentSource).toBe(source);
      const response = await createComment(target.post, { content: 'Authorized anchor', anchorHeading: label }, caller);
      expect(response.statusCode, response.body).toBe(201);
      expect(decodeAnchor(target[source].bytes, response.json().comment).text).toBe(label);
      const hidden = await createComment(target.post, { content: 'Hidden body', anchorHeading: source === 'working' ? 'Submitted Heading' : 'Working Heading' }, caller);
      expect(hidden.statusCode).toBe(400);
      expect(hidden.json().code).toBe('ANCHOR_HEADING_NOT_FOUND');
    }
    await db.update(posts).set({ status: 'published', submittedVersionId: null }).where(eq(posts.id, target.post.id));
    expect((await read(target.post, 'reader')).json().post.contentSource).toBe('published');
    const publication = await createComment(target.post, { content: 'Published anchor', anchorHeading: 'Published Heading' }, 'reader');
    expect(publication.statusCode, publication.body).toBe(201);
    expect(decodeAnchor(target.published.bytes, publication.json().comment).text).toBe('Published Heading');
    for (const anchorHeading of ['Working Heading', 'Submitted Heading', 'Latest Must Not Win']) {
      expect((await createComment(target.post, { content: 'Hidden', anchorHeading }, 'reader')).statusCode).toBe(400);
    }
    expect(await db.select().from(comments).where(eq(comments.postId, target.post.id))).toHaveLength(5);
  });

  it('matches clean labels without hidden suggestions, quoted collisions or fenced-heading existence oracles', async () => {
    const pending = (text: string): ProseMirrorNodeJSON => ({ type: 'text', text,
      marks: [{ type: 'suggestion_insert', attrs: { status: 'pending' } }] });
    const target = await anchorFixture([
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Visible' }, pending(' secret suffix')] },
      { type: 'heading', attrs: { level: 2 }, content: [pending('Visible')] },
      { type: 'heading', attrs: { level: 2 }, content: [pending('Hidden Pending')] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hidden Accepted Deletion',
        marks: [{ type: 'suggestion_delete', attrs: { status: 'accepted' } }] }] },
      { type: 'blockquote', content: [heading('Visible')] },
      { type: 'code_block', attrs: { language: 'markdown' }, content: [{ type: 'text', text: '## Hidden Fence' }] },
    ]);
    const response = await createComment(target.post, { content: 'Clean heading', anchorHeading: 'Visible' });
    expect(response.statusCode, response.body).toBe(201);
    expect(decodeAnchor(target.working.bytes, response.json().comment)).toEqual({ from: 1, to: 22, text: 'Visible secret suffix' });
    for (const anchorHeading of ['Visible secret suffix', 'Hidden Pending', 'Hidden Accepted Deletion', 'Hidden Fence', 'Not Present', '']) {
      const denied = await createComment(target.post, { content: 'No oracle', anchorHeading });
      expect(denied.statusCode, anchorHeading).toBe(400);
      expect(denied.json().code).toBe('ANCHOR_HEADING_NOT_FOUND');
    }
    expect(await db.select().from(comments).where(eq(comments.postId, target.post.id))).toHaveLength(1);
    const ambiguous = await anchorFixture([heading('Duplicate'), heading('duplicate')]);
    const rejected = await createComment(ambiguous.post, { content: 'Ambiguous', anchorHeading: 'Duplicate' });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().code).toBe('ANCHOR_HEADING_AMBIGUOUS');
    expect(await db.select().from(comments).where(eq(comments.postId, ambiguous.post.id))).toHaveLength(0);
  });

  it('preserves explicit and unanchored paths while denying mixed anchors, denied callers, cross-post and nested parents before insert', async () => {
    const target = await anchorFixture();
    const explicit = { yjsAnchorStart: { opaque: 'start' }, yjsAnchorEnd: { opaque: 'end' } };
    const root = await createComment(target.post, { content: 'Explicit', ...explicit });
    expect(root.statusCode).toBe(201);
    expect(root.json().comment).toMatchObject(explicit);
    const parentId = root.json().comment.id;
    const reply = await createComment(target.post, { content: 'Unanchored reply', parentId });
    expect(reply.statusCode).toBe(201);
    expect(reply.json().comment).toMatchObject({ parentId, yjsAnchorStart: null, yjsAnchorEnd: null });
    const other = await anchorFixture();
    for (const payload of [
      { content: 'Mixed', anchorHeading: 'Working Heading', yjsAnchorStart: {} },
      { content: 'Cross post', anchorHeading: 'Working Heading', parentId: (await createComment(other.post, { content: 'Other root' })).json().comment.id },
      { content: 'Nested', anchorHeading: 'Working Heading', parentId: reply.json().comment.id },
      { content: 'Oversized', anchorHeading: 'h'.repeat(501) },
    ]) expect((await createComment(target.post, payload)).statusCode).toBe(400);
    const denied = await fixture({ status: 'draft', isPromoted: false, visibility: 'invited_only', publishedMarkdown: null });
    expect((await createComment(denied.post, { content: 'Denied', anchorHeading: 'Working Heading' }, 'unrelatedAuthor')).statusCode).toBe(403);
    expect(await db.select().from(comments).where(eq(comments.postId, target.post.id))).toHaveLength(2);
    expect(await db.select().from(comments).where(eq(comments.postId, denied.post.id))).toHaveLength(0);
  });

  it('rejects incoherent or unavailable selected historical Yjs and publication pins instead of inventing anchor IDs', async () => {
    const target = await anchorFixture();
    const other = await anchorFixture();
    await db.update(postVersions).set({ yjsStateSnapshot: bytea(target.working.bytes) }).where(eq(postVersions.id, target.version.id));
    const submission = await createComment(target.post, { content: 'Incoherent submission', anchorHeading: 'Submitted Heading' }, 'reviewer');
    expect(submission.statusCode).toBe(409);
    expect(submission.json().code).toBe('ANCHOR_STATE_UNAVAILABLE');
    await db.update(posts).set({ status: 'published', submittedVersionId: null }).where(eq(posts.id, target.post.id));
    for (const publishedVersionId of [null, randomUUID(), other.publication.id]) {
      await db.update(posts).set({ publishedVersionId }).where(eq(posts.id, target.post.id));
      const response = await createComment(target.post, { content: 'No historical fallback', anchorHeading: 'Published Heading' }, 'reader');
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('ANCHOR_STATE_UNAVAILABLE');
    }
    for (const triggerReason of ['manual_save', 'hourly_checkpoint', 'review_submission', 'publication'] as const) {
      const candidate = await anchorFixture();
      await db.update(posts).set({ status: 'published', submittedVersionId: null }).where(eq(posts.id, candidate.post.id));
      await db.update(postVersions).set({ triggerReason }).where(eq(postVersions.id, candidate.publication.id));
      expect((await read(candidate.post, 'reader')).json().post.derivedMarkdown).toBe(candidate.publication.markdownSnapshot);
      const response = await createComment(candidate.post, { content: 'Matching-body publication kind', anchorHeading: 'Published Heading' }, 'reader');
      if (triggerReason === 'manual_save' || triggerReason === 'hourly_checkpoint') {
        expect(response.statusCode, triggerReason).toBe(409);
        expect(response.json().code).toBe('ANCHOR_STATE_UNAVAILABLE');
        expect(await db.select().from(comments).where(eq(comments.postId, candidate.post.id))).toHaveLength(0);
      } else {
        expect(response.statusCode, response.body).toBe(201);
        expect(decodeAnchor(candidate.published.bytes, response.json().comment).text).toBe('Published Heading');
        expect(await db.select().from(comments).where(eq(comments.postId, candidate.post.id))).toHaveLength(1);
      }
    }
    await db.update(posts).set({ publishedVersionId: target.publication.id }).where(eq(posts.id, target.post.id));
    await pool.query('ALTER TABLE post_versions ALTER COLUMN yjs_state_snapshot DROP NOT NULL');
    await pool.query('UPDATE post_versions SET yjs_state_snapshot = NULL WHERE id = $1', [target.publication.id]);
    expect((await createComment(target.post, { content: 'Missing historical state', anchorHeading: 'Published Heading' }, 'reader')).json().code).toBe('ANCHOR_STATE_UNAVAILABLE');
    expect(await db.select().from(comments).where(eq(comments.postId, target.post.id))).toHaveLength(0);
  });

  it('uses original legacy heading IDs, lets empty canonical content win, and rejects incomplete/cache-only working state', async () => {
    const legacy = headingState([heading('Legacy Heading')], 'default');
    const target = await fixture({ yjsState: legacy.bytes });
    const response = await createComment(target.post, { content: 'Legacy anchor', anchorHeading: 'Legacy Heading' });
    expect(response.statusCode, response.body).toBe(201);
    expect(decodeAnchor(legacy.bytes, response.json().comment).text).toBe('Legacy Heading');
    const partial = new Y.Doc();
    partial.getText('unrelated').insert(0, 'base');
    const vector = Y.encodeStateVector(partial);
    partial.getText('unrelated').insert(4, 'dependent');
    const incomplete = Buffer.from(Y.encodeStateAsUpdate(partial, vector));
    partial.destroy();
    for (const [bytes, label, code] of [
      [state('', 'prosemirror', 'Legacy Heading'), 'Legacy Heading', 'ANCHOR_HEADING_NOT_FOUND'],
      [Buffer.from([1]), 'Cache Heading', 'ANCHOR_STATE_UNAVAILABLE'],
      [incomplete, 'Cache Heading', 'ANCHOR_STATE_UNAVAILABLE'],
    ] as const) {
      const broken = await fixture({ yjsState: bytes, workingMarkdown: '## Cache Heading' });
      const rejected = await createComment(broken.post, { content: 'No invented IDs', anchorHeading: label });
      expect(rejected.json().code, rejected.body).toBe(code);
      expect(await db.select().from(comments).where(eq(comments.postId, broken.post.id))).toHaveLength(0);
      expect((await createComment(broken.post, { content: 'Still unanchored' })).statusCode).toBe(201);
    }
  });

  it('enforces the full accumulated-grant matrix by ID and slug with absent private keys', async () => {
    const { post, version } = await fixture();
    const cases: Array<[Caller | undefined, 'working' | 'submitted' | 'published', boolean, boolean]> = [
      [undefined, 'published', false, false], ['reader', 'published', false, false],
      ['unrelatedAuthor', 'published', false, false], ['author', 'working', true, true],
      ['admin', 'working', true, true], ['editor', 'working', true, true],
      ['spaceAuthor', 'working', true, true], ['maintainer', 'working', true, true], ['owner', 'working', true, true],
      ['viewer', 'working', false, false], ['spaceViewer', 'working', false, false],
      ['mixedModerator', 'working', false, true], ['mixedReviewer', 'working', false, true],
      ['reviewer', 'submitted', false, true], ['spaceReviewer', 'submitted', false, true],
      ['moderator', 'submitted', false, true],
    ];
    for (const [caller, source, editor, submission] of cases) {
      for (const slug of [false, true]) {
        const response = await read(post, caller, slug);
        expect(response.statusCode, `${caller ?? 'anonymous'} ${slug ? 'slug' : 'id'}`).toBe(200);
        const payload = response.json().post;
        expect(payload.contentSource).toBe(source);
        expect(payload.derivedMarkdown).toBe({ working: WORKING, submitted: SUBMITTED, published: PUBLISHED }[source]);
        expect(payload.publishedMarkdown).toBe(PUBLISHED);
        if (source === 'working') expect(payload.workingMarkdown).toBe(WORKING);
        else expect(payload).not.toHaveProperty('workingMarkdown');
        if (editor) expect(payload.yjsState.data).toEqual([...post.yjsState]);
        else expect(payload).not.toHaveProperty('yjsState');
        if (submission) {
          expect(payload.submittedVersionId).toBe(version.id);
          expect(payload.submittedVersion.markdownSnapshot).toBe(SUBMITTED);
          expect(Object.keys(payload.submittedVersion).sort()).toEqual(
            ['id', 'versionNumber', 'triggerReason', 'markdownSnapshot', 'createdAt'].sort());
        } else {
          expect(payload).not.toHaveProperty('submittedVersionId');
          expect(payload).not.toHaveProperty('submittedVersion');
          expect(response.body).not.toContain(SUBMITTED);
        }
        expect(response.body).not.toContain('STALE_CACHE');
        if (source !== 'working') expect(response.body).not.toContain(WORKING);
      }
    }
    const [unchanged] = await db.select().from(posts).where(eq(posts.id, post.id));
    expect(unchanged.workingMarkdown).toBe('STALE_CACHE');
    expect(unchanged.yjsState).toEqual(post.yjsState);
    expect(unchanged.updatedAt).toEqual(post.updatedAt);
  });

  it('keeps invitations post-specific and ordinary space grants out of invited-only drafts', async () => {
    const { post } = await fixture({ status: 'draft', visibility: 'invited_only', isPromoted: false, publishedMarkdown: null });
    for (const caller of ['spaceAuthor', 'spaceViewer', 'spaceReviewer', 'reader', 'unrelatedAuthor', 'moderator', 'reviewer'] as const) {
      const response = await read(post, caller);
      expect(response.statusCode, caller).toBe(403);
      expect(response.json()).not.toHaveProperty('post');
    }
    for (const caller of ['author', 'admin', 'editor', 'viewer', 'mixedModerator', 'maintainer', 'owner'] as const) {
      const response = await read(post, caller);
      expect(response.statusCode, caller).toBe(200);
      expect(response.json().post.derivedMarkdown).toBe(WORKING);
    }
    const otherId = randomUUID();
    await db.insert(posts).values({ id: otherId, slug: `other-${otherId}`, title: 'Other', authorId: ids.author,
      yjsState: bytea(state('OTHER_PRIVATE_BODY')), workingMarkdown: 'OTHER_PRIVATE_BODY' });
    const denied = await read({ id: otherId, slug: `other-${otherId}` }, 'viewer');
    expect(denied.statusCode).toBe(403);
    expect(denied.body).not.toContain('OTHER_PRIVATE_BODY');
  });

  it('preserves exact empty publications and submissions without working fallback', async () => {
    for (const status of ['draft', 'in_review', 'approved', 'published', 'archived'] as const) {
      const { post } = await fixture({ status, publishedMarkdown: '' }, '');
      const response = await read(post);
      expect(response.statusCode).toBe(200);
      expect(response.json().post.derivedMarkdown).toBe('');
      expect(response.json().post.contentSource).toBe('published');
      expect(response.body).not.toContain(WORKING);
      const review = await read(post, 'reviewer');
      expect(review.statusCode).toBe(200);
      expect(review.json().post.derivedMarkdown).toBe('');
      expect(review.json().post.contentSource).toBe(['in_review', 'approved'].includes(status) ? 'submitted' : 'published');
      if (!['in_review', 'approved'].includes(status)) expect(review.json().post).not.toHaveProperty('submittedVersion');
    }
  });

  it('selects complete persisted canonical Yjs (including empty), then legacy, then W-only cache', async () => {
    const partialDoc = new Y.Doc();
    const text = partialDoc.getText('unrelated');
    text.insert(0, 'base');
    const vector = Y.encodeStateVector(partialDoc);
    text.insert(4, 'dependent update');
    const incomplete = Buffer.from(Y.encodeStateAsUpdate(partialDoc, vector));
    partialDoc.destroy();
    const fixtures: Array<[Buffer, string | null, string | null]> = [
      [state('', 'prosemirror', 'LEGACY_MUST_NOT_WIN'), 'STALE_CACHE', ''],
      [state('LEGACY_BODY', 'default'), 'STALE_CACHE', 'LEGACY_BODY'],
      [Buffer.from([1]), 'CACHE_FALLBACK', 'CACHE_FALLBACK'],
      [incomplete, '', ''],
      [Buffer.from([1]), null, null],
      [incomplete, null, null],
    ];
    for (const [yjsState, workingMarkdown, expected] of fixtures) {
      const { post } = await fixture({ yjsState, workingMarkdown });
      for (const caller of ['author', 'viewer'] as const) {
        const response = await read(post, caller);
        expect(response.statusCode).toBe(expected === null ? 409 : 200);
        if (expected === null) expect(response.json()).not.toHaveProperty('post');
        else {
          expect(response.json().post.derivedMarkdown).toBe(expected);
          expect(response.json().post.workingMarkdown).toBe(expected);
        }
      }
      const publicRead = await read(post);
      expect(publicRead.json().post.derivedMarkdown).toBe(PUBLISHED);
      expect(publicRead.json().post).not.toHaveProperty('workingMarkdown');
    }
  });

  it('validates explicit pins against post and kind, never substitutes the latest submission', async () => {
    const other = await fixture({}, 'OTHER_POST_SUBMISSION');
    for (const pin of ['missing', 'absent', 'cross-post', 'wrong-kind'] as const) {
      const { post, version } = await fixture({ publishedMarkdown: null });
      const badId = pin === 'absent' ? null : pin === 'missing' ? randomUUID() : pin === 'cross-post' ? other.version.id : version.id;
      await db.update(posts).set({ submittedVersionId: badId }).where(eq(posts.id, post.id));
      if (pin === 'wrong-kind') await db.update(postVersions).set({ triggerReason: 'manual_save' }).where(eq(postVersions.id, version.id));
      for (const caller of ['reviewer', 'moderator'] as const) {
        const response = await read(post, caller, true);
        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({ error: 'Conflict', message: 'Post content unavailable' });
        if (badId) expect(response.body).not.toContain(badId);
      }
      for (const caller of ['author', 'mixedReviewer'] as const) {
        const response = await read(post, caller);
        expect(response.statusCode).toBe(200);
        expect(response.json().post.submittedVersionId).toBeNull();
        expect(response.json().post.submittedVersion).toBeNull();
        expect(response.json().post.derivedMarkdown).toBe(WORKING);
      }
      await db.update(posts).set({ publishedMarkdown: PUBLISHED }).where(eq(posts.id, post.id));
      const fallback = await read(post, 'reviewer');
      expect(fallback.statusCode).toBe(200);
      expect(fallback.json().post.derivedMarkdown).toBe(PUBLISHED);
      expect(fallback.body).not.toContain('OTHER_POST_SUBMISSION');
    }
  });

  it('fails closed for absent publication, missing posts, invalid sessions and provenance query failures', async () => {
    const { post } = await fixture({ status: 'published', publishedMarkdown: null });
    expect((await read(post)).statusCode).toBe(409);
    expect((await read({ id: randomUUID(), slug: 'missing' })).statusCode).toBe(404);
    const invalidCookie = await app.inject({ method: 'GET', url: `/api/v1/posts/${post.id}`,
      headers: { cookie: 'blogger_session=invalid' } });
    expect(invalidCookie.statusCode).toBe(409); // Existing public auth plugin treats invalid sessions as anonymous.
    await read(post, 'viewer'); // Cache login before failing database provenance reads.
    const original = pool.query.bind(pool);
    const query = vi.spyOn(pool, 'query').mockImplementation((...args: any[]) => {
      const text = typeof args[0] === 'string' ? args[0] : args[0]?.text;
      if (text?.includes('post_collaborators')) return Promise.reject(new Error('provenance unavailable'));
      return original(...args);
    });
    try {
      const response = await read(post, 'viewer');
      expect(response.statusCode).toBe(500);
      expect(response.json()).not.toHaveProperty('post');
      expect(response.body).not.toContain(WORKING);
    } finally { query.mockRestore(); }
  });
});
