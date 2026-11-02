import { createHash } from 'node:crypto';
import type { Connection, Document, Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { DocumentIdSchema, exportDerivedMarkdown, getDocumentFragment } from '@enterprise-blogger/shared';
import type { DocumentPersistenceAdapter } from './persistence/adapter.js';

export class DocumentLifecycleError extends Error {
  constructor(
    public readonly code: 'VALIDATION_FAILED' | 'CONFLICT' | 'UNAVAILABLE' | 'PERSISTENCE_FAILED' | 'DOCUMENT_QUARANTINED',
    message: string,
    public readonly statusCode: number,
    public readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = 'DocumentLifecycleError';
  }
}

export function canonicalDocumentName(name: string): string {
  const id = name.startsWith('post-') ? name.slice(5) : name;
  const parsed = DocumentIdSchema.safeParse(id);
  if (!parsed.success) {
    throw new DocumentLifecycleError('VALIDATION_FAILED', 'Invalid document name', 400);
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  return `post-${uuid ? id.toLowerCase() : id}`;
}

export function decodeDocumentState(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  try {
    Y.decodeUpdate(state);
    Y.applyUpdate(doc, state);
    if (doc.store.pendingStructs || doc.store.pendingDs) throw new Error('Incomplete state');
    if (!Buffer.from(Y.encodeStateAsUpdate(doc)).equals(Buffer.from(state))) throw new Error('Noncanonical state');
    return doc;
  } catch {
    doc.destroy();
    throw new DocumentLifecycleError('VALIDATION_FAILED', 'Invalid Yjs document state', 400);
  }
}

export function documentFingerprint(doc: Y.Doc): string {
  // A state vector omits deletions. Hash the complete, canonical encoded state.
  return createHash('sha256').update(Y.encodeStateAsUpdate(doc)).digest('hex');
}

function snapshotDocument(doc: Y.Doc) {
  const fragmentName = doc.share.has('prosemirror') ? 'prosemirror'
    : doc.share.has('default') ? 'default' : 'prosemirror';
  const fragment = getDocumentFragment(doc);

  // Yjs does not encode a merely-created empty root. Preserve its presence with
  // a content-neutral tombstone, so an empty canonical root cannot become stale
  // legacy `default` content when this snapshot is decoded on restore/reconnect.
  if (fragment.length === 0) {
    const encoded = decodeDocumentState(Y.encodeStateAsUpdate(doc));
    const hasRoot = encoded.share.has(fragmentName);
    encoded.destroy();
    if (!hasRoot) {
      doc.transact(() => {
        fragment.insert(0, [new Y.XmlElement('paragraph')]);
        fragment.delete(0, 1);
      }, 'lifecycle-empty-fragment');
    }
  }

  const state = Y.encodeStateAsUpdate(doc);
  const workingMarkdown = exportDerivedMarkdown(yDocToProsemirrorJSON(doc, fragmentName) as any);
  return {
    state,
    yjsState: Buffer.from(state).toString('base64'),
    workingMarkdown,
    fingerprint: createHash('sha256').update(state).digest('hex'),
  };
}

interface Gate {
  tail: Promise<void>;
  pending: number;
  status?: 'deleting' | 'quarantined' | 'deleted';
  deletion?: Promise<{ success: true; tombstoned: true; documentName: string }>;
  deletionStatePersisted?: boolean;
}

/** One process owns each canonical room, its mutations, and its persistence. */
export class DocumentLifecycle {
  private readonly gates = new Map<string, Gate>();
  private readonly messageReleases = new WeakMap<Connection, () => void>();
  private readonly failedStores = new WeakSet<Y.Doc>();
  private stopping = false;

  constructor(
    private readonly getServer: () => Server | null,
    private readonly adapter: DocumentPersistenceAdapter,
  ) {}

  private gate(name: string): Gate {
    let gate = this.gates.get(name);
    if (!gate) {
      gate = { tail: Promise.resolve(), pending: 0 };
      this.gates.set(name, gate);
    }
    return gate;
  }

  assertAvailable(documentName: string): void {
    if (this.stopping || this.gates.get(canonicalDocumentName(documentName))?.status) {
      throw new DocumentLifecycleError('DOCUMENT_QUARANTINED', 'Document collaboration is unavailable', 503);
    }
  }

  private async acquire(documentName: string, allowBlocked = false): Promise<() => void> {
    const name = canonicalDocumentName(documentName);
    const gate = this.gate(name);
    const previous = gate.tail;
    let unlock!: () => void;
    gate.tail = new Promise<void>((resolve) => { unlock = resolve; });
    gate.pending++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      gate.pending--;
      unlock();
      if (gate.pending === 0 && !gate.status) this.gates.delete(name);
    };
    await previous;
    if (!allowBlocked) {
      try {
        this.assertAvailable(name);
      } catch (error) {
        release();
        throw error;
      }
    }
    return release;
  }

  private async run<T>(name: string, operation: () => Promise<T>, allowBlocked = false): Promise<T> {
    const release = await this.acquire(name, allowBlocked);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  runMutation<T>(name: string, operation: () => Promise<T>): Promise<T> {
    return this.run(name, operation);
  }

  async beforeMessage(name: string, connection: Connection, document: Document): Promise<void> {
    const release = await this.acquire(name);
    if (document.isDestroyed || this.getServer()?.hocuspocus.documents.get(document.name) !== document) {
      release();
      throw new DocumentLifecycleError('DOCUMENT_QUARANTINED', 'Document collaboration is unavailable', 503);
    }
    this.messageReleases.set(connection, release);
  }

  afterMessage(connection: Connection): void {
    this.messageReleases.get(connection)?.();
    this.messageReleases.delete(connection);
  }

  async unload(document: Document, operation: () => Promise<any>): Promise<void> {
    await this.run(document.name, async () => {
      if (!this.stopping && !this.gates.get(canonicalDocumentName(document.name))?.status
        && !this.failedStores.has(document)) await operation();
    }, true);
  }

  private server(): Server {
    const server = this.getServer();
    if (!server) throw new DocumentLifecycleError('UNAVAILABLE', 'Collaboration server is unavailable', 503);
    return server;
  }

  private async persist(name: string, document: Y.Doc, state: Uint8Array): Promise<void> {
    try {
      await this.adapter.store(name, state, document);
      this.failedStores.delete(document);
    } catch {
      this.failedStores.add(document);
      // Do not expose driver errors, SQL values, document content, or credentials.
      throw new DocumentLifecycleError('PERSISTENCE_FAILED', 'Document persistence failed', 503);
    }
  }

  private snapshot(document: Y.Doc): ReturnType<typeof snapshotDocument> {
    try {
      return snapshotDocument(document);
    } catch {
      this.failedStores.add(document);
      throw new DocumentLifecycleError('PERSISTENCE_FAILED', 'Document snapshot failed', 503);
    }
  }

  async store(documentName: string, document: Document): Promise<void> {
    await this.run(documentName, async () => {
      if (this.stopping || this.gates.get(canonicalDocumentName(documentName))?.status) return;
      if (document.isDestroyed || this.server().hocuspocus.documents.get(documentName) !== document) return;
      // Encode inside the gate, not before waiting on a prior store or restore.
      const snapshot = this.snapshot(document);
      await this.persist(documentName, document, snapshot.state);
    }, true);
  }

  async capture(documentName: string) {
    const name = canonicalDocumentName(documentName);
    return this.run(name, async () => {
      const document = this.server().hocuspocus.documents.get(name);
      if (!document) {
        try {
          await this.adapter.fetch(name);
        } catch {
          throw new DocumentLifecycleError('PERSISTENCE_FAILED', 'Document persistence is unavailable', 503);
        }
        return { success: true as const, inMemory: false as const, documentName: name };
      }
      const { state, ...snapshot } = this.snapshot(document);
      await this.persist(name, document, state);
      return { success: true as const, inMemory: true as const, documentName: name, ...snapshot };
    });
  }

  async restore(documentName: string, state: Uint8Array, expectedCurrentFingerprint: string) {
    if (!/^[0-9a-f]{64}$/.test(expectedCurrentFingerprint)) {
      throw new DocumentLifecycleError('VALIDATION_FAILED', 'Expected current fingerprint is required', 400);
    }
    const target = decodeDocumentState(state);
    const name = canonicalDocumentName(documentName);
    try {
      return await this.run(name, async () => {
        const server = this.server();
        const active = server.hocuspocus.documents.get(name);
        let current: Y.Doc;
        try {
          const persisted = active ? null : await this.adapter.fetch(name);
          current = active ?? (persisted ? decodeDocumentState(persisted) : new Y.Doc());
        } catch {
          throw new DocumentLifecycleError('PERSISTENCE_FAILED', 'Current document state is unavailable', 503);
        }
        try {
          if (documentFingerprint(current) !== expectedCurrentFingerprint) {
            throw new DocumentLifecycleError('CONFLICT', 'Document changed since capture', 409);
          }
          const destination = getDocumentFragment(current);
          const content = getDocumentFragment(target).toArray().map((item) => {
            if (!(item instanceof Y.XmlElement) && !(item instanceof Y.XmlText)) {
              throw new DocumentLifecycleError('VALIDATION_FAILED', 'Unsupported document content', 400);
            }
            return item.clone();
          });
          try {
            current.transact(() => {
              destination.delete(0, destination.length);
              if (content.length) destination.insert(0, content);
            }, 'restore');
            const { state: actualState, ...snapshot } = this.snapshot(current);
            await this.persist(name, current, actualState);
            return { success: true as const, inMemory: Boolean(active), documentName: name, ...snapshot };
          } catch {
            this.gate(name).status = 'quarantined';
            server.hocuspocus.closeConnections(name);
            throw new DocumentLifecycleError('PERSISTENCE_FAILED', 'Restore persistence failed; document quarantined', 503, true);
          }
        } finally {
          if (!active) current.destroy();
        }
      });
    } finally {
      target.destroy();
    }
  }

  tombstone(documentName: string): Promise<{ success: true; tombstoned: true; documentName: string }> {
    const name = canonicalDocumentName(documentName);
    const gate = this.gate(name);
    if (gate.deletion) return gate.deletion;
    // Block admissions immediately, including messages queued before the gate.
    gate.status = 'deleting';
    const deletion = this.deleteRoom(name, gate);
    gate.deletion = deletion;
    void deletion.catch(() => { gate.deletion = undefined; });
    return deletion;
  }

  private async drain(document: Document): Promise<void> {
    await this.server().hocuspocus.debouncer.executeNow(`onStoreDocument-${document.name}`);
    await document.saveMutex.waitForUnlock();
  }

  private async evict(document: Document): Promise<void> {
    await this.run(document.name, async () => {
      const documents = this.server().hocuspocus.documents;
      if (documents.get(document.name) === document) {
        documents.delete(document.name);
        document.destroy();
      }
    }, true);
  }

  private async deleteRoom(name: string, gate: Gate) {
    let document: Document | undefined;
    let connections: Connection[] = [];
    try {
      await this.run(name, async () => {
        const server = this.server();
        if (!this.adapter.tombstone) {
          throw new DocumentLifecycleError('UNAVAILABLE', 'Persistence deletion barrier is unavailable', 503);
        }
        document = server.hocuspocus.documents.get(name);
        connections = document?.getConnections() ?? [];
        server.hocuspocus.closeConnections(name);
        if (!gate.deletionStatePersisted) {
          if (document) {
            const snapshot = this.snapshot(document);
            await this.persist(name, document, snapshot.state);
          } else {
            // An inactive room is not permission to ignore a persistence outage.
            await this.adapter.fetch(name);
          }
          gate.deletionStatePersisted = true;
        }
        await this.adapter.tombstone(name);
        gate.status = 'deleted';
      }, true);
      // Never await saveMutex while holding the gate: a normal Hocus store may
      // hold that mutex while waiting for the gate. Blocked stores now drain
      // without touching persistence, including delayed disconnect stores.
      await Promise.all(connections.map((connection) => connection.waitForPendingMessages()));
      if (document) {
        await this.drain(document);
        await this.evict(document);
      }
      return { success: true as const, tombstoned: true as const, documentName: name };
    } catch (error) {
      gate.status = 'quarantined';
      if (error instanceof DocumentLifecycleError && error.code === 'UNAVAILABLE') throw error;
      throw new DocumentLifecycleError('PERSISTENCE_FAILED', 'Deletion barrier failed; document quarantined', 503, true);
    }
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    const server = this.server();
    // A create operation can already hold a gate before Hocus registers its
    // loading promise. Drain those leases too, not just loadingDocuments.
    await Promise.all([...this.gates.values()].map((gate) => gate.tail));
    await Promise.allSettled([...server.hocuspocus.loadingDocuments.values()]);
    server.hocuspocus.closeConnections();
    const documents = [...server.hocuspocus.documents.values()];
    for (const document of documents) {
      await this.run(document.name, async () => {
        // A confirmed pre-tombstone save is already durable and the backend may
        // now reject stores. Otherwise retain the actual live state, including
        // dirty quarantines, rather than silently discarding it on shutdown.
        if (this.gates.get(canonicalDocumentName(document.name))?.deletionStatePersisted) return;
        const snapshot = this.snapshot(document);
        await this.persist(document.name, document, snapshot.state);
      }, true);
      await this.drain(document);
      await this.evict(document);
    }
  }
}
