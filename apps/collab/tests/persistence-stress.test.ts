import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { newDb } from 'pg-mem';
import { createCollabServer, type CollabServerInstance } from '../src/server.js';
import { InMemoryPersistenceAdapter } from '../src/persistence/in-memory.js';
import { PostgresPersistenceAdapter } from '../src/persistence/postgres.js';
import { exportDerivedMarkdown } from '@enterprise-blogger/shared';

// Helper to construct in-memory PostgreSQL database matching production schema
function createTestDb() {
  const db = newDb();

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

  return db;
}

describe('Adversarial Persistence & Durability Stress Suite (challenger_m3_2)', () => {
  let instance: CollabServerInstance | null = null;
  const providersToClean: HocuspocusProvider[] = [];

  const cleanupProviders = async () => {
    while (providersToClean.length > 0) {
      const p = providersToClean.pop();
      try {
        p?.destroy();
      } catch {
        // ignore
      }
    }
  };

  afterEach(async () => {
    await cleanupProviders();
    if (instance) {
      await instance.destroy();
      instance = null;
    }
  });

  // =========================================================================
  // Dimension 1: PostgreSQL Bytea Snapshot Fidelity Across Large Yjs Documents
  // =========================================================================
  describe('1. PostgreSQL Bytea Snapshot Fidelity Across Large Yjs Documents', () => {
    let pgAdapter: PostgresPersistenceAdapter;
    let pool: any;

    beforeEach(() => {
      const db = createTestDb();
      pool = new (db.adapters.createPg().Pool)();
      pgAdapter = new PostgresPersistenceAdapter({ pool, tableName: 'posts' });
    });

    afterEach(async () => {
      await pgAdapter.destroy();
    });

    it('stress tests binary snapshot round-tripping across massive Yjs documents (1,000+ operations, multi-node trees, nested structures, marks) with 0 byte corruption', async () => {
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('prosemirror');

      // 1. Build a massive document across 1,000+ discrete transactions and operations
      const totalOperations = 1200;
      const elementsCreated: string[] = [];

      doc.transact(() => {
        // H1 Title
        const h1 = new Y.XmlElement('heading');
        h1.setAttribute('level', 1 as any);
        const h1Text = new Y.XmlText();
        h1Text.insert(0, 'Enterprise Systems Architecture & Reliability Blueprint');
        h1.insert(0, [h1Text]);
        fragment.insert(0, [h1]);
        elementsCreated.push('h1');
      });

      // Iteratively apply 1,200 operations creating paragraphs, code blocks, lists, tables, and marks
      for (let op = 0; op < totalOperations; op++) {
        doc.transact(() => {
          if (op % 10 === 0) {
            // Heading H2 / H3
            const h = new Y.XmlElement('heading');
            h.setAttribute('level', ((op % 3) + 2) as any);
            const ht = new Y.XmlText();
            ht.insert(0, `Section ${op}: Distributed Fault Tolerance & CRDT Convergence Protocols`);
            h.insert(0, [ht]);
            fragment.insert(fragment.length, [h]);
            elementsCreated.push(`h-${op}`);
          } else if (op % 10 === 1) {
            // Fenced Code Block
            const code = new Y.XmlElement('code_block');
            code.setAttribute('language', 'typescript');
            const codeText = new Y.XmlText();
            codeText.insert(0, `export async function verifyFidelity(state: Uint8Array): Promise<boolean> {\n  return state.byteLength > 0 && op === ${op};\n}`);
            code.insert(0, [codeText]);
            fragment.insert(fragment.length, [code]);
            elementsCreated.push(`code-${op}`);
          } else if (op % 10 === 2) {
            // Table structure
            const table = new Y.XmlElement('table');
            const row1 = new Y.XmlElement('table_row');
            const cell1 = new Y.XmlElement('table_cell');
            const cell1P = new Y.XmlElement('paragraph');
            const cpText = new Y.XmlText();
            cpText.insert(0, `Metric-${op}`);
            cell1P.insert(0, [cpText]);
            cell1.insert(0, [cell1P]);

            const cell2 = new Y.XmlElement('table_cell');
            const cell2P = new Y.XmlElement('paragraph');
            const cp2Text = new Y.XmlText();
            cp2Text.insert(0, `Value-${op * 42}`);
            cell2P.insert(0, [cp2Text]);
            cell2.insert(0, [cell2P]);

            row1.insert(0, [cell1, cell2]);
            table.insert(0, [row1]);
            fragment.insert(fragment.length, [table]);
            elementsCreated.push(`table-${op}`);
          } else if (op % 10 === 3) {
            // Callout alert
            const alert = new Y.XmlElement('callout_alert');
            alert.setAttribute('alertType', 'WARNING');
            const ap = new Y.XmlElement('paragraph');
            const apt = new Y.XmlText();
            apt.insert(0, `Critical Warning at operation ${op}: Verify zero packet loss.`);
            ap.insert(0, [apt]);
            alert.insert(0, [ap]);
            fragment.insert(fragment.length, [alert]);
            elementsCreated.push(`alert-${op}`);
          } else {
            // Paragraph with diverse marks: suggestion_insert, suggestion_delete, strong, em, code
            const p = new Y.XmlElement('paragraph');
            const pt = new Y.XmlText();
            const textContent = `Standard transactional text block at step ${op}. Highly nested verification payload with unicode ⚡🚀 and symbols.`;
            pt.insert(0, textContent);

            // Apply suggestion marks and formatting
            pt.format(0, 10, { strong: true });
            pt.format(11, 20, {
              suggestion_insert: {
                id: `sug-ins-${op}`,
                agentId: 'agent-stress-oracle',
                tokenId: `tok-${op}`,
                status: 'pending',
                timestamp: Date.now(),
              },
            });
            pt.format(21, 30, {
              suggestion_delete: {
                id: `sug-del-${op}`,
                agentId: 'agent-stress-oracle',
                tokenId: `tok-${op}`,
                status: 'pending',
                timestamp: Date.now(),
              },
            });
            pt.format(35, 45, { code: true });

            p.insert(0, [pt]);
            fragment.insert(fragment.length, [p]);
            elementsCreated.push(`p-${op}`);
          }
        });
      }

      // Encode document state into binary update
      const originalBinaryState = Y.encodeStateAsUpdate(doc);
      expect(originalBinaryState.byteLength).toBeGreaterThan(50000); // Dense binary snapshot > 50KB

      const docId = '11111111-2222-3333-4444-555555555555';

      // 2. Persist to PostgreSQL bytea column
      await pgAdapter.store(docId, originalBinaryState, doc);

      // 3. Fetch from PostgreSQL bytea column
      const retrievedBinaryState = await pgAdapter.fetch(docId);
      expect(retrievedBinaryState).not.toBeNull();

      // 4. Byte-for-byte exact equality assertion
      expect(retrievedBinaryState!.byteLength).toBe(originalBinaryState.byteLength);
      expect(Buffer.from(retrievedBinaryState!).equals(Buffer.from(originalBinaryState))).toBe(true);

      // Verify each individual byte matches
      let diffCount = 0;
      for (let i = 0; i < originalBinaryState.length; i++) {
        if (retrievedBinaryState![i] !== originalBinaryState[i]) {
          diffCount++;
        }
      }
      expect(diffCount).toBe(0);

      // 5. Recover document in a clean Y.Doc and assert CRDT state parity
      const recoveredDoc = new Y.Doc();
      Y.applyUpdate(recoveredDoc, retrievedBinaryState!);

      const recoveredFragment = recoveredDoc.getXmlFragment('prosemirror');
      expect(recoveredFragment.length).toBe(fragment.length);

      // Check first element (H1)
      const recH1 = recoveredFragment.get(0) as Y.XmlElement;
      expect(recH1.nodeName).toBe('heading');
      expect((recH1.get(0) as Y.XmlText).toString()).toBe('Enterprise Systems Architecture & Reliability Blueprint');

      // Check state vectors match exactly
      const origVector = Y.encodeStateVector(doc);
      const recVector = Y.encodeStateVector(recoveredDoc);
      expect(Buffer.from(recVector).equals(Buffer.from(origVector))).toBe(true);
    });

    it('preserves boundary integrity when storing Uint8Array subarrays with non-zero byte offsets', async () => {
      // Create a large parent buffer with sentinel noise bytes
      const noiseLeading = 128;
      const noiseTrailing = 256;
      const validDoc = new Y.Doc();
      validDoc.getText('body').insert(0, 'Target payload inside sliced memory buffer');
      const validUpdate = Y.encodeStateAsUpdate(validDoc);

      const parentBuffer = new Uint8Array(noiseLeading + validUpdate.length + noiseTrailing);
      parentBuffer.fill(0xfe, 0, noiseLeading); // Leading sentinel noise
      parentBuffer.set(validUpdate, noiseLeading);
      parentBuffer.fill(0xfa, noiseLeading + validUpdate.length); // Trailing sentinel noise

      // Create sliced subarray with non-zero offset
      const slicedSubarray = parentBuffer.subarray(noiseLeading, noiseLeading + validUpdate.length);
      expect(slicedSubarray.byteOffset).toBe(noiseLeading);
      expect(slicedSubarray.byteLength).toBe(validUpdate.length);

      const docId = '22222222-3333-4444-5555-666666666666';
      await pgAdapter.store(docId, slicedSubarray);

      const fetched = await pgAdapter.fetch(docId);
      expect(fetched).not.toBeNull();
      expect(fetched!.length).toBe(validUpdate.length);
      expect(Buffer.from(fetched!).equals(Buffer.from(validUpdate))).toBe(true);

      // Ensure no noise bytes leaked into stored payload
      const testDoc = new Y.Doc();
      expect(() => Y.applyUpdate(testDoc, fetched!)).not.toThrow();
      expect(testDoc.getText('body').toString()).toBe('Target payload inside sliced memory buffer');
    });

    it('handles binary edge cases including null bytes (0x00), full byte ranges (0x00-0xFF), and high-plane emojis without escaping corruption', async () => {
      const doc = new Y.Doc();
      const text = doc.getText('content');

      // Construct a string containing null bytes, unicode surrogate pairs, ANSI escapes, and zero-width characters
      const adversarialText =
        'Zero\u0000Byte\u0000Separators' +
        '👨‍👩‍👧‍👦 Family Emoji (Surrogate Pairs)' +
        '🦀 Rust & 🚀 Rocket & 💡 Bulb' +
        '\x1b[31mRed ANSI\x1b[0m' +
        'Zero\u200BWidth\u200CChars\uFEFF' +
        'Quotes: "\'\\`` and SQL: \'; DROP TABLE posts; --';

      text.insert(0, adversarialText);

      const update = Y.encodeStateAsUpdate(doc);
      const docId = '33333333-4444-5555-6666-777777777777';

      await pgAdapter.store(docId, update);
      const fetched = await pgAdapter.fetch(docId);

      expect(fetched).not.toBeNull();
      expect(Buffer.from(fetched!).equals(Buffer.from(update))).toBe(true);

      const rec = new Y.Doc();
      Y.applyUpdate(rec, fetched!);
      expect(rec.getText('content').toString()).toBe(adversarialText);
    });

    it('maintains consistency across 50 successive incremental stores on the same record', async () => {
      const docId = '44444444-5555-6666-7777-888888888888';
      const doc = new Y.Doc();
      const text = doc.getText('stream');

      for (let i = 0; i < 50; i++) {
        text.insert(text.length, `[Chunk-${i}] `);
        const update = Y.encodeStateAsUpdate(doc);
        await pgAdapter.store(docId, update);

        const fetched = await pgAdapter.fetch(docId);
        expect(fetched).not.toBeNull();

        const checkDoc = new Y.Doc();
        Y.applyUpdate(checkDoc, fetched!);
        expect(checkDoc.getText('stream').toString()).toBe(text.toString());
      }

      // Assert row count in database table remains strictly 1
      const countRes = await pool.query('SELECT COUNT(*) as count FROM posts WHERE id = $1', [docId]);
      expect(Number(countRes.rows[0].count)).toBe(1);
    });
  });

  // =========================================================================
  // Dimension 2: In-Memory vs Pg-Mem Persistence Parity
  // =========================================================================
  describe('2. In-Memory vs Pg-Mem Persistence Parity', () => {
    let inMemAdapter: InMemoryPersistenceAdapter;
    let pgAdapter: PostgresPersistenceAdapter;
    let pool: any;

    beforeEach(() => {
      inMemAdapter = new InMemoryPersistenceAdapter();
      const db = createTestDb();
      pool = new (db.adapters.createPg().Pool)();
      pgAdapter = new PostgresPersistenceAdapter({ pool, tableName: 'posts' });
    });

    afterEach(async () => {
      await inMemAdapter.destroy();
      await pgAdapter.destroy();
    });

    it('exhibits strict behavior parity on non-existent document fetches', async () => {
      const inMemRes = await inMemAdapter.fetch('non-existent-doc-id');
      const pgRes = await pgAdapter.fetch('non-existent-doc-id');

      expect(inMemRes).toBeNull();
      expect(pgRes).toBeNull();
      expect(inMemRes).toBe(pgRes);
    });

    it('exhibits parity on storing and refetching identical binary updates', async () => {
      const doc = new Y.Doc();
      doc.getText('data').insert(0, 'Parity validation text');
      const state = Y.encodeStateAsUpdate(doc);

      const docId = '55555555-6666-7777-8888-999999999999';

      await inMemAdapter.store(docId, state);
      await pgAdapter.store(docId, state);

      const inMemFetched = await inMemAdapter.fetch(docId);
      const pgFetched = await pgAdapter.fetch(docId);

      expect(inMemFetched).not.toBeNull();
      expect(pgFetched).not.toBeNull();
      expect(Buffer.from(inMemFetched!).equals(Buffer.from(pgFetched!))).toBe(true);
      expect(Buffer.from(inMemFetched!).equals(Buffer.from(state))).toBe(true);
    });

    it('exhibits parity on copy-on-write buffer isolation (mutating fetched buffer does not corrupt store)', async () => {
      const doc = new Y.Doc();
      doc.getText('data').insert(0, 'Buffer immutability test');
      const originalBytes = Y.encodeStateAsUpdate(doc);
      const originalFirstByte = originalBytes[0];

      const docId = '66666666-7777-8888-9999-aaaaaaaaaaaa';
      await inMemAdapter.store(docId, originalBytes);
      await pgAdapter.store(docId, originalBytes);

      // Fetch and mutate buffer from in-memory
      const inMemBuf = await inMemAdapter.fetch(docId);
      inMemBuf![0] = 0xdd;

      // Fetch and mutate buffer from postgres
      const pgBuf = await pgAdapter.fetch(docId);
      pgBuf![0] = 0xdd;

      // Refetch both and assert original byte is unchanged
      const inMemRefetched = await inMemAdapter.fetch(docId);
      const pgRefetched = await pgAdapter.fetch(docId);

      expect(inMemRefetched![0]).toBe(originalFirstByte);
      expect(pgRefetched![0]).toBe(originalFirstByte);
    });

    it('reveals prefix normalization disparity: PostgresPersistenceAdapter normalizes "post-" but InMemoryPersistenceAdapter does not', async () => {
      const rawUuid = '77777777-8888-9999-aaaa-bbbbbbbbbbbb';
      const prefixedName = `post-${rawUuid}`;
      const state = new Uint8Array([1, 2, 3, 4, 5]);

      // Store using prefixed name 'post-<uuid>'
      await inMemAdapter.store(prefixedName, state);
      await pgAdapter.store(prefixedName, state);

      // Fetch with raw UUID (without 'post-')
      const inMemFetchRaw = await inMemAdapter.fetch(rawUuid);
      const pgFetchRaw = await pgAdapter.fetch(rawUuid);

      // PostgresPersistenceAdapter succeeds because of normalizeDocId()
      expect(pgFetchRaw).not.toBeNull();
      expect(pgFetchRaw).toEqual(state);

      // InMemoryPersistenceAdapter returns null because Map uses exact string keys!
      // This is an architectural asymmetry between test and production adapters.
      expect(inMemFetchRaw).toBeNull();
    });

    it('safely handles adversarial SQL injection payloads in document names without syntax errors', async () => {
      const injectionNames = [
        "injection-1'; DROP TABLE posts; --",
        'injection-2" OR "1"="1',
        "injection-3' UNION SELECT * FROM users --",
        'injection-4\\x00\\x27\\x22',
      ];

      const state = new Uint8Array([42, 43, 44]);

      for (const name of injectionNames) {
        // Must not throw SQL error
        await expect(pgAdapter.store(name, state)).resolves.not.toThrow();
        await expect(inMemAdapter.store(name, state)).resolves.not.toThrow();

        const pgFetched = await pgAdapter.fetch(name);
        const inMemFetched = await inMemAdapter.fetch(name);

        expect(pgFetched).toEqual(state);
        expect(inMemFetched).toEqual(state);
      }

      // Assert posts table is still intact and not dropped
      const countRes = await pool.query('SELECT COUNT(*) as count FROM posts');
      expect(Number(countRes.rows[0].count)).toBeGreaterThanOrEqual(4);
    });
  });

  // =========================================================================
  // Dimension 3: Graceful Shutdown Durability (0ms RPO)
  // =========================================================================
  describe('3. Graceful Shutdown Durability (0ms RPO)', () => {
    it('guarantees 0ms RPO during in-flight debounce on SIGTERM/destroy by synchronously flushing pending updates', async () => {
      const db = createTestDb();
      const pool = new (db.adapters.createPg().Pool)();
      const pgAdapter = new PostgresPersistenceAdapter({ pool, tableName: 'posts' });

      // Configure a long 5-second debounce window
      instance = await createCollabServer({
        port: 0,
        adapter: pgAdapter,
        debounceMs: 5000,
        maxDebounceMs: 15000,
        quiet: true,
      });

      const { url } = await instance.listen();
      const docName = 'post-shutdown-rpo-test';

      const doc = new Y.Doc();
      const provider = new HocuspocusProvider({
        url,
        name: docName,
        document: doc,
        token: 'token-author-alice',
        WebSocketPolyfill: WebSocket as any,
      });
      providersToClean.push(provider);

      await new Promise<void>((resolve) => provider.on('synced', () => resolve()));

      // Apply 50 rapid sequential edits
      const text = doc.getText('content');
      for (let i = 0; i < 50; i++) {
        text.insert(text.length, `[Edit-${i}] `);
      }

      // Allow 100ms for WebSocket transmission to reach server memory
      await new Promise((r) => setTimeout(r, 100));

      // At 100ms (far before 5,000ms debounce), database MUST still be empty
      const beforeShutdown = await pgAdapter.fetch(docName);
      expect(beforeShutdown).toBeNull();

      // Trigger Graceful Shutdown (equivalent to SIGTERM signal handler)
      await instance.destroy();
      instance = null; // Mark cleaned up

      // Database MUST now have the complete flushed state with zero data loss
      const afterShutdown = await pgAdapter.fetch(docName);
      expect(afterShutdown).not.toBeNull();

      const recoveredDoc = new Y.Doc();
      Y.applyUpdate(recoveredDoc, afterShutdown!);
      expect(recoveredDoc.getText('content').toString()).toBe(text.toString());

      // Simulate cold restart: spin up a NEW server with the same adapter and connect
      const restartedServer = await createCollabServer({
        port: 0,
        adapter: pgAdapter,
        quiet: true,
      });

      try {
        const { url: restartUrl } = await restartedServer.listen();
        const clientAfterRestart = new Y.Doc();
        const restartProvider = new HocuspocusProvider({
          url: restartUrl,
          name: docName,
          document: clientAfterRestart,
          token: 'token-author-alice',
          WebSocketPolyfill: WebSocket as any,
        });
        providersToClean.push(restartProvider);

        await new Promise<void>((resolve) => restartProvider.on('synced', () => resolve()));
        expect(clientAfterRestart.getText('content').toString()).toBe(text.toString());
      } finally {
        await restartedServer.destroy();
        await pgAdapter.destroy();
      }
    });

    it('flushes multiple concurrent documents in debounced state on shutdown without losing any document', async () => {
      const adapter = new InMemoryPersistenceAdapter();

      instance = await createCollabServer({
        port: 0,
        adapter,
        debounceMs: 5000,
        quiet: true,
      });

      const { url } = await instance.listen();
      const docCount = 5;
      const providers: HocuspocusProvider[] = [];
      const clientDocs: Y.Doc[] = [];

      for (let i = 0; i < docCount; i++) {
        const d = new Y.Doc();
        clientDocs.push(d);
        const p = new HocuspocusProvider({
          url,
          name: `post-multi-shutdown-${i}`,
          document: d,
          token: `token-author-${i}`,
          WebSocketPolyfill: WebSocket as any,
        });
        providers.push(p);
        providersToClean.push(p);
      }

      await Promise.all(
        providers.map((p) => new Promise<void>((resolve) => p.on('synced', () => resolve()))),
      );

      // Perform edits on all 5 documents simultaneously
      for (let i = 0; i < docCount; i++) {
        clientDocs[i].getText('content').insert(0, `Document ${i} unpersisted edit payload`);
      }

      // Allow 100ms for network transmission
      await new Promise((r) => setTimeout(r, 100));

      // Confirm all 5 are in debounce and unpersisted
      for (let i = 0; i < docCount; i++) {
        expect(await adapter.fetch(`post-multi-shutdown-${i}`)).toBeNull();
      }

      // Trigger shutdown
      await instance.destroy();
      instance = null;

      // Verify ALL 5 documents were flushed to persistence
      for (let i = 0; i < docCount; i++) {
        const persisted = await adapter.fetch(`post-multi-shutdown-${i}`);
        expect(persisted).not.toBeNull();
        const rec = new Y.Doc();
        Y.applyUpdate(rec, persisted!);
        expect(rec.getText('content').toString()).toBe(`Document ${i} unpersisted edit payload`);
      }
    });

    it('handles simulated slow persistence writes during shutdown without premature exit or data corruption', async () => {
      const baseAdapter = new InMemoryPersistenceAdapter();
      let storeCompleted = false;

      // Wrap adapter with artificial 150ms I/O latency
      const slowAdapter = {
        ...baseAdapter,
        async store(docName: string, state: Uint8Array, doc?: Y.Doc) {
          await new Promise((r) => setTimeout(r, 150));
          await baseAdapter.store(docName, state, doc);
          storeCompleted = true;
        },
        fetch: baseAdapter.fetch.bind(baseAdapter),
        destroy: baseAdapter.destroy.bind(baseAdapter),
      };

      instance = await createCollabServer({
        port: 0,
        adapter: slowAdapter,
        debounceMs: 4000,
        quiet: true,
      });

      const { url } = await instance.listen();
      const doc = new Y.Doc();
      const provider = new HocuspocusProvider({
        url,
        name: 'post-slow-flush',
        document: doc,
        token: 'token-author-alice',
        WebSocketPolyfill: WebSocket as any,
      });
      providersToClean.push(provider);

      await new Promise<void>((resolve) => provider.on('synced', () => resolve()));
      doc.getText('content').insert(0, 'Slow write payload');

      await new Promise((r) => setTimeout(r, 80));
      expect(storeCompleted).toBe(false);

      // Trigger destroy: must wait for the 150ms async store to finish
      await instance.destroy();
      instance = null;

      expect(storeCompleted).toBe(true);
      const saved = await baseAdapter.fetch('post-slow-flush');
      expect(saved).not.toBeNull();
      const rec = new Y.Doc();
      Y.applyUpdate(rec, saved!);
      expect(rec.getText('content').toString()).toBe('Slow write payload');
    });
  });

  // =========================================================================
  // Dimension 4: Working Markdown Caching & Suggestion Stripping
  // =========================================================================
  describe('4. Working Markdown Caching & Suggestion Stripping', () => {
    let pgAdapter: PostgresPersistenceAdapter;
    let pool: any;

    beforeEach(() => {
      const db = createTestDb();
      pool = new (db.adapters.createPg().Pool)();
      pgAdapter = new PostgresPersistenceAdapter({ pool, tableName: 'posts' });
    });

    afterEach(async () => {
      await pgAdapter.destroy();
    });

    it('derives and caches working_markdown while strictly dropping pending insertions and retaining pending deletions across successive edits', async () => {
      const docId = '88888888-9999-aaaa-bbbb-cccccccccccc';
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('prosemirror');

      // 1. Initial Document State: Heading + Paragraph
      const h1 = new Y.XmlElement('heading');
      h1.setAttribute('level', 1 as any);
      const h1Text = new Y.XmlText();
      h1Text.insert(0, 'Enterprise Collaboration Strategy');
      h1.insert(0, [h1Text]);

      const p1 = new Y.XmlElement('paragraph');
      const p1Text = new Y.XmlText();
      p1Text.insert(0, 'The existing baseline architecture provides solid durability.');
      p1.insert(0, [p1Text]);

      fragment.insert(0, [h1, p1]);

      // Store initial state
      await pgAdapter.store(docId, Y.encodeStateAsUpdate(doc), doc);

      // Verify cached working_markdown in database
      const row1 = await pool.query('SELECT working_markdown FROM posts WHERE id = $1', [docId]);
      expect(row1.rows[0].working_markdown).toContain('# Enterprise Collaboration Strategy');
      expect(row1.rows[0].working_markdown).toContain('The existing baseline architecture provides solid durability.');

      // 2. Add an Agent Suggestion Insertion with status: "pending"
      // Insert new paragraph marked with suggestion_insert
      const p2 = new Y.XmlElement('paragraph');
      const p2Text = new Y.XmlText();
      p2Text.insert(0, 'Unreviewed agent suggested paragraph that should not be visible to readers.', {
        suggestion_insert: {
          id: 'sug-1',
          agentId: 'agent-codex',
          tokenId: 'tok-1',
          status: 'pending',
          timestamp: Date.now(),
        },
      });
      p2.insert(0, [p2Text]);
      fragment.insert(fragment.length, [p2]);

      // Store with pending suggestion
      await pgAdapter.store(docId, Y.encodeStateAsUpdate(doc), doc);

      // Verify working_markdown DROPS pending insertions
      const row2 = await pool.query('SELECT working_markdown FROM posts WHERE id = $1', [docId]);
      expect(row2.rows[0].working_markdown).not.toContain('Unreviewed agent suggested paragraph');
      expect(row2.rows[0].working_markdown).toContain('The existing baseline architecture provides solid durability.');

      // 3. Mark text for deletion with suggestion_delete (status: "pending")
      // In p1, mark "solid durability" as pending deletion
      p1Text.format(48, 16, {
        suggestion_delete: {
          id: 'sug-2',
          agentId: 'agent-codex',
          tokenId: 'tok-2',
          status: 'pending',
          timestamp: Date.now(),
        },
      });

      await pgAdapter.store(docId, Y.encodeStateAsUpdate(doc), doc);

      // Verify working_markdown RETAINS text marked with pending deletion (reader sees original text)
      const row3 = await pool.query('SELECT working_markdown FROM posts WHERE id = $1', [docId]);
      expect(row3.rows[0].working_markdown).toContain('solid durability');

      // 4. Accept the insertion and accept the deletion
      // Format insertion to status: "accepted"
      p2Text.format(0, p2Text.length, {
        suggestion_insert: {
          id: 'sug-1',
          agentId: 'agent-codex',
          tokenId: 'tok-1',
          status: 'accepted',
          timestamp: Date.now(),
        },
      });

      // Format deletion to status: "accepted"
      p1Text.format(48, 16, {
        suggestion_delete: {
          id: 'sug-2',
          agentId: 'agent-codex',
          tokenId: 'tok-2',
          status: 'accepted',
          timestamp: Date.now(),
        },
      });

      await pgAdapter.store(docId, Y.encodeStateAsUpdate(doc), doc);

      // Verify working_markdown NOW INCLUDES accepted insertion and DROPS accepted deletion
      const row4 = await pool.query('SELECT working_markdown FROM posts WHERE id = $1', [docId]);
      expect(row4.rows[0].working_markdown).toContain('Unreviewed agent suggested paragraph');
      expect(row4.rows[0].working_markdown).not.toContain('solid durability');
    });

    it('preserves cached working_markdown when store is invoked without live Y.Doc via COALESCE', async () => {
      const docId = '99999999-aaaa-bbbb-cccc-dddddddddddd';
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('prosemirror');

      const h = new Y.XmlElement('heading');
      h.setAttribute('level', 2 as any);
      const ht = new Y.XmlText();
      ht.insert(0, 'Cached Section Heading');
      h.insert(0, [ht]);
      fragment.insert(0, [h]);

      // 1. Store with live doc
      await pgAdapter.store(docId, Y.encodeStateAsUpdate(doc), doc);
      const row1 = await pool.query('SELECT working_markdown FROM posts WHERE id = $1', [docId]);
      expect(row1.rows[0].working_markdown).toContain('## Cached Section Heading');

      // 2. Subsequent store WITHOUT passing doc (e.g. binary update ingestion)
      const update = Y.encodeStateAsUpdate(doc);
      await pgAdapter.store(docId, update); // doc omitted

      // Assert working_markdown was NOT wiped to NULL
      const row2 = await pool.query('SELECT working_markdown FROM posts WHERE id = $1', [docId]);
      expect(row2.rows[0].working_markdown).toContain('## Cached Section Heading');
    });

    it('correctly derives complex ProseMirror elements in cached working_markdown (tables, callouts, math, code blocks)', async () => {
      const docId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const doc = new Y.Doc();
      const fragment = doc.getXmlFragment('prosemirror');

      // Table
      const table = new Y.XmlElement('table');
      const row = new Y.XmlElement('table_row');
      const cell1 = new Y.XmlElement('table_cell');
      const p1 = new Y.XmlElement('paragraph');
      const t1 = new Y.XmlText();
      t1.insert(0, 'Component');
      p1.insert(0, [t1]);
      cell1.insert(0, [p1]);

      const cell2 = new Y.XmlElement('table_cell');
      const p2 = new Y.XmlElement('paragraph');
      const t2 = new Y.XmlText();
      t2.insert(0, 'Status');
      p2.insert(0, [t2]);
      cell2.insert(0, [p2]);

      row.insert(0, [cell1, cell2]);
      table.insert(0, [row]);

      // Callout alert
      const alert = new Y.XmlElement('callout_alert');
      alert.setAttribute('alertType', 'NOTE');
      const ap = new Y.XmlElement('paragraph');
      const at = new Y.XmlText();
      at.insert(0, 'Production hardening in effect.');
      ap.insert(0, [at]);
      alert.insert(0, [ap]);

      // Fenced code block
      const code = new Y.XmlElement('code_block');
      code.setAttribute('language', 'json');
      const ct = new Y.XmlText();
      ct.insert(0, '{"service": "collab"}');
      code.insert(0, [ct]);

      // Math display
      const math = new Y.XmlElement('math_display');
      math.setAttribute('tex', '\\sum_{i=1}^{n} x_i');

      fragment.insert(0, [table, alert, code, math]);

      await pgAdapter.store(docId, Y.encodeStateAsUpdate(doc), doc);

      const res = await pool.query('SELECT working_markdown FROM posts WHERE id = $1', [docId]);
      const md = res.rows[0].working_markdown;

      expect(md).toContain('| Component | Status |');
      expect(md).toContain('> [!NOTE]');
      expect(md).toContain('Production hardening in effect.');
      expect(md).toContain('```json\n{"service": "collab"}\n```');
      expect(md).toContain('$$\n\\sum_{i=1}^{n} x_i\n$$');
    });
  });

  // =========================================================================
  // Dimension 5: Database Reconnection Resilience & Healthz Diagnostics
  // =========================================================================
  describe('5. Database Reconnection Resilience & Healthz Diagnostics', () => {
    it('reflects database outage in /healthz (503 Service Unavailable) and recovers to 200 OK upon database reconnection', async () => {
      const db = createTestDb();
      const realPool = new (db.adapters.createPg().Pool)();

      // Controllable proxy pool to simulate connectivity loss
      let isDbReachable = true;
      const proxyPool = {
        query: async (queryText: any, values?: any) => {
          if (!isDbReachable) {
            throw new Error('Connection terminated unexpectedly: database server closed connection');
          }
          return realPool.query(queryText, values);
        },
        end: async () => realPool.end(),
      };

      const pgAdapter = new PostgresPersistenceAdapter({ pool: proxyPool as any, tableName: 'posts' });

      instance = await createCollabServer({
        port: 0,
        adapter: pgAdapter,
        quiet: true,
      });

      const { port } = await instance.listen();

      // 1. Initial healthy state
      const resHealthy = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(resHealthy.status).toBe(200);
      const jsonHealthy = (await resHealthy.json()) as any;
      expect(jsonHealthy.status).toBe('healthy');
      expect(jsonHealthy.checks.database).toContain('connected');

      // 2. Simulate database outage
      isDbReachable = false;

      const resUnhealthy = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(resUnhealthy.status).toBe(503);
      const jsonUnhealthy = (await resUnhealthy.json()) as any;
      expect(jsonUnhealthy.status).toBe('unhealthy');
      expect(jsonUnhealthy.checks.database).toContain('Connection terminated unexpectedly');

      // 3. Simulate database recovery
      isDbReachable = true;

      const resRecovered = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(resRecovered.status).toBe(200);
      const jsonRecovered = (await resRecovered.json()) as any;
      expect(jsonRecovered.status).toBe('healthy');
      expect(jsonRecovered.checks.database).toContain('connected');

      await pgAdapter.destroy();
    });

    it('survives transient database store failures during client editing by retaining document in memory and persisting upon reconnection', async () => {
      const db = createTestDb();
      const realPool = new (db.adapters.createPg().Pool)();

      let isDbReachable = true;
      let storeAttempts = 0;
      let failedAttempts = 0;

      const controllablePool = {
        query: async (queryText: any, values?: any) => {
          // If this is a store query (UPDATE or INSERT into posts) and DB is down, fail
          if (
            typeof queryText === 'string' &&
            (queryText.includes('UPDATE posts') || queryText.includes('INSERT INTO posts'))
          ) {
            storeAttempts++;
            if (!isDbReachable) {
              failedAttempts++;
              throw new Error('ECONNREFUSED: Database server is down');
            }
          }
          return realPool.query(queryText, values);
        },
        end: async () => realPool.end(),
      };

      const pgAdapter = new PostgresPersistenceAdapter({
        pool: controllablePool as any,
        tableName: 'posts',
      });

      instance = await createCollabServer({
        port: 0,
        adapter: pgAdapter,
        debounceMs: 150,
        maxDebounceMs: 500,
        quiet: true,
      });

      const { url } = await instance.listen();
      const docName = 'post-resilience-reconnect';

      const doc = new Y.Doc();
      const provider = new HocuspocusProvider({
        url,
        name: docName,
        document: doc,
        token: 'token-author-alice',
        WebSocketPolyfill: WebSocket as any,
      });
      providersToClean.push(provider);

      await new Promise<void>((resolve) => provider.on('synced', () => resolve()));

      // 1. Cut database connection
      isDbReachable = false;

      // 2. Client makes an edit while DB is down
      doc.getText('content').insert(0, 'Edits submitted during database outage. ');

      // Wait for debounce (150ms) to trigger store and fail
      await new Promise((r) => setTimeout(r, 300));
      expect(failedAttempts).toBeGreaterThanOrEqual(1);

      // Verify server did NOT crash: provider is still connected and server tracks active connection
      expect(provider.configuration.websocketProvider.status).toBe('connected');
      expect(instance!.server.hocuspocus.getConnectionsCount()).toBe(1);

      // 3. Restore database connection
      isDbReachable = true;

      // 4. Client makes another edit, triggering another debounce cycle
      doc.getText('content').insert(doc.getText('content').length, 'Edits submitted after recovery.');

      // Wait for debounce and store to succeed
      await new Promise((r) => setTimeout(r, 400));

      // 5. Query database directly: verify the accumulated document was successfully persisted
      const res = await realPool.query('SELECT yjs_state FROM posts WHERE slug = $1', [docName]);
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].yjs_state).not.toBeNull();

      const rec = new Y.Doc();
      const buf = res.rows[0].yjs_state;
      Y.applyUpdate(rec, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));

      expect(rec.getText('content').toString()).toBe(
        'Edits submitted during database outage. Edits submitted after recovery.',
      );

      await pgAdapter.destroy();
    });
  });
});
