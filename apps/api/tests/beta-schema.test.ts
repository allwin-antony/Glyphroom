import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureDatabaseSchema } from '../src/db/auto-migrate.js';
import type { Database } from '../src/db/index.js';
import { postAttachments, posts, users } from '../src/db/schema.js';
import { createInMemoryDatabase } from './helpers/test-db.js';

function extractYamlBlock(document: string, header: string): string {
  const lines = document.split(/\r?\n/);
  const start = lines.indexOf(header);
  if (start === -1) {
    throw new Error(`Missing YAML block: ${header.trim()}`);
  }

  const indentation = header.length - header.trimStart().length;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end]!;
    const lineIndentation = line.length - line.trimStart().length;
    if (line.trim().length > 0 && lineIndentation <= indentation) {
      break;
    }
    end += 1;
  }

  return lines.slice(start, end).join('\n');
}

describe('beta database initialization', () => {
  const pools: Array<{ end: () => Promise<void> }> = [];

  function createDatabase() {
    const fixture = createInMemoryDatabase();
    pools.push(fixture.pool);
    return fixture;
  }

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.end()));
  });

  it('runs the additive migration without changing standalone audience state', async () => {
    const { db, pgMem } = createDatabase();
    const [author] = await db
      .insert(users)
      .values({
        email: 'schema.author@example.test',
        fullName: 'Schema Author',
        role: 'author',
        isActive: true,
      })
      .returning();
    const reviewPostId = crypto.randomUUID();
    const publishedPostId = crypto.randomUUID();
    await db.insert(posts).values([
      {
        id: reviewPostId,
        slug: 'standalone-review',
        title: 'Standalone review',
        status: 'in_review',
        authorId: author.id,
        spaceId: null,
        isPromoted: false,
        yjsState: Buffer.from([1]),
      },
      {
        id: publishedPostId,
        slug: 'standalone-published',
        title: 'Standalone published',
        status: 'published',
        authorId: author.id,
        spaceId: null,
        isPromoted: false,
        yjsState: Buffer.from([2]),
      },
    ]);

    // The shared pg-mem fixture stores UUID-shaped IDs as text, while this migration
    // correctly creates UUID foreign keys. Align its parent-key metadata for this test.
    const uuidType = pgMem.public.getType('uuid');
    pgMem.public.getTable('users').getColumn('id').type = uuidType;
    pgMem.public.getTable('posts').getColumn('id').type = uuidType;

    // Simulate an installation created before the runtime attachment table existed.
    // pg-mem keeps the generated primary-key relation unless its constraint is removed first.
    pgMem.public.none(`
      ALTER TABLE post_attachments DROP CONSTRAINT post_attachments_pkey;
      DROP TABLE post_attachments;
    `);
    // pg-mem reports unconsumed CREATE TABLE IF NOT EXISTS AST nodes for tables
    // that already exist; PostgreSQL treats those statements as no-ops.
    pgMem.options.noAstCoverageCheck = true;
    await ensureDatabaseSchema(db);

    const audienceRows = await db
      .select({ id: posts.id, spaceId: posts.spaceId, isPromoted: posts.isPromoted })
      .from(posts);
    expect(audienceRows).toEqual(
      expect.arrayContaining([
        { id: reviewPostId, spaceId: null, isPromoted: false },
        { id: publishedPostId, spaceId: null, isPromoted: false },
      ]),
    );

    const attachmentId = crypto.randomUUID();
    await db.insert(postAttachments).values({
      id: attachmentId,
      postId: reviewPostId,
      fileName: 'review.pdf',
      fileSize: 4096,
      mimeType: 'application/pdf',
      sha256: 'a'.repeat(64),
      storagePath: '/var/lib/glyphroom/attachments/review.pdf',
      scanStatus: 'clean',
      uploadedBy: author.id,
    });

    await expect(
      db.select().from(postAttachments).where(eq(postAttachments.id, attachmentId)),
    ).resolves.toMatchObject([
      {
        id: attachmentId,
        postId: reviewPostId,
        fileName: 'review.pdf',
        fileSize: 4096,
        mimeType: 'application/pdf',
        sha256: 'a'.repeat(64),
        storagePath: '/var/lib/glyphroom/attachments/review.pdf',
        scanStatus: 'clean',
        uploadedBy: author.id,
      },
    ]);
  });

  it('propagates migration failures to startup', async () => {
    const migrationError = new Error('permission denied for schema public');
    const transaction = vi.fn().mockRejectedValue(migrationError);
    const db = { transaction } as unknown as Database;

    await expect(ensureDatabaseSchema(db)).rejects.toBe(migrationError);
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('keeps the container initializer free of seeded credentials and declares the runtime attachment schema', () => {
    const initSqlPath = fileURLToPath(new URL('../../../docker/postgres/init.sql', import.meta.url));
    const initSql = fs.readFileSync(initSqlPath, 'utf8');

    expect(initSql).not.toMatch(/INSERT\s+INTO\s+users/i);
    expect(initSql).not.toContain('admin@blogger.corp.internal');
    expect(initSql).not.toContain('admin@glyphroom.local');
    expect(initSql).not.toContain('$2a$10$wYNBVWEHmj6BkDKsMjwwEuAfvPY2WS7ausLRXg613Nnls10A3/8Re');
    expect(initSql).toMatch(/submitted_version_id\s+UUID/i);
    expect(initSql).toMatch(/CREATE TABLE IF NOT EXISTS post_attachments/i);
    expect(initSql).toMatch(/file_name\s+VARCHAR\(255\)\s+NOT NULL/i);
    expect(initSql).toMatch(/storage_path\s+TEXT\s+NOT NULL/i);
  });

  it('forwards optional bootstrap credentials only to the API service', () => {
    const composePath = fileURLToPath(new URL('../../../docker-compose.prod.yml', import.meta.url));
    const compose = fs.readFileSync(composePath, 'utf8');
    const services = extractYamlBlock(compose, 'services:');
    const apiService = extractYamlBlock(services, '  api:');
    const apiEnvironment = extractYamlBlock(apiService, '    environment:');
    const bootstrapMappings = apiEnvironment
      .split(/\r?\n/)
      .filter((line) => /^\s+BOOTSTRAP_ADMIN_(?:EMAIL|PASSWORD):/.test(line));

    expect(bootstrapMappings).toEqual([
      '      BOOTSTRAP_ADMIN_EMAIL: ${BOOTSTRAP_ADMIN_EMAIL:-}',
      '      BOOTSTRAP_ADMIN_PASSWORD: ${BOOTSTRAP_ADMIN_PASSWORD:-}',
    ]);
    expect(bootstrapMappings.every((mapping) => mapping.endsWith(':-}'))).toBe(true);
    expect(services.replace(apiService, '')).not.toMatch(/BOOTSTRAP_ADMIN_(?:EMAIL|PASSWORD)/);
  });
});
