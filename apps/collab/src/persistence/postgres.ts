import pg from 'pg';
import type * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { exportDerivedMarkdown } from '@glyphroom/shared';
import type { DocumentPersistenceAdapter } from './adapter.js';
import { randomUUID } from 'node:crypto';

export interface PostgresPersistenceOptions {
  pool?: pg.Pool;
  connectionString?: string;
  tableName?: string; // default: 'posts'
  defaultAuthorId?: string; // default: '00000000-0000-0000-0000-000000000001'
  allowAutoInsert?: boolean; // default: false in prod, true in test
}

/**
 * PostgreSQL persistence adapter storing canonical Yjs binary state in bytea column.
 * Conforms to docs/DATA_MODEL.md (table: posts, column: yjs_state).
 * Automatically extracts derived ProseMirror JSON and caches working_markdown.
 */
export class PostgresPersistenceAdapter implements DocumentPersistenceAdapter {
  private readonly pool: pg.Pool;
  private readonly ownsPool: boolean;
  private readonly tableName: string;
  private readonly defaultAuthorId: string;
  private readonly allowAutoInsert: boolean;
  private readonly tombstones: Set<string> = new Set<string>();
  private readonly pendingStores = new Map<string, Promise<void>>();

  constructor(options: PostgresPersistenceOptions = {}) {
    this.tableName = options.tableName || 'posts';
    this.defaultAuthorId = options.defaultAuthorId || '00000000-0000-0000-0000-000000000001';
    this.allowAutoInsert =
      options.allowAutoInsert ??
      (process.env.NODE_ENV === 'test' || process.env.VITEST !== undefined);

    if (options.pool) {
      this.pool = options.pool;
      this.ownsPool = false;
    } else {
      this.pool = new pg.Pool({
        connectionString:
          options.connectionString ||
          process.env.DATABASE_URL ||
          'postgres://blogger:REPLACE_WITH_STRONG_PASSWORD_IN_PROD@localhost:5432/glyphroom',
        max: 20,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 5000,
      });
      this.ownsPool = true;
    }
  }

  public getPool(): pg.Pool {
    return this.pool;
  }

  public async tombstone(documentName: string): Promise<void> {
    const id = this.normalizeDocId(documentName);
    this.tombstones.add(id);
    this.tombstones.add(documentName);
    this.tombstones.add(`post-${id}`);
    await this.pendingStores.get(id);
  }

  private normalizeDocId(documentName: string): string {
    return documentName.startsWith('post-') ? documentName.slice(5) : documentName;
  }

  async fetch(documentName: string): Promise<Uint8Array | null> {
    const id = this.normalizeDocId(documentName);
    if (this.tombstones.has(id)) return null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const query = isUuid
      ? `
        SELECT yjs_state
        FROM ${this.tableName}
        WHERE id = $1::uuid
        LIMIT 1
      `
      : `
        SELECT yjs_state
        FROM ${this.tableName}
        WHERE slug = $1 OR slug = $2
        LIMIT 1
      `;
    const result = await this.pool.query<{ yjs_state: Buffer | Uint8Array | null }>(query, isUuid ? [id] : [id, documentName]);

    if (result.rows.length === 0 || !result.rows[0].yjs_state) {
      return null;
    }

    const buf = result.rows[0].yjs_state;
    return new Uint8Array(buf);
  }

  async store(documentName: string, state: Uint8Array, doc?: Y.Doc): Promise<void> {
    const id = this.normalizeDocId(documentName);
    if (this.tombstones.has(id)) return;
    const previous = this.pendingStores.get(id) ?? Promise.resolve();
    // Capture the projection with the supplied state before waiting on I/O.
    const fragmentName = doc?.share.has('prosemirror') ? 'prosemirror' : doc?.share.has('default') ? 'default' : 'prosemirror';
    const workingMarkdown = doc ? exportDerivedMarkdown(yDocToProsemirrorJSON(doc, fragmentName) as any) : null;
    const bytes = new Uint8Array(state);
    const store = previous.catch(() => { }).then(() => this.storeState(documentName, bytes, workingMarkdown));
    this.pendingStores.set(id, store);
    try {
      await store;
    } finally {
      if (this.pendingStores.get(id) === store) this.pendingStores.delete(id);
    }
  }

  private async storeState(documentName: string, state: Uint8Array, workingMarkdown: string | null): Promise<void> {
    const id = this.normalizeDocId(documentName);
    if (this.tombstones.has(id) || this.tombstones.has(documentName) || this.tombstones.has(`post-${id}`)) {
      return;
    }
    const hex = Buffer.from(state).toString('hex');

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    // 1. Try to update existing record matching id or slug
    const updateSql = isUuid
      ? `
        UPDATE ${this.tableName}
        SET yjs_state = decode($1, 'hex'),
            working_markdown = COALESCE($2, working_markdown),
            updated_at = NOW()
        WHERE id = $3::uuid
      `
      : `
        UPDATE ${this.tableName}
        SET yjs_state = decode($1, 'hex'),
            working_markdown = COALESCE($2, working_markdown),
            updated_at = NOW()
        WHERE slug = $3 OR slug = $4
      `;
    const updateRes = await this.pool.query(updateSql, isUuid ? [hex, workingMarkdown, id] : [hex, workingMarkdown, id, documentName]);
    if (this.tombstones.has(id)) return;
    if (updateRes.rowCount === 0 && !this.allowAutoInsert) {
      throw new Error('Document persistence target does not exist');
    }

    // 2. Only auto-insert for development/test seeding if explicitly allowed;
    // in normal operation, prevents recreating deleted posts from delayed flush.
    if (updateRes.rowCount === 0 && this.allowAutoInsert) {
      const rowId = isUuid ? id : randomUUID();

      try {
        const insertSql = `
          INSERT INTO ${this.tableName} (id, slug, title, author_id, yjs_state, working_markdown, updated_at)
          VALUES ($1, $2, 'Untitled Document', $3, decode($4, 'hex'), $5, NOW())
          ON CONFLICT (id) DO UPDATE SET
            yjs_state = EXCLUDED.yjs_state,
            working_markdown = COALESCE(EXCLUDED.working_markdown, ${this.tableName}.working_markdown),
            updated_at = NOW()
        `;
        await this.pool.query(insertSql, [rowId, documentName, this.defaultAuthorId, hex, workingMarkdown]);
      } catch {
        // Fallback for minimal schemas lacking author_id foreign key
        const fallbackSql = `
          INSERT INTO ${this.tableName} (id, slug, title, yjs_state, working_markdown, updated_at)
          VALUES ($1, $2, 'Untitled Document', decode($3, 'hex'), $4, NOW())
          ON CONFLICT (id) DO UPDATE SET
            yjs_state = EXCLUDED.yjs_state,
            working_markdown = COALESCE(EXCLUDED.working_markdown, ${this.tableName}.working_markdown),
            updated_at = NOW()
        `;
        await this.pool.query(fallbackSql, [rowId, documentName, hex, workingMarkdown]);
      }
    }
  }

  async destroy(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end();
    }
  }
}
