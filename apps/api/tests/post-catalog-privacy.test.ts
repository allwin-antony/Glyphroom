import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { createApiApp } from '../src/app.js';
import { users, spaces, spaceMembers, posts, postVersions, postCollaborators, tags, postTags } from '../src/db/schema.js';
import type { Database } from '../src/db/index.js';

const WORKING = 'privateworkneedle';
const SUBMITTED = 'reviewonlyneedle';
const PUBLISHED = 'publicbodyneedle';
const PASSWORD = 'CatalogPrivacy2026!';
const callers = {
  author: 'author', admin: 'admin', viewer: 'reader', reviewer: 'reader', reader: 'reader',
  moderator: 'moderator', spaceviewer: 'reader', spacereviewer: 'reader', spaceauthor: 'reader',
  maintainer: 'reader', mixed: 'moderator',
} as const;
type Caller = keyof typeof callers;

describe('catalog and search content privacy', () => {
  let db: Database;
  let app: Awaited<ReturnType<typeof createApiApp>>['app'];
  let close: () => Promise<void>;
  const userIds = Object.fromEntries(Object.keys(callers).map((key) => [key, randomUUID()])) as Record<Caller, string>;
  const cookies = new Map<Caller, string>();
  const spaceId = randomUUID();

  beforeAll(async () => {
    db = createInMemoryDatabase().db;
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    await db.insert(users).values(Object.entries(callers).map(([name, role]) => ({
      id: userIds[name as Caller], email: `${name}@catalog.example.com`, fullName: name, role,
      ssoProvider: 'local', passwordHash, isActive: true,
    })));
    await db.insert(spaces).values({ id: spaceId, slug: 'catalog-privacy', name: 'Catalog privacy' });
    await db.insert(spaceMembers).values([
      { spaceId, userId: userIds.spaceviewer, role: 'viewer' },
      { spaceId, userId: userIds.spacereviewer, role: 'reviewer' },
      { spaceId, userId: userIds.spaceauthor, role: 'author' },
      { spaceId, userId: userIds.maintainer, role: 'maintainer' },
    ]);
    const instance = await createApiApp({ db, sessionSecret: 'catalog-privacy-secret-32-characters' });
    app = instance.app;
    close = instance.close;
    await app.ready();
  });
  afterAll(async () => { await close?.(); });

  async function catalog(caller?: Caller, query = '') {
    if (caller && !cookies.has(caller)) {
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: {
        email: `${caller}@catalog.example.com`, password: PASSWORD,
      } });
      expect(login.statusCode).toBe(200);
      cookies.set(caller, login.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '));
    }
    const response = await app.inject({ method: 'GET', url: `/api/v1/posts${query ? `?${query}` : ''}`,
      headers: caller ? { cookie: cookies.get(caller)! } : undefined });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }

  async function fixture(overrides: Partial<typeof posts.$inferInsert> = {}) {
    const id = randomUUID();
    const [post] = await db.insert(posts).values({ id, slug: `catalog-${id}`, title: `Catalog ${id}`,
      authorId: userIds.author, spaceId, status: 'in_review', isPromoted: true, visibility: 'space',
      yjsState: Buffer.from([0, 0]), workingMarkdown: WORKING, publishedMarkdown: PUBLISHED, ...overrides,
    }).returning();
    const [version] = await db.insert(postVersions).values({ postId: id, versionNumber: 1,
      triggerReason: 'review_submission', yjsStateSnapshot: Buffer.from([0, 0]),
      markdownSnapshot: SUBMITTED, createdBy: userIds.author,
    }).returning();
    await db.update(posts).set({ submittedVersionId: version.id }).where(eq(posts.id, id));
    await db.insert(postCollaborators).values([
      { postId: id, userId: userIds.viewer, permission: 'view' },
      { postId: id, userId: userIds.reviewer, permission: 'review' },
      { postId: id, userId: userIds.mixed, permission: 'view' },
    ]);
    return { post, version };
  }

  it('returns metadata-only rows and searches only the source allowed by accumulated grants', async () => {
    const { post } = await fixture();
    const cases: Array<[Caller | undefined, string, string]> = [
      [undefined, 'published', PUBLISHED], ['reader', 'published', PUBLISHED],
      ['author', 'working', WORKING], ['admin', 'working', WORKING], ['viewer', 'working', WORKING],
      ['spaceviewer', 'working', WORKING], ['spaceauthor', 'working', WORKING], ['maintainer', 'working', WORKING],
      ['mixed', 'working', WORKING], ['reviewer', 'submitted', SUBMITTED],
      ['spacereviewer', 'submitted', SUBMITTED], ['moderator', 'submitted', SUBMITTED],
    ];
    for (const [caller, source, needle] of cases) {
      const all = await catalog(caller);
      const row = all.posts.find((item: any) => item.id === post.id);
      expect(row, caller ?? 'anonymous').toBeDefined();
      expect(row.contentSource).toBe(source);
      for (const key of ['workingMarkdown', 'publishedMarkdown', 'yjsState', 'submittedVersionId', 'submittedVersion', 'derivedMarkdown']) {
        expect(row).not.toHaveProperty(key);
      }
      for (const search of [WORKING, SUBMITTED, PUBLISHED]) {
        const found = await catalog(caller, `search=${search}`);
        expect(found.pagination.total, `${caller ?? 'anonymous'} ${search}`).toBe(search === needle ? 1 : 0);
        expect(found.posts.map((item: any) => item.id)).toEqual(search === needle ? [post.id] : []);
      }
    }

    const [tag] = await db.insert(tags).values({ name: 'privacy-d2', slug: 'privacy-d2' }).returning();
    await db.insert(postTags).values({ postId: post.id, tagId: tag.id });
    for (const [caller, needle] of [[undefined, PUBLISHED], ['author', WORKING], ['reviewer', SUBMITTED]] as const) {
      const query = new URLSearchParams({ search: needle, tags: 'PRIVACY-D2' });
      query.append('status', 'approved');
      query.append('status', 'in_review');
      const combined = await catalog(caller, query.toString());
      expect(combined.pagination.total).toBe(1);
      expect(combined.posts.map((item: any) => item.id)).toEqual([post.id]);
    }
  });

  it('does not expose hidden matches through counts, pagination, or wildcard probing', async () => {
    for (let index = 0; index < 4; index++) {
      await fixture({ title: `Paged ${index}`, status: 'published', workingMarkdown: `classifiedneedle ${index}`,
        publishedMarkdown: `allowedneedle ${index}` });
    }
    const hidden = await catalog(undefined, 'search=classifiedneedle&limit=1&page=2');
    expect(hidden.posts).toEqual([]);
    expect(hidden.pagination).toEqual({ page: 2, limit: 1, total: 0, totalPages: 0, hasNextPage: false });
    const visible = await catalog(undefined, 'search=allowedneedle&limit=2&page=2&sort=title');
    expect(visible.posts.map((post: any) => post.title)).toEqual(['Paged 2', 'Paged 3']);
    expect(visible.pagination).toMatchObject({ total: 4, totalPages: 2, hasNextPage: false });
    for (const term of ['%', '_', '\\']) {
      const escaped = await catalog(undefined, `search=${encodeURIComponent(term)}`);
      expect(escaped.pagination.total).toBe(0);
    }
  });

  it('retains empty prior publications through revisions and excludes publication-less rows', async () => {
    const retained: string[] = [];
    for (const status of ['draft', 'in_review', 'approved', 'published', 'archived'] as const) {
      const { post } = await fixture({ status, publishedMarkdown: '', title: `Empty publication ${status}` });
      retained.push(post.id);
    }
    const absent = await fixture({ status: 'published', publishedMarkdown: null, title: 'Empty publication absent' });
    const result = await catalog(undefined, 'search=Empty%20publication');
    expect(result.pagination.total).toBe(5);
    expect(result.posts.map((post: any) => post.id).sort()).toEqual(retained.sort());
    expect(result.posts.find((post: any) => post.id === absent.post.id)).toBeUndefined();
  });

  it('constrains invited-only grants and validates pins before review search or admission', async () => {
    const { post, version } = await fixture({ visibility: 'invited_only', isPromoted: false, publishedMarkdown: null,
      title: 'Invited needle', workingMarkdown: 'invitedworkneedle' });
    for (const caller of [undefined, 'reader', 'spaceviewer', 'spacereviewer', 'spaceauthor'] as const) {
      expect((await catalog(caller, 'search=Invited%20needle')).pagination.total).toBe(0);
    }
    for (const caller of ['author', 'admin', 'viewer', 'maintainer', 'moderator', 'reviewer'] as const) {
      expect((await catalog(caller, 'search=Invited%20needle')).pagination.total).toBe(1);
    }
    const other = await fixture({ title: 'Other pin post' });
    for (const pin of [null, randomUUID(), other.version.id, version.id]) {
      if (pin === version.id) await db.update(postVersions).set({ triggerReason: 'manual_save' }).where(eq(postVersions.id, version.id));
      await db.update(posts).set({ submittedVersionId: pin }).where(eq(posts.id, post.id));
      expect((await catalog('reviewer', 'search=Invited%20needle')).pagination.total).toBe(0);
      expect((await catalog('viewer', 'search=invitedworkneedle')).pagination.total).toBe(1);
    }
    await db.update(posts).set({ status: 'draft', submittedVersionId: version.id }).where(eq(posts.id, post.id));
    expect((await catalog('reviewer', 'search=Invited%20needle')).pagination.total).toBe(0);
    await db.update(posts).set({ publishedMarkdown: 'previouspublicationneedle', status: 'archived' }).where(eq(posts.id, post.id));
    expect((await catalog('moderator', 'search=previouspublicationneedle')).pagination.total).toBe(1);
    expect((await catalog(undefined, 'search=previouspublicationneedle')).pagination.total).toBe(0);
  });
});
