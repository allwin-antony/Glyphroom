import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { createApiApp } from '../src/app.js';
import { users, posts } from '../src/db/schema.js';
import type { Database } from '../src/db/index.js';
import * as Y from 'yjs';

function buildMultipartPayload(filename: string, contentType: string, fileBuffer: Buffer) {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const payload = Buffer.concat([header, fileBuffer, footer]);

  return {
    boundary,
    contentType: `multipart/form-data; boundary=${boundary}`,
    payload,
  };
}

describe('Attachment Upload & Magic-Byte Security Suite', () => {
  let db: Database;
  let app: any;
  let close: () => Promise<void>;
  let authorUserId: string;
  let testPostId: string;
  let authorSessionCookie: string;
  let authorCsrfToken: string;

  beforeEach(async () => {
    const mem = createInMemoryDatabase();
    db = mem.db;

    const passwordHash = await bcrypt.hash('AuthorPass123!', 10);
    const [author] = await db
      .insert(users)
      .values({
        email: 'author@enterprise.local',
        fullName: 'Jane Author',
        role: 'author',
        ssoProvider: 'local',
        passwordHash,
        isActive: true,
      })
      .returning();
    authorUserId = author.id;

    const ydoc = new Y.Doc();
    const [post] = await db
      .insert(posts)
      .values({
        title: 'Project Architecture Post',
        slug: 'project-architecture-post',
        authorId: authorUserId,
        status: 'draft',
        yjsState: Buffer.from(Y.encodeStateAsUpdate(ydoc)),
      })
      .returning();
    testPostId = post.id;

    const serverInstance = await createApiApp({ db });
    app = serverInstance.app;
    close = serverInstance.close;

    // Login as author
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'author@enterprise.local',
        password: 'AuthorPass123!',
      },
    });

    authorSessionCookie = loginRes.cookies.find((c: any) => c.name === 'blogger_session')?.value;
    authorCsrfToken = loginRes.json().csrfToken;
  });

  afterEach(async () => {
    await close();
  });

  it('accepts valid PNG image upload with genuine magic bytes', async () => {
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    const pngMagicBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    ]);

    const { contentType, payload } = buildMultipartPayload(
      'architecture-diagram.png',
      'image/png',
      pngMagicBuffer
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${testPostId}/attachments`,
      headers: {
        'content-type': contentType,
        cookie: `blogger_session=${authorSessionCookie}`,
        'x-csrf-token': authorCsrfToken,
      },
      payload,
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.attachmentId).toBeDefined();
    expect(body.fileName).toBe('architecture-diagram.png');
    expect(body.mimeType).toBe('image/png');
    expect(body.scanStatus).toBe('clean');
    expect(body.url).toContain(`/api/v1/attachments/${body.attachmentId}`);

    // Verify retrieval
    const getRes = await app.inject({
      method: 'GET',
      url: body.url,
      headers: {
        cookie: `blogger_session=${authorSessionCookie}`,
      },
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.headers['content-type']).toBe('image/png');
    expect(getRes.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects executable / malicious file with spoofed extension by magic-byte check', async () => {
    // Fake PNG extension but binary has Windows MZ executable magic bytes
    const maliciousBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

    const { contentType, payload } = buildMultipartPayload(
      'malicious-script.png',
      'image/png',
      maliciousBuffer
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${testPostId}/attachments`,
      headers: {
        'content-type': contentType,
        cookie: `blogger_session=${authorSessionCookie}`,
        'x-csrf-token': authorCsrfToken,
      },
      payload,
    });

    expect(res.statusCode).toBe(415);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Unsupported Media Type');
  });

  it('enforces RBAC: rejects upload from unauthorized unauthenticated users', async () => {
    const pngMagicBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const { contentType, payload } = buildMultipartPayload('diagram.png', 'image/png', pngMagicBuffer);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${testPostId}/attachments`,
      headers: {
        'content-type': contentType,
      },
      payload,
    });

    expect(res.statusCode).toBe(401);
  });
});
