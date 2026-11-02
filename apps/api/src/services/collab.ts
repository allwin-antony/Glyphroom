import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { exportDerivedMarkdown } from '@enterprise-blogger/shared';

export interface CollabSnapshotResult {
  documentName: string;
  yjsState: Uint8Array;
  workingMarkdown: string;
  fingerprint: string;
}

export type CollabFlushResult =
  | ({ inMemory: true } & CollabSnapshotResult)
  | { inMemory: false; documentName: string };

export type CollabRestoreResult = CollabSnapshotResult & { inMemory: boolean };
export interface CollabTombstoneResult { tombstoned: true; documentName: string }

export class CollabServiceError extends Error {
  readonly statusCode: 409 | 503;
  constructor(
    public readonly code: 'UNAVAILABLE' | 'UNAUTHORIZED' | 'INVALID_RESPONSE' | 'INVALID_STATE' | 'PERSISTENCE_FAILED' | 'CONFLICT',
    message: string,
    public readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = 'CollabServiceError';
    this.statusCode = code === 'CONFLICT' ? 409 : 503;
  }
}

function decodeState(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  try {
    Y.decodeUpdate(state);
    Y.applyUpdate(doc, state);
    if (doc.store.pendingStructs || doc.store.pendingDs) throw new Error('Incomplete state');
    if (!Buffer.from(Y.encodeStateAsUpdate(doc)).equals(Buffer.from(state))) throw new Error('Noncanonical state');
    return doc;
  } catch {
    doc.destroy();
    throw new CollabServiceError('INVALID_STATE', 'Invalid Yjs document state');
  }
}

/** For an inactive capture, reread the row AFTER acknowledgement, then hash it.
 * null is the encoded empty Y.Doc; state vectors alone cannot detect deletions. */
export function fingerprintDocumentState(state: Uint8Array | null): string {
  const doc = state === null ? new Y.Doc() : decodeState(state);
  try {
    return createHash('sha256').update(Y.encodeStateAsUpdate(doc)).digest('hex');
  } finally {
    doc.destroy();
  }
}

/** Derive both checkpoint fields from one complete persisted state. No cache fallback. */
export function deriveDocumentSnapshot(state: Uint8Array): Omit<CollabSnapshotResult, 'documentName'> {
  const doc = decodeState(state);
  try {
    const yjsState = Y.encodeStateAsUpdate(doc);
    const root = doc.share.has('prosemirror') ? 'prosemirror' : doc.share.has('default') ? 'default' : 'prosemirror';
    return {
      yjsState,
      workingMarkdown: exportDerivedMarkdown(yDocToProsemirrorJSON(doc, root) as any),
      fingerprint: createHash('sha256').update(yjsState).digest('hex'),
    };
  } finally {
    doc.destroy();
  }
}

export class CollabService {
  private readonly collabUrl?: string;
  private readonly gatewaySecret?: string;
  private readonly timeoutMs: number;

