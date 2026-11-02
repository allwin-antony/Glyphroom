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
   * Prevents new stores and waits for stores already in flight. The row is left
   * intact for the API's subsequent deletion transaction. A failed barrier must
   * reject; lifecycle callers must await it before acknowledging deletion.
   */
  tombstone?(documentName: string): Promise<void> | void;

  /**
   * Closes connections or releases underlying resources.
   */
  destroy(): Promise<void>;
}
