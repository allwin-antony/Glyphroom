import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { createApiApp } from '../src/app.js';
import { posts, users } from '../src/db/schema.js';
import type { Database } from '../src/db/index.js';

describe('personal bookmarks', () => {
  let db: Database;
  let app: any;
  let close: () => Promise<void>;
  let postId: string;
  let session = '';
  let csrf = '';

  beforeEach(async () => {
    const mem = createInMemoryDatabase();
    db = mem.db;
    const [author] = await db.insert(users).values({
      email: 'author@example.com', fullName: 'Author', role: 'author', isActive: true,
    }).returning();
    const [post] = await db.insert(posts).values({
      title: 'Readable handbook', slug: 'readable-handbook', status: 'published', authorId: author.id,
      yjsState: Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())), publishedMarkdown: '# Handbook',
    }).returning();
    postId = post.id;

    const instance = await createApiApp({ db, sessionSecret: 'test-session-secret-at-least-32-chars-long' });
    app = instance.app;
    close = instance.close;
    await app.ready();

    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/sso/callback',
      payload: { provider: 'oidc', sub: 'reader-sub', email: 'reader@example.com', name: 'Reader', roles: ['reader'] },
    });
    session = login.cookies.find((cookie: any) => cookie.name === 'blogger_session')?.value;
    csrf = login.json().csrfToken;
  });

  afterEach(async () => close?.());

  const authHeaders = () => ({ cookie: `blogger_session=${session}`, 'x-csrf-token': csrf });

  it('creates, lists, updates, and removes a bookmark for the current user', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/v1/bookmarks', headers: authHeaders(), payload: { postId, note: 'Read this next' } });
    expect(create.statusCode).toBe(201);
    expect(create.json().bookmark.note).toBe('Read this next');

    const list = await app.inject({ method: 'GET', url: '/api/v1/bookmarks', headers: authHeaders() });
    expect(list.statusCode).toBe(200);
    expect(list.json().bookmarks).toHaveLength(1);
    expect(list.json().bookmarks[0].post.id).toBe(postId);

    const update = await app.inject({ method: 'POST', url: '/api/v1/bookmarks', headers: authHeaders(), payload: { postId, note: 'Updated note' } });
    expect(update.statusCode).toBe(201);
    expect(update.json().bookmark.note).toBe('Updated note');

    const remove = await app.inject({ method: 'DELETE', url: `/api/v1/bookmarks/${postId}`, headers: authHeaders() });
    expect(remove.statusCode).toBe(204);
    const empty = await app.inject({ method: 'GET', url: '/api/v1/bookmarks', headers: authHeaders() });
    expect(empty.json().bookmarks).toHaveLength(0);
  });

  it('rejects bookmarking a post the current user cannot view', async () => {
    await db.update(posts).set({ status: 'draft' });
    const response = await app.inject({ method: 'POST', url: '/api/v1/bookmarks', headers: authHeaders(), payload: { postId } });
    expect(response.statusCode).toBe(403);
  });
});
