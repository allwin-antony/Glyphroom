import type { DocumentPersistenceAdapter } from './adapter.js';
import type * as Y from 'yjs';

/**
 * Zero-dependency in-memory persistence adapter using copy-on-write byte arrays.
 * Ideal for isolated unit tests, CI test runs, and ephemeral playground instances.
 */
export class InMemoryPersistenceAdapter implements DocumentPersistenceAdapter {
  private readonly storeMap = new Map<string, Uint8Array>();
  private readonly tombstones = new Set<string>();

  async fetch(documentName: string): Promise<Uint8Array | null> {
    const data = this.storeMap.get(documentName);
    if (!data) return null;
    // Return a clone to preserve copy-on-write isolation
    return new Uint8Array(data);
  }

  async store(documentName: string, state: Uint8Array, _doc?: Y.Doc): Promise<void> {
    const id = documentName.startsWith('post-') ? documentName.slice(5) : documentName;
    if (this.tombstones.has(id) || this.tombstones.has(documentName) || this.tombstones.has(`post-${id}`)) {
      return;
    }
    // Clone incoming bytes to avoid unintended mutation by caller
    this.storeMap.set(documentName, new Uint8Array(state));
  }

  tombstone(documentName: string): void {
    const id = documentName.startsWith('post-') ? documentName.slice(5) : documentName;
    this.tombstones.add(id);
    this.tombstones.add(documentName);
    this.tombstones.add(`post-${id}`);
    this.storeMap.delete(documentName);
    this.storeMap.delete(id);
    this.storeMap.delete(`post-${id}`);
  }

  async destroy(): Promise<void> {
    // In-memory adapter requires no socket/pool teardown.
    // Use clear() for explicit map purge.
  }

  // Diagnostic & test inspection helpers
  has(documentName: string): boolean {
    return this.storeMap.has(documentName);
  }

  get(documentName: string): Uint8Array | undefined {
    const data = this.storeMap.get(documentName);
    return data ? new Uint8Array(data) : undefined;
  }

  size(): number {
    return this.storeMap.size;
  }

  clear(): void {
    this.storeMap.clear();
  }
}
