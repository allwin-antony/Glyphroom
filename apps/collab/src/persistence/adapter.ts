import type * as Y from 'yjs';

/**
 * Interface contract for persisting and retrieving collaborative Y.Doc binary states.
 */
export interface DocumentPersistenceAdapter {
  /**
   * Retrieves the binary CRDT update snapshot for the given document name.
   * Returns null if no state exists yet.
   */
  fetch(documentName: string): Promise<Uint8Array | null>;

  /**
   * Persists the serialized Yjs state snapshot.
   * Optionally receives the live Y.Doc for derived projections (e.g. Markdown caching).
   */
  store(documentName: string, state: Uint8Array, doc?: Y.Doc): Promise<void>;

  /**
   * Marks a document as deleted/tombstoned to prevent delayed flushes from recreating it.
   */
  tombstone?(documentName: string): Promise<void> | void;

  /**
   * Closes connections or releases underlying resources.
   */
  destroy(): Promise<void>;
}
