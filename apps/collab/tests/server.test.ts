import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { createCollabServer as createServer, type CollabServerInstance, type CollabServerOptions } from '../src/server.js';
import { InMemoryPersistenceAdapter } from '../src/persistence/in-memory.js';

// Transport fixtures use explicit, server-side test identities, not runtime role tokens.
const createCollabServer = (options: CollabServerOptions = {}) => createServer({
  ...options,
  authOptions: {
    authenticate: async ({ token }) => {
      if (!['token-author-alice', 'token-author-bob', 'token-reader-bob'].includes(token ?? '')) throw new Error('Invalid test identity');
      return { id: token!, role: token === 'token-reader-bob' ? 'reader' : 'author', name: 'Fixture user', permissions: token === 'token-reader-bob' ? ['view'] : ['edit'] };
    },
    ...options.authOptions,
  },
});

describe('Collab Server & Standard WS Transport Suite', () => {
  let instance: CollabServerInstance | null = null;
  const providersToClean: HocuspocusProvider[] = [];

  afterEach(async () => {
    while (providersToClean.length > 0) {
      const p = providersToClean.pop();
      try {
        p?.destroy();
      } catch {
        // ignore
      }
    }
    if (instance) {
      await instance.destroy();
      instance = null;
    }
  });

  it('boots on port 0, accepts standard ws connection and syncs CRDT state', async () => {
    const adapter = new InMemoryPersistenceAdapter();
    instance = await createCollabServer({
      port: 0,
      adapter,
      quiet: true,
    });

    const { port, url } = await instance.listen();
    expect(port).toBeGreaterThan(0);

    // Client 1 (Author) connects and writes initial text
    const doc1 = new Y.Doc();
    const provider1 = new HocuspocusProvider({
      url,
      name: 'post-live-sync-test',
      document: doc1,
      token: 'token-author-alice',
      WebSocketPolyfill: WebSocket as any,
    });
    providersToClean.push(provider1);

    await new Promise<void>((resolve, reject) => {
      provider1.on('synced', () => resolve());
      provider1.on('close', (event: any) => reject(new Error(`Closed unexpectedly: ${event.code}`)));
      setTimeout(() => reject(new Error('Sync timeout')), 10000);
    });

    doc1.getText('content').insert(0, 'Real-time synchronization across pure ws');

    // Client 2 (Author 2) connects to the same room
    const doc2 = new Y.Doc();
    const provider2 = new HocuspocusProvider({
      url,
      name: 'post-live-sync-test',
      document: doc2,
      token: 'token-author-bob',
      WebSocketPolyfill: WebSocket as any,
    });
    providersToClean.push(provider2);

    await new Promise<void>((resolve, reject) => {
      provider2.on('synced', () => resolve());
      setTimeout(() => reject(new Error('Client 2 sync timeout')), 10000);
    });

    // Verify client 2 received the exact text from client 1
    expect(doc2.getText('content').toString()).toBe('Real-time synchronization across pure ws');
  });

  it('serves Fastify /healthz co-hosted on the exact same HTTP port', async () => {
    const signalListeners = ['SIGINT', 'SIGQUIT', 'SIGTERM'].map((signal) => process.listenerCount(signal));
    instance = await createCollabServer({
      port: 0,
      quiet: true,
    });

    const { port } = await instance.listen();
    expect(['SIGINT', 'SIGQUIT', 'SIGTERM'].map((signal) => process.listenerCount(signal))).toEqual(signalListeners);

    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);

    const body: any = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.service).toBe('enterprise-blogger-collab');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.checks).toBeDefined();
    expect(body.checks.database).toContain('in-memory');
    expect(body.checks.hocuspocus).toContain('active');
    expect(body.checks.redis).toBe('disabled');
  });

  it('redirects /health and /readyz aliases to /healthz', async () => {
    instance = await createCollabServer({
      port: 0,
      quiet: true,
    });

    const { port } = await instance.listen();

    const healthRes = await fetch(`http://127.0.0.1:${port}/health`, { redirect: 'manual' });
    expect([301, 302]).toContain(healthRes.status);
    expect(healthRes.headers.get('location')).toBe('/healthz');

    const readyRes = await fetch(`http://127.0.0.1:${port}/readyz`, { redirect: 'manual' });
    expect([301, 302]).toContain(readyRes.status);
    expect(readyRes.headers.get('location')).toBe('/healthz');
  });

  it('rejects readers before syncing any working state or accepting mutations', async () => {
    const adapter = new InMemoryPersistenceAdapter();
    instance = await createCollabServer({
      port: 0,
      adapter,
      debounceMs: 50,
      maxDebounceMs: 100,
      quiet: true,
    });

    const { url } = await instance.listen();

    // 1. Author seeds the document
    const authorDoc = new Y.Doc();
    const authorProvider = new HocuspocusProvider({
      url,
      name: 'post-readonly-test',
      document: authorDoc,
      token: 'token-author-alice',
      WebSocketPolyfill: WebSocket as any,
    });
    providersToClean.push(authorProvider);

    await new Promise<void>((resolve) => authorProvider.on('synced', () => resolve()));
    authorDoc.getText('content').insert(0, 'Original Content By Author');

    // Wait a brief moment for author edit to sync
    await new Promise((r) => setTimeout(r, 100));

    // 2. A validated viewer still must not receive the working CRDT.
    const readerDoc = new Y.Doc();
    const readerProvider = new HocuspocusProvider({
      url,
      name: 'post-readonly-test',
      document: readerDoc,
      token: 'token-reader-bob',
      WebSocketPolyfill: WebSocket as any,
    });
    providersToClean.push(readerProvider);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Expected authentication failure')), 5000);
      readerProvider.on('authenticationFailed', () => { clearTimeout(timer); resolve(); });
    });
    expect(readerProvider.isSynced).toBe(false);
    expect(readerDoc.getText('content').toString()).toBe('');

    // Reader attempts unauthorized mutation
    readerDoc.getText('content').insert(0, 'UNAUTHORIZED EDIT: ');

    // Allow network round trip
    await new Promise((r) => setTimeout(r, 200));

    // Authoritative author document must NOT have reader's edit applied
    expect(authorDoc.getText('content').toString()).toBe('Original Content By Author');
  });

  it('rejects unauthenticated connections without token', async () => {
    instance = await createCollabServer({
      port: 0,
      quiet: true,
    });

    const { url } = await instance.listen();

    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url,
      name: 'post-unauth-test',
      document: doc,
      WebSocketPolyfill: WebSocket as any,
      // No token provided
    });
    providersToClean.push(provider);

    const authFailed = await new Promise<boolean>((resolve) => {
      provider.on('authenticationFailed', () => resolve(true));
      provider.on('close', () => resolve(true));
      setTimeout(() => resolve(false), 5000);
    });

    expect(authFailed).toBe(true);
  });
});
