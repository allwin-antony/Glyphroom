import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { createCollabServer, type CollabServerInstance } from '../src/server.js';
import { InMemoryPersistenceAdapter } from '../src/persistence/in-memory.js';

describe('Flush Debouncing & Graceful Shutdown Suite', () => {
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

  it('coalesces rapid keystrokes within debounce window and flushes after inactivity', async () => {
    let storeCallCount = 0;
    const baseAdapter = new InMemoryPersistenceAdapter();
    const trackingAdapter = {
      ...baseAdapter,
      async store(docName: string, state: Uint8Array, doc?: Y.Doc) {
        storeCallCount++;
        return baseAdapter.store(docName, state, doc);
      },
      fetch: baseAdapter.fetch.bind(baseAdapter),
      destroy: baseAdapter.destroy.bind(baseAdapter),
    };

    instance = await createCollabServer({
      port: 0,
      adapter: trackingAdapter,
      debounceMs: 300,
      maxDebounceMs: 2000,
      quiet: true,
    });

    const { url } = await instance.listen();

    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url,
      name: 'post-debounce-test',
      document: doc,
      token: 'token-author-alice',
      WebSocketPolyfill: WebSocket as any,
    });
    providersToClean.push(provider);

    await new Promise<void>((resolve) => provider.on('synced', () => resolve()));

    // Rapid edits within 100ms
    doc.getText('content').insert(0, 'A');
    await new Promise((r) => setTimeout(r, 30));
    doc.getText('content').insert(1, 'B');
    await new Promise((r) => setTimeout(r, 30));
    doc.getText('content').insert(2, 'C');

    // At 100ms, debounce (300ms) must NOT have triggered yet
    expect(storeCallCount).toBe(0);

    // Wait for inactivity debounce to fire (> 350ms after last keystroke)
    await new Promise((r) => setTimeout(r, 450));

    expect(storeCallCount).toBeGreaterThanOrEqual(1);

    // Verify persisted state contains 'ABC'
    const persisted = await trackingAdapter.fetch('post-debounce-test');
    expect(persisted).not.toBeNull();
    const recovered = new Y.Doc();
    Y.applyUpdate(recovered, persisted!);
    expect(recovered.getText('content').toString()).toBe('ABC');
  });

  it('forces execution when continuous updates hit maxDebounce ceiling', async () => {
    let storeCallCount = 0;
    const baseAdapter = new InMemoryPersistenceAdapter();
    const trackingAdapter = {
      ...baseAdapter,
      async store(docName: string, state: Uint8Array, doc?: Y.Doc) {
        storeCallCount++;
        return baseAdapter.store(docName, state, doc);
      },
      fetch: baseAdapter.fetch.bind(baseAdapter),
      destroy: baseAdapter.destroy.bind(baseAdapter),
    };

    instance = await createCollabServer({
      port: 0,
      adapter: trackingAdapter,
      debounceMs: 300,
      maxDebounceMs: 500, // Hard ceiling at 500ms
      quiet: true,
    });

    const { url } = await instance.listen();

    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url,
      name: 'post-max-debounce-test',
      document: doc,
      token: 'token-author-alice',
      WebSocketPolyfill: WebSocket as any,
    });
    providersToClean.push(provider);

    await new Promise<void>((resolve) => provider.on('synced', () => resolve()));

    // Continually type every 100ms for 700ms (resets 300ms debounce constantly)
    for (let i = 0; i < 7; i++) {
      doc.getText('content').insert(i, `${i}`);
      await new Promise((r) => setTimeout(r, 100));
    }

    // maxDebounce (500ms) must have forced at least one store despite continuous typing
    expect(storeCallCount).toBeGreaterThanOrEqual(1);
  });

  it('guarantees zero data loss on graceful server.destroy() by immediately flushing pending debounced updates', async () => {
    const adapter = new InMemoryPersistenceAdapter();

    instance = await createCollabServer({
      port: 0,
      adapter,
      debounceMs: 5000, // 5 second long debounce
      maxDebounceMs: 15000,
      quiet: true,
    });

    const { url } = await instance.listen();

    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url,
      name: 'post-graceful-flush-test',
      document: doc,
      token: 'token-author-alice',
      WebSocketPolyfill: WebSocket as any,
    });
    providersToClean.push(provider);

    await new Promise<void>((resolve) => provider.on('synced', () => resolve()));

    // Type content that is scheduled for a 5-second debounce
    doc.getText('content').insert(0, 'Critical Unpersisted Edit Prior To Shutdown');

    // Allow 100ms for websocket packet to reach server memory
    await new Promise((r) => setTimeout(r, 100));

    // Confirm that due to 5s debounce, persistence has NOT yet received it
    const beforeDestroy = await adapter.fetch('post-graceful-flush-test');
    expect(beforeDestroy).toBeNull();

    // Trigger graceful shutdown
    await instance.destroy();
    instance = null; // Mark cleaned up

    // Persistence MUST now have received the flushed update immediately
    const afterDestroy = await adapter.fetch('post-graceful-flush-test');
    expect(afterDestroy).not.toBeNull();

    const recovered = new Y.Doc();
    Y.applyUpdate(recovered, afterDestroy!);
    expect(recovered.getText('content').toString()).toBe(
      'Critical Unpersisted Edit Prior To Shutdown',
    );
  });
});
