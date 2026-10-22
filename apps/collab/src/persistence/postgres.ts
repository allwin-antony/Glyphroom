import pg from 'pg';
import type * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { exportDerivedMarkdown } from '@enterprise-blogger/shared';
import type { DocumentPersistenceAdapter } from './adapter.js';
import { randomUUID } from 'node:crypto';

export interface PostgresPersistenceOptions {
  pool?: pg.Pool;
  connectionString?: string;
  tableName?: string; // default: 'posts'
  defaultAuthorId?: string; // default: '00000000-0000-0000-0000-000000000001'
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

  constructor(options: PostgresPersistenceOptions = {}) {
    this.tableName = options.tableName || 'posts';
    this.defaultAuthorId = options.defaultAuthorId || '00000000-0000-0000-0000-000000000001';

    if (options.pool) {
      this.pool = options.pool;
      this.ownsPool = false;
    } else {
      this.pool = new pg.Pool({
        connectionString: options.connectionString || process.env.DATABASE_URL,
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

  private normalizeDocId(documentName: string): string {
    return documentName.startsWith('post-') ? documentName.slice(5) : documentName;
  }

  async fetch(documentName: string): Promise<Uint8Array | null> {
    const id = this.normalizeDocId(documentName);
    const query = `
      SELECT yjs_state
      FROM ${this.tableName}
      WHERE id::text = $1 OR slug = $1 OR slug = $2
      LIMIT 1
    `;
    const result = await this.pool.query<{ yjs_state: Buffer | Uint8Array | null }>(query, [id, documentName]);

    if (result.rows.length === 0 || !result.rows[0].yjs_state) {
      return null;
    }

    const buf = result.rows[0].yjs_state;
    if (Buffer.isBuffer(buf)) {
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    return new Uint8Array(buf);
  }

  async store(documentName: string, state: Uint8Array, doc?: Y.Doc): Promise<void> {
    const id = this.normalizeDocId(documentName);
    const hex = Buffer.from(state).toString('hex');

    let workingMarkdown: string | null = null;
    if (doc) {
      try {
        const fragmentName = doc.share.has('default') ? 'default' : 'prosemirror';
        const pmJson = yDocToProsemirrorJSON(doc, fragmentName);
        workingMarkdown = exportDerivedMarkdown(pmJson as any);
      } catch {
        workingMarkdown = null;
      }
    }

    // 1. Try to update existing record matching id or slug
    const updateSql = `
      UPDATE ${this.tableName}
      SET yjs_state = decode($1, 'hex'),
          working_markdown = COALESCE($2, working_markdown),
          updated_at = NOW()
      WHERE id::text = $3 OR slug = $3 OR slug = $4
    `;
    const updateRes = await this.pool.query(updateSql, [hex, workingMarkdown, id, documentName]);

    // 2. If no record was updated, auto-insert for development/test seeding
    if (updateRes.rowCount === 0) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
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
