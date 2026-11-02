import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { exportDerivedMarkdown } from '@enterprise-blogger/shared';
import { createCollabServer, type CollabServerInstance } from '../src/server.js';
import { InMemoryPersistenceAdapter } from '../src/persistence/in-memory.js';
import type { DocumentPersistenceAdapter } from '../src/persistence/adapter.js';
import { decodeDocumentState, documentFingerprint, DocumentLifecycle } from '../src/document-lifecycle.js';

const room = 'post-11111111-2222-3333-4444-555555555555';
const secret = 'lifecycle-configured-test-secret';
const editor = { id: 'fixture-editor', role: 'author', name: 'Fixture editor', permissions: ['edit'] };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function content(text: string) {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText(text)]);
  doc.getXmlFragment('prosemirror').insert(0, [paragraph]);
  return doc;
}

function markdown(doc: Y.Doc): string {
  const fragment = doc.share.has('prosemirror') ? 'prosemirror' : doc.share.has('default') ? 'default' : 'prosemirror';
  return exportDerivedMarkdown(yDocToProsemirrorJSON(doc, fragment) as any);
}

class ControlledAdapter extends InMemoryPersistenceAdapter {
  failStore = false;
  failTombstone = false;
  nextStoreGate?: ReturnType<typeof deferred>;
  storeEntered = deferred();
  tombstoneGate?: ReturnType<typeof deferred>;
  tombstoneEntered = deferred();
  stores: Array<{ state: Uint8Array; markdown?: string }> = [];
  storeAttempts = 0;
  tombstoneCalls = 0;

  override async store(name: string, state: Uint8Array, doc?: Y.Doc) {
    this.storeAttempts++;
    const gate = this.nextStoreGate;
    this.nextStoreGate = undefined;
    this.storeEntered.resolve();
    if (gate) await gate.promise;
    if (this.failStore) throw new Error('private content and credentials from driver');
    this.stores.push({ state: new Uint8Array(state), markdown: doc ? markdown(doc) : undefined });
    await super.store(name, state, doc);
  }

  override async tombstone(name: string) {
    this.tombstoneCalls++;
    this.tombstoneEntered.resolve();
    if (this.tombstoneGate) await this.tombstoneGate.promise;
    if (this.failTombstone) throw new Error('private tombstone driver error');
    await super.tombstone(name);
  }
}

