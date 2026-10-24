import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { createCollabServer, type CollabServerInstance } from '../src/server.js';
import { InMemoryPersistenceAdapter } from '../src/persistence/in-memory.js';
import { PostgresPersistenceAdapter } from '../src/persistence/postgres.js';
import { newDb } from 'pg-mem';
import { createAuthHooks } from '../src/auth/hooks.js';

describe('Milestone M3 Adversarial Stress & Edge Case Verification Suite', () => {
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

  // Helper to construct custom WebSocket class with specific HTTP headers
  function createCustomWebSocket(headers: Record<string, string>) {
    return class CustomWebSocket extends WebSocket {
      constructor(address: string, protocols?: string | string[]) {
        super(address, protocols, { headers });
      }
    };
  }

  // =========================================================================
  // Dimension 1: Pure Standard WS Transport & High-Churn Concurrency
  // =========================================================================
  describe('1. Pure Standard WS Transport & High-Churn Concurrency', () => {
    it('survives mid-session connection cuts across 10 concurrent clients and reaches complete convergence on reconnect', async () => {
      instance = await createCollabServer({ port: 0, quiet: true });
      const { url } = await instance.listen();

      const docName = 'stress-reconnect-churn';
      const clientDocs: Y.Doc[] = [];
      const providers: HocuspocusProvider[] = [];

      // 1. Spin up 10 concurrent clients
      for (let i = 0; i < 10; i++) {
        const doc = new Y.Doc();
        clientDocs.push(doc);
        const provider = new HocuspocusProvider({
          url,
          name: docName,
          document: doc,
          token: `token-author-${i}`,
          WebSocketPolyfill: WebSocket as any,
        });
        providers.push(provider);
        providersToClean.push(provider);
      }

      // Wait for all 10 clients to sync initially
      await Promise.all(
        providers.map(
          (p) =>
            new Promise<void>((resolve, reject) => {
              p.on('synced', () => resolve());
              setTimeout(() => reject(new Error('Initial sync timeout')), 8000);
            }),
        ),
      );

      // Verify connection count matches 10
      expect(instance.server.hocuspocus.getConnectionsCount()).toBe(10);

      // 2. Abruptly disconnect 5 clients (clients 5 to 9)
      for (let i = 5; i < 10; i++) {
        providers[i].disconnect();
      }

      await new Promise((r) => setTimeout(r, 100));

      // 3. The 5 remaining connected clients perform concurrent edits
      const insertedSubstrings: string[] = [];
      for (let i = 0; i < 5; i++) {
        const text = `[Edit from client ${i}] `;
        insertedSubstrings.push(text);
        clientDocs[i].getText('content').insert(clientDocs[i].getText('content').length, text);
      }

      // Allow brief moment for edits to propagate among connected clients
      await new Promise((r) => setTimeout(r, 200));

      for (let i = 0; i < 5; i++) {
        const content = clientDocs[i].getText('content').toString();
        for (const sub of insertedSubstrings) {
          expect(content).toContain(sub);
        }
      }

      // 4. Reconnect the 5 disconnected clients
      for (let i = 5; i < 10; i++) {
        providers[i].connect();
      }

      // Wait for all reconnected clients to sync
      await Promise.all(
        providers.slice(5, 10).map(
          (p) =>
            new Promise<void>((resolve, reject) => {
              if (p.isSynced) return resolve();
              p.on('synced', () => resolve());
              setTimeout(() => reject(new Error('Reconnect sync timeout')), 8000);
            }),
        ),
      );

      await new Promise((r) => setTimeout(r, 200));

      // 5. Assert 100% byte-identical state and string content across ALL 10 clients
      const baselineText = clientDocs[0].getText('content').toString();
      const baselineState = Y.encodeStateAsUpdate(clientDocs[0]);

      for (let i = 1; i < 10; i++) {
        expect(clientDocs[i].getText('content').toString()).toBe(baselineText);
        const stateI = Y.encodeStateAsUpdate(clientDocs[i]);
        expect(Buffer.from(stateI).equals(Buffer.from(baselineState))).toBe(true);
      }
    });

    it('rigorously tracks server connection and document counts without socket leaks', async () => {
      instance = await createCollabServer({ port: 0, quiet: true });
      const { url } = await instance.listen();

      expect(instance.server.hocuspocus.getConnectionsCount()).toBe(0);
      expect(instance.server.hocuspocus.getDocumentsCount()).toBe(0);

      // Connect 6 clients across 2 documents (3 clients each)
      const groupA: HocuspocusProvider[] = [];
      const groupB: HocuspocusProvider[] = [];

      for (let i = 0; i < 3; i++) {
        const pA = new HocuspocusProvider({
          url,
          name: 'post-room-a',
          document: new Y.Doc(),
          token: `token-author-a-${i}`,
          WebSocketPolyfill: WebSocket as any,
        });
        groupA.push(pA);
        providersToClean.push(pA);

        const pB = new HocuspocusProvider({
          url,
          name: 'post-room-b',
          document: new Y.Doc(),
          token: `token-author-b-${i}`,
          WebSocketPolyfill: WebSocket as any,
        });
        groupB.push(pB);
        providersToClean.push(pB);
      }

      await Promise.all(
        [...groupA, ...groupB].map(
          (p) =>
            new Promise<void>((resolve) => {
              p.on('synced', () => resolve());
            }),
        ),
      );

      expect(instance.server.hocuspocus.getConnectionsCount()).toBe(6);
      expect(instance.server.hocuspocus.getDocumentsCount()).toBe(2);

      // Destroy all clients in group A
      while (groupA.length > 0) {
        groupA.pop()?.destroy();
      }

      await new Promise((r) => setTimeout(r, 150));
      expect(instance.server.hocuspocus.getConnectionsCount()).toBe(3);

      // Destroy all clients in group B
      while (groupB.length > 0) {
        groupB.pop()?.destroy();
      }

      await new Promise((r) => setTimeout(r, 150));
      expect(instance.server.hocuspocus.getConnectionsCount()).toBe(0);
    });

    it('guarantees complete isolation across concurrent multi-room sessions', async () => {
      instance = await createCollabServer({ port: 0, quiet: true });
      const { url } = await instance.listen();

      const rooms = ['room-alpha', 'room-beta', 'room-gamma', 'room-delta'];
      const docs: Record<string, [Y.Doc, Y.Doc]> = {};

      for (const room of rooms) {
        const doc1 = new Y.Doc();
        const doc2 = new Y.Doc();
        docs[room] = [doc1, doc2];

        const p1 = new HocuspocusProvider({
          url,
          name: room,
          document: doc1,
          token: 'token-author-alice',
          WebSocketPolyfill: WebSocket as any,
        });
        const p2 = new HocuspocusProvider({
          url,
          name: room,
          document: doc2,
          token: 'token-author-bob',
          WebSocketPolyfill: WebSocket as any,
        });
        providersToClean.push(p1, p2);
      }

      // Wait for all providers to be synced
      await Promise.all(
        providersToClean.map(
          (p) =>
            new Promise<void>((resolve) => {
              if (p.isSynced) return resolve();
              p.on('synced', () => resolve());
            }),
        ),
      );

      // Concurrently write unique messages to each room
      for (const room of rooms) {
        docs[room][0].getText('content').insert(0, `Exclusive content for ${room}`);
      }

      await new Promise((r) => setTimeout(r, 200));

      // Verify each room has only its content and zero cross-leakage
      for (const room of rooms) {
        const expected = `Exclusive content for ${room}`;
        expect(docs[room][0].getText('content').toString()).toBe(expected);
        expect(docs[room][1].getText('content').toString()).toBe(expected);

        // Ensure other room names do NOT appear
        for (const otherRoom of rooms) {
          if (otherRoom !== room) {
            expect(docs[room][0].getText('content').toString()).not.toContain(otherRoom);
          }
        }
      }
    });
  });

  // =========================================================================
  // Dimension 2: Continuous Typing vs Debounced Flush Edge Cases
  // =========================================================================
  describe('2. Inactivity Debouncing vs MaxDebounce Under Continuous Load', () => {
    it('forces stores via maxDebounce ceiling during continuous keystrokes with 0 dropped updates', async () => {
      const storeHistory: Array<{ timestamp: number; stateLength: number }> = [];
      const baseAdapter = new InMemoryPersistenceAdapter();
      const trackingAdapter = {
        ...baseAdapter,
        async store(docName: string, state: Uint8Array, doc?: Y.Doc) {
          storeHistory.push({ timestamp: Date.now(), stateLength: state.length });
          return baseAdapter.store(docName, state, doc);
        },
        fetch: baseAdapter.fetch.bind(baseAdapter),
        destroy: baseAdapter.destroy.bind(baseAdapter),
      };

      instance = await createCollabServer({
        port: 0,
        adapter: trackingAdapter,
        debounceMs: 250, // Inactivity threshold
        maxDebounceMs: 500, // Maximum ceiling
        quiet: true,
      });

      const { url } = await instance.listen();
      const docName = 'post-continuous-stress';

      // 3 clients typing simultaneously
      const clients: Array<{ doc: Y.Doc; provider: HocuspocusProvider }> = [];
      for (let i = 0; i < 3; i++) {
        const doc = new Y.Doc();
        const provider = new HocuspocusProvider({
          url,
          name: docName,
          document: doc,
          token: `token-author-${i}`,
          WebSocketPolyfill: WebSocket as any,
        });
        clients.push({ doc, provider });
        providersToClean.push(provider);
      }

      await Promise.all(
        clients.map(
          (c) =>
            new Promise<void>((resolve) => {
              c.provider.on('synced', () => resolve());
            }),
        ),
      );

      // Continuous typing: 3 clients each insert a character every 35ms for 1200ms (~34 edits each = ~102 edits)
      // Because interval (35ms) is much less than debounceMs (250ms), inactivity timer NEVER expires during typing!
      // All stores during this window are strictly forced by maxDebounce (500ms).
      const typingStartTime = Date.now();
      const totalSteps = 30;

      for (let step = 0; step < totalSteps; step++) {
        for (let c = 0; c < 3; c++) {
          const char = String.fromCharCode(65 + c); // 'A', 'B', 'C'
          clients[c].doc.getText('content').insert(clients[c].doc.getText('content').length, char);
        }
        await new Promise((r) => setTimeout(r, 35));
      }

      const activeTypingDuration = Date.now() - typingStartTime;
      expect(activeTypingDuration).toBeGreaterThanOrEqual(1000);

      // At this point, maxDebounce (500ms) must have forced stores at least once or twice during typing
      expect(storeHistory.length).toBeGreaterThanOrEqual(2);

      // Now cease typing and wait for the final inactivity debounce flush (250ms + margin)
      const storesBeforeInactivity = storeHistory.length;
      await new Promise((r) => setTimeout(r, 400));

      // After cessation, an additional inactivity flush must have executed
      expect(storeHistory.length).toBeGreaterThan(storesBeforeInactivity);

      // Fetch persisted state from persistence adapter and assert ZERO dropped keystrokes
      const persistedState = await trackingAdapter.fetch(docName);
      expect(persistedState).not.toBeNull();

      const restoredDoc = new Y.Doc();
      Y.applyUpdate(restoredDoc, persistedState!);

      const restoredText = restoredDoc.getText('content').toString();
      expect(restoredText.length).toBe(totalSteps * 3);

      // Verify exact count of each client's characters
      const countA = (restoredText.match(/A/g) || []).length;
      const countB = (restoredText.match(/B/g) || []).length;
      const countC = (restoredText.match(/C/g) || []).length;
      expect(countA).toBe(totalSteps);
      expect(countB).toBe(totalSteps);
      expect(countC).toBe(totalSteps);
    });

    it('flushes multiple distinct documents simultaneously on server destroy with long debouncing', async () => {
      const adapter = new InMemoryPersistenceAdapter();
      instance = await createCollabServer({
        port: 0,
        adapter,
        debounceMs: 15000, // 15 seconds: will NOT naturally fire during test
        maxDebounceMs: 30000,
        quiet: true,
      });

      const { url } = await instance.listen();
      const docNames = ['post-multi-flush-1', 'post-multi-flush-2', 'post-multi-flush-3', 'post-multi-flush-4'];

      for (const name of docNames) {
        const doc = new Y.Doc();
        const provider = new HocuspocusProvider({
          url,
          name,
          document: doc,
          token: 'token-author-alice',
          WebSocketPolyfill: WebSocket as any,
        });
        providersToClean.push(provider);

        await new Promise<void>((resolve) => provider.on('synced', () => resolve()));
        doc.getText('content').insert(0, `Data for ${name}`);
      }

      // Allow 150ms for packets to reach server memory
      await new Promise((r) => setTimeout(r, 150));

      // Verify that none of them are saved yet due to 15s debounce
      for (const name of docNames) {
        const earlyState = await adapter.fetch(name);
        expect(earlyState).toBeNull();
      }

      // Gracefully destroy server (triggers flushPendingStores)
      await instance.destroy();
      instance = null;

      // Every single document must now be flushed in the persistence adapter
      for (const name of docNames) {
        const flushed = await adapter.fetch(name);
        expect(flushed).not.toBeNull();

        const recovered = new Y.Doc();
        Y.applyUpdate(recovered, flushed!);
        expect(recovered.getText('content').toString()).toBe(`Data for ${name}`);
      }
    });

    it('handles simulated slow persistence storage backpressure without corrupting subsequent updates', async () => {
      const baseAdapter = new InMemoryPersistenceAdapter();
      let storeInFlight = false;
      let maxConcurrencySeen = 0;

      const slowAdapter = {
        ...baseAdapter,
        async store(docName: string, state: Uint8Array, doc?: Y.Doc) {
          if (storeInFlight) {
            maxConcurrencySeen++;
          }
          storeInFlight = true;
          // Simulate 80ms disk/network I/O
          await new Promise((r) => setTimeout(r, 80));
          storeInFlight = false;
          return baseAdapter.store(docName, state, doc);
        },
        fetch: baseAdapter.fetch.bind(baseAdapter),
        destroy: baseAdapter.destroy.bind(baseAdapter),
      };

      instance = await createCollabServer({
        port: 0,
        adapter: slowAdapter,
        debounceMs: 50,
        maxDebounceMs: 100,
        quiet: true,
      });

      const { url } = await instance.listen();
      const doc = new Y.Doc();
      const provider = new HocuspocusProvider({
        url,
        name: 'post-slow-storage',
        document: doc,
        token: 'token-author-alice',
        WebSocketPolyfill: WebSocket as any,
      });
      providersToClean.push(provider);

      await new Promise<void>((resolve) => provider.on('synced', () => resolve()));

      // Send 10 writes with brief pauses overlapping simulated storage latency
      for (let i = 0; i < 10; i++) {
        doc.getText('content').insert(i, `${i}`);
        await new Promise((r) => setTimeout(r, 30));
      }

      // Wait for backpressure queue and inactivity flush to settle
      await new Promise((r) => setTimeout(r, 400));

      const finalState = await slowAdapter.fetch('post-slow-storage');
      expect(finalState).not.toBeNull();

      const recovered = new Y.Doc();
      Y.applyUpdate(recovered, finalState!);
      expect(recovered.getText('content').toString()).toBe('0123456789');
    });
  });

  // =========================================================================
  // Dimension 3: Read-Only Mutation Rejection & Adversarial Packet Tampering
  // =========================================================================
  describe('3. Read-Only Mutation Rejection & Adversarial Packet Tampering', () => {
    it('strictly drops insertions, deletions, and map injections from readOnly reader clients', async () => {
      const adapter = new InMemoryPersistenceAdapter();
      instance = await createCollabServer({
        port: 0,
        adapter,
        debounceMs: 50,
        maxDebounceMs: 100,
        quiet: true,
      });

      const { url } = await instance.listen();
      const docName = 'post-readonly-thorough';

      // 1. Author seeds the canonical text
      const authorDoc = new Y.Doc();
      const authorProvider = new HocuspocusProvider({
        url,
        name: docName,
        document: authorDoc,
        token: 'token-author-alice',
        WebSocketPolyfill: WebSocket as any,
      });
      providersToClean.push(authorProvider);

      await new Promise<void>((resolve) => authorProvider.on('synced', () => resolve()));
      authorDoc.getText('content').insert(0, 'Canonical Enterprise Text');

      await new Promise((r) => setTimeout(r, 100));

      // 2. Reader connects (assigned readOnly = true by server)
      const readerDoc = new Y.Doc();
      const readerProvider = new HocuspocusProvider({
        url,
        name: docName,
        document: readerDoc,
        token: 'token-reader-mallory',
        WebSocketPolyfill: WebSocket as any,
      });
      providersToClean.push(readerProvider);

      await new Promise<void>((resolve) => readerProvider.on('synced', () => resolve()));
      expect(readerDoc.getText('content').toString()).toBe('Canonical Enterprise Text');

      // 3. Reader attempts hostile insertion
      readerDoc.getText('content').insert(0, 'MALICIOUS_PREFIX_');

      // 4. Reader attempts hostile deletion of author text
      readerDoc.getText('content').delete(readerDoc.getText('content').length - 4, 4); // deletes 'Text'

      // 5. Reader attempts metadata map injection
      readerDoc.getMap('metadata').set('pwned', true);

      // Allow network propagation
      await new Promise((r) => setTimeout(r, 200));

      // Author's live document must be completely unaffected
      expect(authorDoc.getText('content').toString()).toBe('Canonical Enterprise Text');
      expect(authorDoc.getMap('metadata').has('pwned')).toBe(false);

      // Verify persistence adapter never recorded reader's mutations
      await new Promise((r) => setTimeout(r, 200));
      const persisted = await adapter.fetch(docName);
      expect(persisted).not.toBeNull();

      const auditDoc = new Y.Doc();
      Y.applyUpdate(auditDoc, persisted!);
      expect(auditDoc.getText('content').toString()).toBe('Canonical Enterprise Text');
      expect(auditDoc.getMap('metadata').has('pwned')).toBe(false);

      // 6. A fresh reader client connecting gets only the uncorrupted author state
      const freshReaderDoc = new Y.Doc();
      const freshReaderProvider = new HocuspocusProvider({
        url,
        name: docName,
        document: freshReaderDoc,
        token: 'token-reader-bob',
        WebSocketPolyfill: WebSocket as any,
      });
      providersToClean.push(freshReaderProvider);

      await new Promise<void>((resolve) => freshReaderProvider.on('synced', () => resolve()));
      expect(freshReaderDoc.getText('content').toString()).toBe('Canonical Enterprise Text');
      expect(freshReaderDoc.getMap('metadata').has('pwned')).toBe(false);
    });

    it('rejects mutations from reviewer role (author role with review permission)', async () => {
      instance = await createCollabServer({ port: 0, quiet: true });
      const { url } = await instance.listen();

      const authorDoc = new Y.Doc();
      const authorProvider = new HocuspocusProvider({
        url,
        name: 'post-reviewer-guard',
        document: authorDoc,
        token: 'token-author-alice',
        WebSocketPolyfill: WebSocket as any,
      });
      providersToClean.push(authorProvider);

      await new Promise<void>((resolve) => authorProvider.on('synced', () => resolve()));
      authorDoc.getText('content').insert(0, 'Stable Article');

      await new Promise((r) => setTimeout(r, 100));

      // Reviewer connects with 'token-reviewer-david' (permissions: ['review'], connectionConfig.readOnly = true)
      const reviewerDoc = new Y.Doc();
      const reviewerProvider = new HocuspocusProvider({
        url,
        name: 'post-reviewer-guard',
        document: reviewerDoc,
        token: 'token-reviewer-david',
        WebSocketPolyfill: WebSocket as any,
      });
      providersToClean.push(reviewerProvider);

      await new Promise<void>((resolve) => reviewerProvider.on('synced', () => resolve()));
      expect(reviewerDoc.getText('content').toString()).toBe('Stable Article');

      // Reviewer attempts direct document modification
      reviewerDoc.getText('content').insert(0, 'Reviewer edit: ');

      await new Promise((r) => setTimeout(r, 200));

      // Author state must remain pristine
      expect(authorDoc.getText('content').toString()).toBe('Stable Article');
    });
  });

  // =========================================================================
  // Dimension 4: Origin Allowlist Rejection & Security Boundary
  // =========================================================================
  describe('4. Origin Allowlist Rejection & Security Boundary', () => {
    it('aborts WebSocket connection immediately when origin is not in allowlist', async () => {
      instance = await createCollabServer({
        port: 0,
        quiet: true,
        authOptions: {
          allowedOrigins: ['https://cms.enterprise.corp'],
        },
      });
      const { url } = await instance.listen();

      const doc = new Y.Doc();
      const MaliciousWs = createCustomWebSocket({
        Origin: 'https://attacker.evil.com',
      });

      const provider = new HocuspocusProvider({
        url,
        name: 'post-origin-test',
        document: doc,
        token: 'token-author-alice',
        WebSocketPolyfill: MaliciousWs as any,
      });
      providersToClean.push(provider);

      const failedOrClosed = await new Promise<boolean>((resolve) => {
        provider.on('authenticationFailed', () => resolve(true));
        provider.on('close', () => resolve(true));
        setTimeout(() => resolve(false), 5000);
      });

      expect(failedOrClosed).toBe(true);
      expect(provider.isSynced).toBe(false);
    });

    it('rejects origin subdomain suffix spoofing attempts', async () => {
      instance = await createCollabServer({
        port: 0,
        quiet: true,
        authOptions: {
          allowedOrigins: ['https://cms.enterprise.corp'],
        },
      });
      const { url } = await instance.listen();

      const doc = new Y.Doc();
      const SpoofedWs = createCustomWebSocket({
        Origin: 'https://cms.enterprise.corp.attacker.io',
      });

      const provider = new HocuspocusProvider({
        url,
        name: 'post-spoof-test',
        document: doc,
        token: 'token-author-alice',
        WebSocketPolyfill: SpoofedWs as any,
      });
      providersToClean.push(provider);

      const rejected = await new Promise<boolean>((resolve) => {
        provider.on('authenticationFailed', () => resolve(true));
        provider.on('close', () => resolve(true));
        setTimeout(() => resolve(false), 5000);
      });

      expect(rejected).toBe(true);
      expect(provider.isSynced).toBe(false);
    });

    it('rejects protocol and port mismatches on origin header', async () => {
      instance = await createCollabServer({
        port: 0,
        quiet: true,
        authOptions: {
          allowedOrigins: ['https://cms.enterprise.corp'],
        },
      });
      const { url } = await instance.listen();

      // Protocol mismatch: http instead of https
      const HttpWs = createCustomWebSocket({ Origin: 'http://cms.enterprise.corp' });
      const p1 = new HocuspocusProvider({
        url,
        name: 'post-proto-test',
        document: new Y.Doc(),
        token: 'token-author-alice',
        WebSocketPolyfill: HttpWs as any,
      });
      providersToClean.push(p1);

      const p1Rejected = await new Promise<boolean>((resolve) => {
        p1.on('authenticationFailed', () => resolve(true));
        p1.on('close', () => resolve(true));
        setTimeout(() => resolve(false), 5000);
      });
      expect(p1Rejected).toBe(true);

      // Port mismatch: :8443
      const PortWs = createCustomWebSocket({ Origin: 'https://cms.enterprise.corp:8443' });
      const p2 = new HocuspocusProvider({
        url,
        name: 'post-port-test',
        document: new Y.Doc(),
        token: 'token-author-alice',
        WebSocketPolyfill: PortWs as any,
      });
      providersToClean.push(p2);

      const p2Rejected = await new Promise<boolean>((resolve) => {
        p2.on('authenticationFailed', () => resolve(true));
        p2.on('close', () => resolve(true));
        setTimeout(() => resolve(false), 5000);
      });
      expect(p2Rejected).toBe(true);
    });

    it('successfully connects and synchronizes when origin strictly matches allowlist', async () => {
      instance = await createCollabServer({
        port: 0,
        quiet: true,
        authOptions: {
          allowedOrigins: ['https://cms.enterprise.corp'],
        },
      });
      const { url } = await instance.listen();

      const doc = new Y.Doc();
      const ValidWs = createCustomWebSocket({ Origin: 'https://cms.enterprise.corp' });

      const provider = new HocuspocusProvider({
        url,
        name: 'post-valid-origin',
        document: doc,
        token: 'token-author-alice',
        WebSocketPolyfill: ValidWs as any,
      });
      providersToClean.push(provider);

      await new Promise<void>((resolve, reject) => {
        provider.on('synced', () => resolve());
        provider.on('close', (e) => reject(new Error(`Closed unexpectedly: ${e.code}`)));
        setTimeout(() => reject(new Error('Sync timeout')), 5000);
      });

      expect(provider.isSynced).toBe(true);
      doc.getText('content').insert(0, 'Origin verified successfully');
      expect(doc.getText('content').toString()).toBe('Origin verified successfully');
    });

    it('enforces onLoadDocument RBAC to reject readers from loading draft-private-* documents', async () => {
      instance = await createCollabServer({ port: 0, quiet: true });
      const { url } = await instance.listen();

      // Reader attempts to connect to private draft
      const readerDoc = new Y.Doc();
      const readerProvider = new HocuspocusProvider({
        url,
        name: 'draft-private-confidential-board-minutes',
        document: readerDoc,
        token: 'token-reader-bob',
        WebSocketPolyfill: WebSocket as any,
      });
      providersToClean.push(readerProvider);

      const readerBlocked = await new Promise<boolean>((resolve) => {
        readerProvider.on('authenticationFailed', () => resolve(true));
        readerProvider.on('close', () => resolve(true));
        setTimeout(() => resolve(false), 5000);
      });
      expect(readerBlocked).toBe(true);

      // Author connects to the same private draft -> allowed
      const authorDoc = new Y.Doc();
      const authorProvider = new HocuspocusProvider({
        url,
        name: 'draft-private-confidential-board-minutes',
        document: authorDoc,
        token: 'token-author-alice',
        WebSocketPolyfill: WebSocket as any,
      });
      providersToClean.push(authorProvider);

      await new Promise<void>((resolve, reject) => {
        authorProvider.on('synced', () => resolve());
        setTimeout(() => reject(new Error('Author should be allowed')), 5000);
      });
      expect(authorProvider.isSynced).toBe(true);
    });
  });

  // =========================================================================
  // Dimension 5: Fastify /healthz Co-hosting Under Active Load & Fault Injection
  // =========================================================================
  describe('5. Fastify /healthz Co-hosting Under Concurrency & Fault Injection', () => {
    it('serves 50 concurrent /healthz requests during high-frequency active WebSocket typing with zero degradation', async () => {
      instance = await createCollabServer({ port: 0, quiet: true });
      const { port, url } = await instance.listen();

      // Start 3 background WS clients continuously typing
      const wsDocs: Y.Doc[] = [];
      for (let i = 0; i < 3; i++) {
        const doc = new Y.Doc();
        wsDocs.push(doc);
        const p = new HocuspocusProvider({
          url,
          name: `post-health-ws-${i}`,
          document: doc,
          token: `token-author-${i}`,
          WebSocketPolyfill: WebSocket as any,
        });
        providersToClean.push(p);
      }

      await Promise.all(
        providersToClean.map(
          (p) =>
            new Promise<void>((resolve) => {
              p.on('synced', () => resolve());
            }),
        ),
      );

      let wsActive = true;
      const wsWritingPromise = (async () => {
        let counter = 0;
        while (wsActive) {
          for (let i = 0; i < wsDocs.length; i++) {
            wsDocs[i].getText('content').insert(wsDocs[i].getText('content').length, `${counter % 10}`);
          }
          counter++;
          await new Promise((r) => setTimeout(r, 20));
        }
      })();

      // Simultaneously fire 50 concurrent HTTP GET requests to /healthz
      const httpPromises = Array.from({ length: 50 }, async (_, idx) => {
        const start = Date.now();
        const res = await fetch(`http://127.0.0.1:${port}/healthz`);
        const duration = Date.now() - start;
        expect(res.status).toBe(200);
        const body: any = await res.json();
        expect(body.status).toBe('healthy');
        expect(body.service).toBe('enterprise-blogger-collab');
        expect(body.checks.database).toContain('in-memory');
        expect(body.checks.hocuspocus).toContain('active');
        return duration;
      });

      const latencies = await Promise.all(httpPromises);
      wsActive = false;
      await wsWritingPromise;

      // Assert all 50 requests completed successfully and average latency is snappy
      expect(latencies.length).toBe(50);
      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      expect(avgLatency).toBeLessThan(500); // Less than 500ms average across 50 concurrent requests
    });

    it('returns HTTP 503 and status "unhealthy" when database health check fails', async () => {
      // Mock PostgresPersistenceAdapter that fails on pool query
      const mockPool: any = {
        query: async (sql: string) => {
          if (sql === 'SELECT 1;') {
            throw new Error('Connection terminated unexpectedly');
          }
          return { rows: [] };
        },
        end: async () => {},
      };

      const failingAdapter = new PostgresPersistenceAdapter({ pool: mockPool });

      instance = await createCollabServer({
        port: 0,
        adapter: failingAdapter,
        quiet: true,
      });

      const { port } = await instance.listen();

      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(res.status).toBe(503);

      const body: any = await res.json();
      expect(body.status).toBe('unhealthy');
      expect(body.checks.database).toContain('error: Connection terminated unexpectedly');
    });
  });

  // =========================================================================
  // Dimension 6: Postgres Bytea Persistence Robustness & Parameterized Query Defense
  // =========================================================================
  describe('6. Postgres Bytea Persistence Robustness & Parameterized Query Defense', () => {
    function setupPgMem() {
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
        VALUES ('00000000-0000-0000-0000-000000000001', 'admin@blogger.corp.internal', 'Admin', 'admin');

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

      const pool = new (db.adapters.createPg().Pool)();
      return { db, pool, adapter: new PostgresPersistenceAdapter({ pool, tableName: 'posts' }) };
    }

    it('immunizes against SQL injection payloads embedded in document names', async () => {
      const { adapter, pool } = setupPgMem();
      try {
        const hostileDocName = "post-exploit'; DROP TABLE posts; --";
        const doc = new Y.Doc();
        doc.getText('content').insert(0, 'Injection payload should be safely parameterized');
        const state = Y.encodeStateAsUpdate(doc);

        // Store with hostile document name
        await adapter.store(hostileDocName, state, doc);

        // Verify table still exists and data was persisted losslessly
        const fetched = await adapter.fetch(hostileDocName);
        expect(fetched).not.toBeNull();

        const recovered = new Y.Doc();
        Y.applyUpdate(recovered, fetched!);
        expect(recovered.getText('content').toString()).toBe(
          'Injection payload should be safely parameterized',
        );

        // Ensure table was NOT dropped
        const check = await pool.query('SELECT COUNT(*) FROM posts;');
        expect(parseInt(check.rows[0].count, 10)).toBe(1);
      } finally {
        await adapter.destroy();
      }
    });

    it('safely handles unicode, emoji, and path-like characters in document names', async () => {
      const { adapter } = setupPgMem();
      try {
        const unicodeDocName = 'post-🚀-Enterprise-Blogger-深度测试-2026/04/17';
        const doc = new Y.Doc();
        doc.getText('content').insert(0, 'Unicode binary payload');
        const state = Y.encodeStateAsUpdate(doc);

        await adapter.store(unicodeDocName, state, doc);

        const fetched = await adapter.fetch(unicodeDocName);
        expect(fetched).not.toBeNull();

        const recovered = new Y.Doc();
        Y.applyUpdate(recovered, fetched!);
        expect(recovered.getText('content').toString()).toBe('Unicode binary payload');
      } finally {
        await adapter.destroy();
      }
    });

    it('gracefully degrades to null working_markdown when doc structure is non-ProseMirror compatible', async () => {
      const { adapter, pool } = setupPgMem();
      try {
        const doc = new Y.Doc();
        // Insert custom maps and arrays instead of ProseMirror XML fragment
        doc.getMap('custom_key').set('val', 12345);
        doc.getArray('items').insert(0, ['alpha', 'beta']);
        const state = Y.encodeStateAsUpdate(doc);

        const docName = 'post-non-pm-structure';
        await adapter.store(docName, state, doc);

        // Binary update was successfully stored
        const fetched = await adapter.fetch(docName);
        expect(fetched).not.toBeNull();

        const recovered = new Y.Doc();
        Y.applyUpdate(recovered, fetched!);
        expect(recovered.getMap('custom_key').get('val')).toBe(12345);

        // Database row has empty string or null working_markdown rather than throwing error
        const row = await pool.query('SELECT working_markdown FROM posts WHERE slug = $1;', [docName]);
        expect(['', null]).toContain(row.rows[0].working_markdown);
      } finally {
        await adapter.destroy();
      }
    });
  });

  // =========================================================================
  // Dimension 7: Auth Hook Robustness Under Malformed Payloads & Missing Origin Edge Cases
  // =========================================================================
  describe('7. Auth Hook Robustness Under Malformed Payloads & Missing Origin Edge Cases', () => {
    it('catches non-string token inputs (numbers, objects) and rejects connection', async () => {
      const auth = createAuthHooks();

      // Test numeric token
      await expect(
        auth.onAuthenticate({
          token: 12345 as any,
          connectionConfig: {} as any,
          documentName: 'post-test',
        } as any),
      ).rejects.toThrow();

      // Test object token
      await expect(
        auth.onAuthenticate({
          token: { secret: 'forged' } as any,
          connectionConfig: {} as any,
          documentName: 'post-test',
        } as any),
      ).rejects.toThrow();
    });

    it('documents allowlist behavior when client omits Origin header (native/backend clients)', async () => {
      // When allowedOrigins is configured with a strict whitelist without '*'
      const auth = createAuthHooks({
        allowedOrigins: ['https://cms.enterprise.corp'],
      });

      // A request that provides NO origin header (e.g. native client, curl, backend service)
      const payload: any = {
        requestHeaders: new Headers(), // No 'origin' header
        token: 'token-author-alice',
        connectionConfig: { readOnly: false, isAuthenticated: false },
        context: {},
        documentName: 'post-1',
      };

      // By design in createAuthHooks line 29:
      // "if (origin && !allowedOrigins.includes('*') && !allowedOrigins.includes(origin))"
      // When origin is absent (falsy), non-browser clients are permitted.
      const result = await auth.onAuthenticate(payload);
      expect(result.user.role).toBe('author');
      expect(payload.connectionConfig.readOnly).toBe(false);
    });
  });
});

