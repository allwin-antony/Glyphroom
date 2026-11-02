import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { newDb } from 'pg-mem';
import { InMemoryPersistenceAdapter } from '../src/persistence/in-memory.js';
import { PostgresPersistenceAdapter } from '../src/persistence/postgres.js';

describe('Persistence Adapters Suite', () => {
  describe('InMemoryPersistenceAdapter', () => {
    let adapter: InMemoryPersistenceAdapter;

    beforeEach(() => {
      adapter = new InMemoryPersistenceAdapter();
    });

    afterEach(async () => {
      await adapter.destroy();
    });

    it('returns null when document does not exist', async () => {
      const data = await adapter.fetch('non-existent-doc');
      expect(data).toBeNull();
    });

    it('stores and retrieves binary updates with byte-level fidelity', async () => {
      const doc = new Y.Doc();
      const text = doc.getText('content');
      text.insert(0, 'Hello In-Memory Persistence');
      const update = Y.encodeStateAsUpdate(doc);

      await adapter.store('test-doc-1', update);

      const fetched = await adapter.fetch('test-doc-1');
      expect(fetched).not.toBeNull();
      expect(fetched).toEqual(update);

      // Verify that decoding retrieved update recovers document content
      const recoveredDoc = new Y.Doc();
      Y.applyUpdate(recoveredDoc, fetched!);
      expect(recoveredDoc.getText('content').toString()).toBe('Hello In-Memory Persistence');
    });

    it('guarantees copy-on-write isolation (mutating fetched buffer does not corrupt store)', async () => {
      const state = new Uint8Array([1, 2, 3, 4, 5]);
      await adapter.store('doc-cow', state);

      const fetched = await adapter.fetch('doc-cow');
      expect(fetched).toEqual(state);

      // Mutate the returned array
      fetched![0] = 99;

      const refetched = await adapter.fetch('doc-cow');
      expect(refetched![0]).toBe(1); // Original value maintained
    });

    it('supports helper methods: has, get, size, clear', async () => {
      expect(adapter.size()).toBe(0);
      expect(adapter.has('doc-a')).toBe(false);

      const update = new Uint8Array([10, 20, 30]);
      await adapter.store('doc-a', update);

      expect(adapter.size()).toBe(1);
      expect(adapter.has('doc-a')).toBe(true);
      expect(adapter.get('doc-a')).toEqual(update);

      adapter.clear();
      expect(adapter.size()).toBe(0);
      expect(adapter.has('doc-a')).toBe(false);
    });

    it('awaits tombstoning and prevents delayed stores from recreating canonical state', async () => {
      const doc = new Y.Doc();
      doc.getText('content').insert(0, 'Durable state');
      const state = Y.encodeStateAsUpdate(doc);
      await adapter.store('post-deleted', state);
      await adapter.tombstone('post-deleted');
      await adapter.store('post-deleted', state);
      expect(await adapter.fetch('post-deleted')).toBeNull();
    });
  });

  describe('PostgresPersistenceAdapter (pg-mem PostgreSQL emulation)', () => {
    let adapter: PostgresPersistenceAdapter;
    let pool: any;

    beforeEach(async () => {
      const db = newDb();

      // Register UUID and decode functions for pg-mem
      db.public.registerFunction({
        name: 'gen_random_uuid',
        returns: db.public.getType('uuid' as any) || db.public.getType('text' as any),
        implementation: () => '11111111-1111-1111-1111-111111111111',
      });

      db.public.registerFunction({
        name: 'decode',
        args: [db.public.getType('text'), db.public.getType('text')],
        returns: db.public.getType('bytea'),
        implementation: (hexStr: string) => Buffer.from(hexStr, 'hex'),
      });

      // Emulate PostgreSQL posts and users tables
      db.public.none(`
        CREATE TABLE users (
          id text PRIMARY KEY,
          email text UNIQUE NOT NULL,
          full_name text NOT NULL,
          role text NOT NULL
        );

        INSERT INTO users (id, email, full_name, role)
        VALUES ('00000000-0000-0000-0000-000000000001', 'admin@blogger.corp.internal', 'System Administrator', 'admin');

        CREATE TABLE posts (
          id text PRIMARY KEY,
          slug text UNIQUE NOT NULL,
          title text NOT NULL,
          author_id text,
          yjs_state bytea NOT NULL,
          working_markdown text,
          updated_at timestamp NOT NULL DEFAULT NOW()
        );
      `);

      pool = new (db.adapters.createPg().Pool)();
      adapter = new PostgresPersistenceAdapter({ pool, tableName: 'posts' });
    });

    afterEach(async () => {
      await adapter.destroy();
    });

    it('returns null for non-existent documents in PostgreSQL', async () => {
      const data = await adapter.fetch('non-existent-pg-doc');
      expect(data).toBeNull();
    });

    it('auto-inserts new document and retrieves binary update with full integrity', async () => {
      const doc = new Y.Doc();
      const text = doc.getText('content');
      text.insert(0, 'Postgres Persistence Working');
      const update = Y.encodeStateAsUpdate(doc);

      const docId = '12345678-1234-1234-1234-123456789abc';
      await adapter.store(docId, update);

      const fetched = await adapter.fetch(docId);
      expect(fetched).not.toBeNull();
      expect(fetched).toEqual(update);

      const recoveredDoc = new Y.Doc();
      Y.applyUpdate(recoveredDoc, fetched!);
      expect(recoveredDoc.getText('content').toString()).toBe('Postgres Persistence Working');
    });

    it('normalizes documentName with "post-" prefix', async () => {
      const doc = new Y.Doc();
      doc.getText('content').insert(0, 'Prefix Normalization Test');
      const update = Y.encodeStateAsUpdate(doc);

      const rawId = '87654321-4321-4321-4321-cba987654321';
      // Store using 'post-' prefix
      await adapter.store(`post-${rawId}`, update);

      // Fetch with and without 'post-' prefix
      const fetchedWithPrefix = await adapter.fetch(`post-${rawId}`);
      const fetchedWithoutPrefix = await adapter.fetch(rawId);

      expect(fetchedWithPrefix).not.toBeNull();
      expect(fetchedWithoutPrefix).not.toBeNull();
      expect(fetchedWithPrefix).toEqual(update);
      expect(fetchedWithoutPrefix).toEqual(update);
    });

    it('automatically extracts derived Markdown and caches in working_markdown', async () => {
      const doc = new Y.Doc();
      const xml = doc.getXmlFragment('prosemirror');
      
      // Populate Y.Doc with ProseMirror XML fragment representing a heading and paragraph
      const heading = new Y.XmlElement('heading');
      heading.setAttribute('level', 1 as any);
      const hText = new Y.XmlText();
      hText.insert(0, 'Architecture Deep Dive');
      heading.insert(0, [hText]);

      const paragraph = new Y.XmlElement('paragraph');
      const pText = new Y.XmlText();
      pText.insert(0, 'This is cached markdown derived on debounced flush.');
      paragraph.insert(0, [pText]);

      xml.insert(0, [heading, paragraph]);

      const update = Y.encodeStateAsUpdate(doc);
      const docId = '22222222-2222-2222-2222-222222222222';

      await adapter.store(docId, update, doc);

      // Query database directly to confirm working_markdown was populated
      const res = await pool.query('SELECT working_markdown FROM posts WHERE id = $1', [docId]);
      expect(res.rows.length).toBe(1);
      const markdown = res.rows[0].working_markdown;
      expect(markdown).toContain('# Architecture Deep Dive');
      expect(markdown).toContain('This is cached markdown derived on debounced flush.');
    });

    it('updates existing record on subsequent store calls', async () => {
      const docId = '33333333-3333-3333-3333-333333333333';
      const doc1 = new Y.Doc();
      doc1.getText('content').insert(0, 'Version 1');
      await adapter.store(docId, Y.encodeStateAsUpdate(doc1));

      const fetched1 = await adapter.fetch(docId);
      const recDoc1 = new Y.Doc();
      Y.applyUpdate(recDoc1, fetched1!);
      expect(recDoc1.getText('content').toString()).toBe('Version 1');

      // Update document to Version 2
      const doc2 = new Y.Doc();
      doc2.getText('content').insert(0, 'Version 2 with updates');
      await adapter.store(docId, Y.encodeStateAsUpdate(doc2));

      const fetched2 = await adapter.fetch(docId);
      const recDoc2 = new Y.Doc();
      Y.applyUpdate(recDoc2, fetched2!);
      expect(recDoc2.getText('content').toString()).toBe('Version 2 with updates');

      // Ensure row count is still 1
      const countRes = await pool.query('SELECT COUNT(*) as count FROM posts WHERE id = $1', [docId]);
      expect(Number(countRes.rows[0].count)).toBe(1);
    });

    it('projects an empty canonical prosemirror root rather than nonempty legacy default content', async () => {
      const doc = new Y.Doc();
      const legacy = new Y.XmlElement('paragraph');
      legacy.insert(0, [new Y.XmlText('Stale default')]);
      doc.getXmlFragment('default').insert(0, [legacy]);
      const current = new Y.XmlElement('paragraph');
      current.insert(0, [new Y.XmlText('Deleted current content')]);
      doc.getXmlFragment('prosemirror').insert(0, [current]);
      doc.getXmlFragment('prosemirror').delete(0, 1);
      const id = '44444444-4444-4444-4444-444444444444';
      await adapter.store(id, Y.encodeStateAsUpdate(doc), doc);
      const result = await pool.query('SELECT working_markdown FROM posts WHERE id = $1', [id]);
      expect(result.rows[0].working_markdown).toBe('');
    });

    it('rejects missing production rows instead of acknowledging a store that updated nothing', async () => {
      const production = new PostgresPersistenceAdapter({ pool, allowAutoInsert: false });
      const doc = new Y.Doc();
      doc.getText('content').insert(0, 'Must not auto-insert');
      await expect(production.store('55555555-5555-5555-5555-555555555555', Y.encodeStateAsUpdate(doc), doc)).rejects.toThrow('target does not exist');
      expect((await pool.query('SELECT COUNT(*) AS count FROM posts')).rows[0].count).toBe(0);
    });

    it('uses the canonical UUID identity instead of reading or updating another row with a matching slug', async () => {
      const first = '77777777-7777-7777-7777-777777777777';
      const second = '88888888-8888-8888-8888-888888888888';
      const own = new Y.Doc();
      own.getText('content').insert(0, 'Authorized row');
      const other = new Y.Doc();
      other.getText('content').insert(0, 'Other private row');
      await adapter.store(first, Y.encodeStateAsUpdate(own));
      await adapter.store(second, Y.encodeStateAsUpdate(other));
      await pool.query('UPDATE posts SET slug = $1 WHERE id = $2', ['authorized-row-slug', first]);
      await pool.query('UPDATE posts SET slug = $1 WHERE id = $2', [`post-${first}`, second]);
      expect(await adapter.fetch(`post-${first}`)).toEqual(Y.encodeStateAsUpdate(own));
      own.getText('content').insert(own.getText('content').length, ' updated');
      await adapter.store(`post-${first}`, Y.encodeStateAsUpdate(own));
      expect(await adapter.fetch(first)).toEqual(Y.encodeStateAsUpdate(own));
      expect(await adapter.fetch(second)).toEqual(Y.encodeStateAsUpdate(other));
    });

    it('awaits an already-running SQL store before tombstone acknowledgement, keeps the row, and prevents late writes', async () => {
      const id = '66666666-6666-6666-6666-666666666666';
      const doc = new Y.Doc();
      doc.getText('content').insert(0, 'Before barrier');
      await adapter.store(`post-${id}`, Y.encodeStateAsUpdate(doc), doc);
      let release!: () => void;
      let entered!: () => void;
      const pause = new Promise<void>((resolve) => { release = resolve; });
      const started = new Promise<void>((resolve) => { entered = resolve; });
      const query = pool.query.bind(pool);
      let writes = 0;
      pool.query = async (sql: string, values?: any[]) => {
        if (sql.includes('UPDATE posts')) { writes++; entered(); await pause; }
        return query(sql, values);
      };
      doc.getText('content').insert(doc.getText('content').length, ' plus pending store');
      const state = Y.encodeStateAsUpdate(doc);
      const storing = adapter.store(`post-${id}`, state, doc);
      await started;
      let acknowledged = false;
      const deleting = adapter.tombstone(id).then(() => { acknowledged = true; });
      expect(acknowledged).toBe(false);
      release();
      await storing;
      await deleting;
      expect(acknowledged).toBe(true);
      expect(await adapter.fetch(`post-${id}`)).toBeNull();
      await adapter.store(id, Y.encodeStateAsUpdate(new Y.Doc()));
      expect(writes).toBe(1);
      const row = await query('SELECT yjs_state FROM posts WHERE id = $1', [id]);
      expect(row.rows).toHaveLength(1); // API, not collab, owns final row deletion.
      expect(new Uint8Array(row.rows[0].yjs_state)).toEqual(state);
    });
  });
});