describe('Single-instance document lifecycle barriers', () => {
  let instance: CollabServerInstance | undefined;
  let url: string;
  const directs: any[] = [];
  const providers: HocuspocusProvider[] = [];
  const cleanup: Array<() => void> = [];

  afterEach(async () => {
    cleanup.splice(0).forEach((restore) => restore());
    providers.splice(0).forEach((provider) => provider.destroy());
    for (const connection of directs.splice(0)) await connection.disconnect({ unloadImmediately: false });
    await instance?.destroy();
    instance = undefined;
  });

  async function start(adapter: DocumentPersistenceAdapter = new InMemoryPersistenceAdapter(), debounceMs = 5000) {
    instance = await createCollabServer({
      port: 0, adapter, gatewaySecret: secret, debounceMs, maxDebounceMs: 15000, quiet: true,
      authOptions: { authenticate: async ({ token }) => {
        if (token !== 'test-editor-credential') throw new Error('Invalid test identity');
        return { ...editor, role: 'author', permissions: ['edit'] };
      } },
    });
    const address = await instance.listen();
    url = address.url;
    return instance;
  }

  async function direct(doc?: Y.Doc) {
    const connection = await instance!.server.hocuspocus.openDirectConnection(room, { user: editor });
    directs.push(connection);
    if (doc) await connection.transact((live: Y.Doc) => Y.applyUpdate(live, Y.encodeStateAsUpdate(doc)));
    return connection;
  }

  async function request(action: string, body: object = {}, suppliedSecret = secret) {
    return fetch(`http://127.0.0.1:${instance!.port}/internal/documents/${room}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gateway-secret': suppliedSecret }, body: JSON.stringify(body),
    });
  }

  function ws(doc = new Y.Doc()) {
    const provider = new HocuspocusProvider({ url, name: room, document: doc, token: 'test-editor-credential', WebSocketPolyfill: WebSocket as any });
    providers.push(provider);
    return { doc, provider };
  }

  async function denied(provider: HocuspocusProvider) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Expected quarantined room rejection')), 5000);
      provider.on('authenticationFailed', () => { clearTimeout(timer); resolve(); });
    });
    expect(provider.isSynced).toBe(false);
  }

  it('captures a coherent persisted state and Markdown, including a deleted empty canonical root over stale default content', async () => {
    const adapter = new ControlledAdapter();
    await start(adapter);
    const connection = await direct(content('Working content'));
    await connection.transact((doc: Y.Doc) => {
      const legacy = new Y.XmlElement('paragraph');
      legacy.insert(0, [new Y.XmlText('Stale default content')]);
      doc.getXmlFragment('default').insert(0, [legacy]);
      doc.getXmlFragment('prosemirror').delete(0, 1);
    });
    const response = await request('flush');
    expect(response.status).toBe(200);
    const captured: any = await response.json();
    expect(captured).toMatchObject({ success: true, inMemory: true, workingMarkdown: '', documentName: room });
    const state = new Uint8Array(Buffer.from(captured.yjsState, 'base64'));
    const doc = decodeDocumentState(state);
    expect(doc.share.has('prosemirror')).toBe(true);
    expect(doc.getXmlFragment('prosemirror').length).toBe(0);
    expect(markdown(doc)).toBe('');
    expect(documentFingerprint(doc)).toBe(captured.fingerprint);
    expect(await adapter.fetch(room)).toEqual(state);
    expect(adapter.stores.at(-1)).toEqual({ state, markdown: '' });
  });

  it('preserves merely-created empty-root presence in encoded snapshots, not only the live projection', async () => {
    await start();
    const connection = await direct();
    await connection.transact((doc: Y.Doc) => {
      const legacy = new Y.XmlElement('paragraph');
      legacy.insert(0, [new Y.XmlText('Must not reappear')]);
      doc.getXmlFragment('default').insert(0, [legacy]);
      doc.getXmlFragment('prosemirror');
    });
    const captured: any = await (await request('flush')).json();
    const decoded = decodeDocumentState(new Uint8Array(Buffer.from(captured.yjsState, 'base64')));
    expect(decoded.share.has('prosemirror')).toBe(true);
    expect(markdown(decoded)).toBe('');
    expect(captured.workingMarkdown).toBe('');
  });

  it('distinguishes successful inactivity from uninitialized servers, persistence outages, and wrong/legacy secrets', async () => {
    const base = new InMemoryPersistenceAdapter();
    await base.store(room, Y.encodeStateAsUpdate(content('Stored state')));
    let unavailable = false;
    const adapter = {
      fetch: async (name: string) => { if (unavailable) throw new Error('Driver failed'); return base.fetch(name); },
      store: base.store.bind(base), tombstone: base.tombstone.bind(base), destroy: base.destroy.bind(base),
    };
    await start(adapter);
    const inactive = await request('flush');
    expect(inactive.status).toBe(200);
    expect(await inactive.json()).toEqual({ success: true, inMemory: false, documentName: room });
    for (const wrong of ['wrong', 'blogger_gateway_secret_key_32bytes', 'REPLACE_WITH_STRONG_GATEWAY_SECRET']) {
      const response = await request('flush', {}, wrong);
      expect(response.status).toBe(401);
      expect((await response.json()).success).toBe(false);
    }
    unavailable = true;
    cleanup.push(() => { unavailable = false; });
    const failed = await request('flush');
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ success: false, code: 'PERSISTENCE_FAILED' });
    await expect(new DocumentLifecycle(() => null, base).capture(room)).rejects.toMatchObject({ code: 'UNAVAILABLE', statusCode: 503 });
  });

  it('does not report a successful live flush when persistence fails or disclose driver values', async () => {
    const adapter = new ControlledAdapter();
    await start(adapter);
    await direct(content('Private current state'));
    adapter.failStore = true;
    cleanup.push(() => { adapter.failStore = false; });
    const response = await request('flush');
    expect(response.status).toBe(503);
    const data: any = await response.json();
    expect(data).toMatchObject({ success: false, code: 'PERSISTENCE_FAILED' });
    expect(data.inMemory).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain('private content and credentials');
  });

  it('restores causally in the existing live Y.Doc and persists/returns actual state rather than historical bytes', async () => {
    const adapter = new ControlledAdapter();
    await start(adapter);
    const history = content('Historical checkpoint');
    const target = Y.encodeStateAsUpdate(history);
    const text = history.getXmlFragment('prosemirror').get(0) as Y.XmlElement;
    const leaf = text.get(0) as Y.XmlText;
    leaf.delete(0, leaf.length);
    leaf.insert(0, 'Current safety checkpoint');
    const connection = await direct(history);
    const live = connection.document;
    const captured: any = await (await request('flush')).json();
    const oldReplica = decodeDocumentState(new Uint8Array(Buffer.from(captured.yjsState, 'base64')));
    const response = await request('restore', { yjsState: Buffer.from(target).toString('base64'), expectedCurrentFingerprint: captured.fingerprint });
    expect(response.status).toBe(200);
    const restored: any = await response.json();
    expect(connection.document).toBe(live);
    expect(restored).toMatchObject({ success: true, inMemory: true, workingMarkdown: 'Historical checkpoint' });
    const actual = new Uint8Array(Buffer.from(restored.yjsState, 'base64'));
    expect(actual).not.toEqual(target);
    expect(await adapter.fetch(room)).toEqual(actual);
    expect(Y.encodeStateAsUpdate(live)).toEqual(actual);
    expect(adapter.stores.at(-1)?.markdown).toBe('Historical checkpoint');
    const merged = decodeDocumentState(actual);
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(oldReplica));
    expect(markdown(merged)).toBe('Historical checkpoint');
    const reconnect = ws(oldReplica);
    await synced(reconnect.provider);
    await expect.poll(() => markdown(oldReplica)).toBe('Historical checkpoint');
    await expect.poll(() => markdown(live)).toBe('Historical checkpoint');
    oldReplica.getMap('future-edits').set('editor-can-still-edit', true);
    await expect.poll(() => live.getMap('future-edits').get('editor-can-still-edit')).toBe(true);
  });

  it('detects deletion-only fingerprint conflicts without overwriting newer live content', async () => {
    await start();
    const connection = await direct(content('Current content'));
    const captured: any = await (await request('flush')).json();
    const vector = Y.encodeStateVector(connection.document);
    await connection.transact((doc: Y.Doc) => doc.getXmlFragment('prosemirror').delete(0, 1));
    expect(Y.encodeStateVector(connection.document)).toEqual(vector);
    const newer = Y.encodeStateAsUpdate(connection.document);
    const response = await request('restore', { yjsState: Buffer.from(Y.encodeStateAsUpdate(content('Target'))).toString('base64'), expectedCurrentFingerprint: captured.fingerprint });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, code: 'CONFLICT', outcomeUnknown: false });
    expect(Y.encodeStateAsUpdate(connection.document)).toEqual(newer);
    expect(markdown(connection.document)).toBe('');
  });

  it('restores historical default content into the existing canonical root, rather than leaving newer prosemirror content behind', async () => {
    await start();
    const connection = await direct(content('Current canonical content'));
    const target = new Y.Doc();
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText('Historical legacy checkpoint')]);
    target.getXmlFragment('default').insert(0, [paragraph]);
    const capture: any = await (await request('flush')).json();
    const response = await request('restore', { yjsState: Buffer.from(Y.encodeStateAsUpdate(target)).toString('base64'), expectedCurrentFingerprint: capture.fingerprint });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ workingMarkdown: 'Historical legacy checkpoint' });
    expect(connection.document.getXmlFragment('prosemirror').toString()).toContain('Historical legacy checkpoint');
    expect(markdown(connection.document)).toBe('Historical legacy checkpoint');
  });

  it('restores an empty historical canonical root even when that target also has stale nonempty default content', async () => {
    await start();
    const connection = await direct(content('Current content to remove'));
    const target = content('Historical canonical text later deleted');
    const legacy = new Y.XmlElement('paragraph');
    legacy.insert(0, [new Y.XmlText('Stale historical default content')]);
    target.getXmlFragment('default').insert(0, [legacy]);
    target.getXmlFragment('prosemirror').delete(0, 1);
    const capture: any = await (await request('flush')).json();
    const response = await request('restore', { yjsState: Buffer.from(Y.encodeStateAsUpdate(target)).toString('base64'), expectedCurrentFingerprint: capture.fingerprint });
    expect(response.status).toBe(200);
    const restored: any = await response.json();
    expect(restored.workingMarkdown).toBe('');
    expect(markdown(connection.document)).toBe('');
    const actual = decodeDocumentState(new Uint8Array(Buffer.from(restored.yjsState, 'base64')));
    Y.applyUpdate(actual, new Uint8Array(Buffer.from(capture.yjsState, 'base64')));
    expect(actual.getXmlFragment('prosemirror').length).toBe(0);
    expect(markdown(actual)).toBe('');
  });

  it('serializes capture persistence with queued mutations and rejects restore against that now-stale capture', async () => {
    const adapter = new ControlledAdapter();
    await start(adapter);
    const connection = await direct(content('Captured content'));
    const fingerprint = documentFingerprint(connection.document);
    const releaseStore = deferred();
    adapter.nextStoreGate = releaseStore;
    cleanup.push(releaseStore.resolve);
    const capturedPromise = instance!.lifecycle.capture(room);
    await adapter.storeEntered.promise;
    const edit = connection.transact((doc: Y.Doc) => {
      const text = (doc.getXmlFragment('prosemirror').get(0) as Y.XmlElement).get(0) as Y.XmlText;
      text.insert(text.length, ' plus a new edit');
    });
    const restore = instance!.lifecycle.restore(room, Y.encodeStateAsUpdate(content('Target')), fingerprint);
    const conflict = expect(restore).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    releaseStore.resolve();
    const captured = await capturedPromise;
    expect(captured.inMemory).toBe(true);
    if (!captured.inMemory) throw new Error('Expected active room');
    expect(captured.workingMarkdown).toBe('Captured content');
    expect(markdown(decodeDocumentState(new Uint8Array(Buffer.from(captured.yjsState, 'base64'))))).toBe(captured.workingMarkdown);
    await edit;
    await conflict;
    expect(markdown(connection.document)).toBe('Captured content plus a new edit');
  });

  it('loads current persisted causal history for inactive restores and prevents old replicas resurrecting replaced content', async () => {
    const adapter = new ControlledAdapter();
    const current = content('Historical');
    const target = Y.encodeStateAsUpdate(current);
    const leaf = (current.getXmlFragment('prosemirror').get(0) as Y.XmlElement).get(0) as Y.XmlText;
    leaf.delete(0, leaf.length);
    leaf.insert(0, 'Current persisted safety checkpoint');
    const oldReplica = decodeDocumentState(Y.encodeStateAsUpdate(current));
    await adapter.store(room, Y.encodeStateAsUpdate(current), current);
    await start(adapter);
    const response = await request('restore', { yjsState: Buffer.from(target).toString('base64'), expectedCurrentFingerprint: documentFingerprint(current) });
    expect(response.status).toBe(200);
    const restored: any = await response.json();
    expect(restored).toMatchObject({ inMemory: false, workingMarkdown: 'Historical' });
    const actual = new Uint8Array(Buffer.from(restored.yjsState, 'base64'));
    expect(await adapter.fetch(room)).toEqual(actual);
    expect(actual).not.toEqual(target);
    const merged = decodeDocumentState(actual);
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(oldReplica));
    expect(markdown(merged)).toBe('Historical');
    const reconnect = ws(oldReplica);
    await synced(reconnect.provider);
    await expect.poll(() => markdown(oldReplica)).toBe('Historical');
    await expect.poll(() => markdown(instance!.server.hocuspocus.documents.get(room)!)).toBe('Historical');
  });

  it('refuses stale inactive fingerprints and invalid/missing restore states without changing persistent state', async () => {
    const adapter = new InMemoryPersistenceAdapter();
    const state = Y.encodeStateAsUpdate(content('Current'));
    await adapter.store(room, state);
    await start(adapter);
    const target = Buffer.from(Y.encodeStateAsUpdate(content('Target'))).toString('base64');
    const stale = await request('restore', { yjsState: target, expectedCurrentFingerprint: '0'.repeat(64) });
    expect(stale.status).toBe(409);
    for (const body of [{}, { yjsState: target }, { yjsState: 'bad base64!', expectedCurrentFingerprint: '0'.repeat(64) }, { yjsState: Buffer.from('invalid update').toString('base64'), expectedCurrentFingerprint: '0'.repeat(64) }]) {
      expect((await request('restore', body)).status).toBe(400);
    }
    expect(await adapter.fetch(room)).toEqual(state);
  });

  it('quarantines a failed live restore rather than claiming success, unsafe rollback, or allowing continued sync', async () => {
    const adapter = new ControlledAdapter();
    await start(adapter);
    const connection = await direct(content('Current safety state'));
    const capture: any = await (await request('flush')).json();
    const safety = await adapter.fetch(room);
    adapter.failStore = true;
    cleanup.push(() => { adapter.failStore = false; });
    const response = await request('restore', { yjsState: Buffer.from(Y.encodeStateAsUpdate(content('Target'))).toString('base64'), expectedCurrentFingerprint: capture.fingerprint });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, code: 'PERSISTENCE_FAILED', outcomeUnknown: true });
    expect(instance!.server.hocuspocus.documents.get(room)).toBe(connection.document);
    expect(markdown(connection.document)).toBe('Target');
    expect(await adapter.fetch(room)).toEqual(safety);
    await expect(connection.transact(() => {})).rejects.toMatchObject({ code: 'DOCUMENT_QUARANTINED' });
    expect((await request('flush')).status).toBe(503);
    await denied(ws().provider);
  });

  it('retains dirty rooms after failed normal stores and last-editor disconnect, then captures the real live state after recovery', async () => {
    const adapter = new ControlledAdapter();
    await start(adapter, 10);
    const connection = await direct(content('Persisted baseline'));
    await request('flush');
    const document = connection.document;
    const stored = await adapter.fetch(room);
    const before = adapter.storeAttempts;
    adapter.failStore = true;
    cleanup.push(() => { adapter.failStore = false; });
    await connection.transact((doc: Y.Doc) => {
      const leaf = (doc.getXmlFragment('prosemirror').get(0) as Y.XmlElement).get(0) as Y.XmlText;
      leaf.insert(leaf.length, ' plus unsaved edit');
    });
    await expect.poll(() => adapter.storeAttempts).toBeGreaterThan(before);
    await connection.disconnect({ unloadImmediately: false });
    await instance!.server.hocuspocus.unloadDocument(document);
    expect(instance!.server.hocuspocus.documents.get(room)).toBe(document);
    expect(await adapter.fetch(room)).toEqual(stored);
    adapter.failStore = false;
    const capture: any = await (await request('flush')).json();
    expect(capture).toMatchObject({ success: true, inMemory: true, workingMarkdown: 'Persisted baseline plus unsaved edit' });
    expect(await adapter.fetch(room)).toEqual(new Uint8Array(Buffer.from(capture.yjsState, 'base64')));
  });

  it('awaits an in-flight debounced store and asynchronous tombstone before eviction; delayed stores cannot recreate the room', async () => {
    const adapter = new ControlledAdapter();
    const pendingStore = deferred();
    const pendingTombstone = deferred();
    adapter.nextStoreGate = pendingStore;
    adapter.tombstoneGate = pendingTombstone;
    cleanup.push(pendingStore.resolve, pendingTombstone.resolve);
    await start(adapter, 10);
    const connection = await direct(content('Pending live state'));
    const oldDocument = connection.document;
    await adapter.storeEntered.promise;
    let acknowledged = false;
    const deleting = instance!.lifecycle.tombstone(room).then((result) => { acknowledged = true; return result; });
    const mutation = expect(connection.transact(() => { throw new Error('Mutation must never run'); })).rejects.toMatchObject({ code: 'DOCUMENT_QUARANTINED' });
    await denied(ws().provider);
    expect(acknowledged).toBe(false);
    expect(instance!.server.hocuspocus.documents.has(room)).toBe(true);
    pendingStore.resolve();
    await adapter.tombstoneEntered.promise;
    expect(acknowledged).toBe(false);
    expect(instance!.server.hocuspocus.documents.has(room)).toBe(true);
    pendingTombstone.resolve();
    await expect(deleting).resolves.toEqual({ success: true, tombstoned: true, documentName: room });
    await mutation;
    expect(instance!.server.hocuspocus.documents.has(room)).toBe(false);
    expect(oldDocument.isDestroyed).toBe(true);
    const storesAtBarrier = adapter.stores.length;
    await instance!.server.hocuspocus.storeDocumentHooks(oldDocument, { document: oldDocument, documentName: room, instance: instance!.server.hocuspocus, clientsCount: 0, lastContext: {} } as any, true);
    expect(adapter.stores).toHaveLength(storesAtBarrier);
    expect(await adapter.fetch(room)).toBeNull();
    await expect(instance!.server.hocuspocus.openDirectConnection(room, { user: editor })).rejects.toMatchObject({ code: 'DOCUMENT_QUARANTINED' });
  });

  it.each(['store', 'tombstone'])('keeps failed %s deletion quarantined with durable state and supports a safe awaited retry', async (failure) => {
    const adapter = new ControlledAdapter();
    await start(adapter);
    const connection = await direct(content('Current state before deletion'));
    await request('flush');
    const durable = await adapter.fetch(room);
    adapter.failStore = failure === 'store';
    adapter.failTombstone = failure === 'tombstone';
    cleanup.push(() => { adapter.failStore = false; adapter.failTombstone = false; });
    const failed = await request('tombstone');
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ success: false, code: 'PERSISTENCE_FAILED' });
    expect(instance!.server.hocuspocus.documents.get(room)).toBe(connection.document);
    expect(await adapter.fetch(room)).toEqual(durable);
    await expect(connection.transact(() => {})).rejects.toMatchObject({ code: 'DOCUMENT_QUARANTINED' });
    await denied(ws().provider);
    const edit = await fetch(`http://127.0.0.1:${instance!.port}/internal/agent-gateway/edit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gateway-secret': secret, 'x-user-id': 'editor', 'x-agent-id': 'agent' },
      body: JSON.stringify({ operation: 'append_section', documentId: room, content: 'Must not be applied' }),
    });
    expect(edit.status).toBe(503);
    adapter.failStore = false;
    adapter.failTombstone = false;
    const retried = await request('tombstone');
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ success: true, tombstoned: true });
    expect(instance!.server.hocuspocus.documents.has(room)).toBe(false);
    expect(await adapter.fetch(room)).toBeNull();
    const stores = adapter.stores.length;
    expect((await request('tombstone')).status).toBe(200);
    expect(adapter.stores).toHaveLength(stores);
  });

  it('does not install an in-flight room load after deletion acknowledgement', async () => {
    const base = new InMemoryPersistenceAdapter();
    const loadGate = deferred();
    const entered = deferred();
    let first = true;
    cleanup.push(loadGate.resolve);
    const adapter = {
      fetch: async (name: string) => {
        if (first) { first = false; entered.resolve(); await loadGate.promise; }
        return base.fetch(name);
      },
      store: base.store.bind(base), tombstone: base.tombstone.bind(base), destroy: base.destroy.bind(base),
    };
    await start(adapter);
    const loading = direct();
    await entered.promise;
    let acknowledged = false;
    const deleting = instance!.lifecycle.tombstone(room).then(() => { acknowledged = true; });
    expect(acknowledged).toBe(false);
    loadGate.resolve();
    await expect(loading).rejects.toMatchObject({ code: 'DOCUMENT_QUARANTINED' });
    await deleting;
    expect(instance!.server.hocuspocus.documents.has(room)).toBe(false);
    await expect(instance!.server.hocuspocus.openDirectConnection(room, { user: editor })).rejects.toMatchObject({ code: 'DOCUMENT_QUARANTINED' });
  });

  it('drains room-creation leases during shutdown before acknowledging persistence and eviction', async () => {
    await start();
    const engine = instance!.server.hocuspocus;
    const pause = deferred();
    const entered = deferred();
    cleanup.push(pause.resolve);
    const creating = instance!.lifecycle.runMutation(room, async () => {
      entered.resolve();
      await pause.promise;
      const document = await engine.loadDocument(room, new Request('http://collab.test'), 'creation-lease', { isAuthenticated: true, readOnly: false }, { user: editor });
      engine.documents.set(room, document);
      return document;
    });
    await entered.promise;
    let acknowledged = false;
    const shuttingDown = instance!.destroy().then(() => { acknowledged = true; });
    expect(acknowledged).toBe(false);
    pause.resolve();
    const document = await creating;
    await shuttingDown;
    expect(engine.documents.has(room)).toBe(false);
    expect(document.isDestroyed).toBe(true);
    expect(await instance!.adapter.fetch(room)).not.toBeNull();
  });

  it('does not discard current edits from a failed deletion quarantine during recovered graceful shutdown', async () => {
    const adapter = new ControlledAdapter();
    await start(adapter);
    const connection = await direct(content('Unsaved current state must survive failed deletion'));
    const live = connection.document;
    adapter.failStore = true;
    cleanup.push(() => { adapter.failStore = false; });
    expect((await request('tombstone')).status).toBe(503);
    expect(await adapter.fetch(room)).toBeNull();
    expect(instance!.server.hocuspocus.documents.get(room)).toBe(live);
    adapter.failStore = false;
    await instance!.destroy();
    expect(adapter.tombstoneCalls).toBe(0);
    const persisted = await adapter.fetch(room);
    expect(persisted).not.toBeNull();
    expect(markdown(decodeDocumentState(persisted!))).toBe('Unsaved current state must survive failed deletion');
  });

  it('safely retries an uncertain tombstone without attempting to rewrite a backend that already blocked stores', async () => {
    const base = new InMemoryPersistenceAdapter();
    let tombstoned = false;
    let first = true;
    let stores = 0;
    const adapter = {
      fetch: base.fetch.bind(base), destroy: base.destroy.bind(base),
      store: async (name: string, state: Uint8Array, doc?: Y.Doc) => {
        if (tombstoned) throw new Error('Backend already tombstoned');
        stores++;
        await base.store(name, state, doc);
      },
      tombstone: async (name: string) => {
        await base.tombstone(name);
        tombstoned = true;
        if (first) { first = false; throw new Error('Uncertain acknowledgement after backend barrier'); }
      },
    };
    await start(adapter);
    await direct(content('Persist before blocking stores'));
    expect((await request('tombstone')).status).toBe(503);
    expect(instance!.server.hocuspocus.documents.has(room)).toBe(true);
    const writesBeforeRetry = stores;
    expect((await request('tombstone')).status).toBe(200);
    expect(stores).toBe(writesBeforeRetry);
    expect(instance!.server.hocuspocus.documents.has(room)).toBe(false);
  });

  it('refuses deletion when an adapter cannot provide an awaited tombstone barrier', async () => {
    const base = new InMemoryPersistenceAdapter();
    await start({ fetch: base.fetch.bind(base), store: base.store.bind(base), destroy: base.destroy.bind(base) });
    await direct(content('Keep this room'));
    const response = await request('tombstone');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, code: 'UNAVAILABLE' });
    expect(instance!.server.hocuspocus.documents.has(room)).toBe(true);
  });
});

async function synced(provider: HocuspocusProvider): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS sync timeout')), 5000);
    provider.on('synced', () => { clearTimeout(timer); resolve(); });
    provider.on('authenticationFailed', () => { clearTimeout(timer); reject(new Error('Unexpected authentication failure')); });
  });
}