  constructor(options: { collabUrl?: string; gatewaySecret?: string; timeoutMs?: number } = {}) {
    this.collabUrl = (options.collabUrl ?? process.env.COLLAB_URL)?.replace(/\/+$/, '');
    this.gatewaySecret = options.gatewaySecret ?? process.env.COLLAB_GATEWAY_SECRET
      ?? process.env.GATEWAY_SECRET ?? process.env.AGENT_GATEWAY_SECRET;
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

  private documentName(postId: string): string {
    const id = postId.startsWith('post-') ? postId.slice(5) : postId;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new CollabServiceError('INVALID_STATE', 'Invalid document identifier');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    return `post-${uuid ? id.toLowerCase() : id}`;
  }

  private async request(documentName: string, action: 'flush' | 'restore' | 'tombstone', body: object): Promise<any> {
    if (!this.collabUrl || !this.gatewaySecret) {
      throw new CollabServiceError('UNAVAILABLE', 'Collaboration dependency is not configured');
    }
    try {
      const url = new URL(this.collabUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid URL');
    } catch {
      throw new CollabServiceError('UNAVAILABLE', 'Collaboration dependency is not configured');
    }
    const mutation = action !== 'flush';
    let response: Response;
    try {
      response = await fetch(`${this.collabUrl}/internal/documents/${encodeURIComponent(documentName)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-gateway-secret': this.gatewaySecret },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch {
      throw new CollabServiceError('UNAVAILABLE', 'Collaboration dependency request failed', mutation);
    }
    if (!response.ok) {
      const data = await response.json().catch(() => null) as any;
      if (response.status === 409) throw new CollabServiceError('CONFLICT', 'Document changed since capture');
      if (response.status === 401 || response.status === 403) {
        throw new CollabServiceError('UNAUTHORIZED', 'Collaboration dependency authentication failed');
      }
      const code = data?.code === 'PERSISTENCE_FAILED' ? 'PERSISTENCE_FAILED' : 'UNAVAILABLE';
      throw new CollabServiceError(code, 'Collaboration dependency operation failed', mutation && data?.outcomeUnknown !== false);
    }
    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new CollabServiceError('INVALID_RESPONSE', 'Invalid collaboration dependency response', mutation);
    }
    if (!data || data.success !== true || data.documentName !== documentName) {
      throw new CollabServiceError('INVALID_RESPONSE', 'Invalid collaboration dependency response', mutation);
    }
    return data;
  }

  private snapshot(data: any, mutation: boolean): CollabRestoreResult {
    let doc: Y.Doc | undefined;
    try {
      if (typeof data.inMemory !== 'boolean' || typeof data.workingMarkdown !== 'string'
        || typeof data.yjsState !== 'string' || !data.yjsState || typeof data.fingerprint !== 'string'
        || !/^[0-9a-f]{64}$/.test(data.fingerprint)
        || Buffer.from(data.yjsState, 'base64').toString('base64') !== data.yjsState) throw new Error('Invalid payload');
      const state = new Uint8Array(Buffer.from(data.yjsState, 'base64'));
      doc = decodeState(state);
      const canonical = Y.encodeStateAsUpdate(doc);
      if (!Buffer.from(canonical).equals(Buffer.from(state))
        || createHash('sha256').update(canonical).digest('hex') !== data.fingerprint) throw new Error('Invalid state');
      const fragment = doc.share.has('prosemirror') ? 'prosemirror' : doc.share.has('default') ? 'default' : 'prosemirror';
      if (exportDerivedMarkdown(yDocToProsemirrorJSON(doc, fragment) as any) !== data.workingMarkdown) throw new Error('Incoherent projection');
      return {
        documentName: data.documentName,
        inMemory: data.inMemory,
        yjsState: state,
        workingMarkdown: data.workingMarkdown,
        fingerprint: data.fingerprint,
      };
    } catch {
      throw new CollabServiceError('INVALID_RESPONSE', 'Invalid collaboration document snapshot', mutation);
    } finally {
      doc?.destroy();
    }
  }

  async flushDocument(postId: string): Promise<CollabFlushResult> {
    const data = await this.request(this.documentName(postId), 'flush', {});
    if (data.inMemory === false && data.yjsState === undefined && data.workingMarkdown === undefined && data.fingerprint === undefined) {
      return { inMemory: false, documentName: data.documentName };
    }
    const snapshot = this.snapshot(data, false);
    if (!snapshot.inMemory) throw new CollabServiceError('INVALID_RESPONSE', 'Invalid collaboration capture response');
    return { ...snapshot, inMemory: true };
  }

  async restoreDocument(postId: string, yjsStateSnapshot: Uint8Array, expectedCurrentFingerprint: string): Promise<CollabRestoreResult> {
    if (typeof expectedCurrentFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(expectedCurrentFingerprint)) {
      throw new CollabServiceError('INVALID_STATE', 'Expected current fingerprint is required');
    }
    const doc = decodeState(yjsStateSnapshot);
    let yjsState: string;
    try {
      yjsState = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
    } finally {
      doc.destroy();
    }
    const data = await this.request(this.documentName(postId), 'restore', { yjsState, expectedCurrentFingerprint });
    return this.snapshot(data, true);
  }

  async tombstoneDocument(postId: string): Promise<CollabTombstoneResult> {
    const data = await this.request(this.documentName(postId), 'tombstone', {});
    if (data.tombstoned !== true) throw new CollabServiceError('INVALID_RESPONSE', 'Invalid collaboration deletion acknowledgement', true);
    return { tombstoned: true, documentName: data.documentName };
  }
}
