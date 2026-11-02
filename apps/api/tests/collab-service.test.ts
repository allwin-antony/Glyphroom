import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { exportDerivedMarkdown } from '@enterprise-blogger/shared';
import { CollabService, CollabServiceError, fingerprintDocumentState } from '../src/services/collab.js';
import { createCollabServer, type CollabServerInstance } from '../../collab/src/server.js';
import { InMemoryPersistenceAdapter } from '../../collab/src/persistence/in-memory.js';

const id = '11111111-2222-3333-4444-555555555555';
const room = `post-${id}`;
const secret = 'configured-collab-service-test-secret';

function document(text: string) {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText(text)]);
  doc.getXmlFragment('prosemirror').insert(0, [paragraph]);
  return doc;
}

function snapshot(doc: Y.Doc, inMemory = true) {
  const state = Y.encodeStateAsUpdate(doc);
  return {
    success: true, documentName: room, inMemory,
    yjsState: Buffer.from(state).toString('base64'),
    workingMarkdown: exportDerivedMarkdown(yDocToProsemirrorJSON(doc, 'prosemirror') as any),
    fingerprint: fingerprintDocumentState(state),
  };
}

describe('CollabService authenticated HTTP lifecycle contract', () => {
  let app: FastifyInstance;
  let url: string;
  let service: CollabService;
  let response: any;
  let status: number;
  let slow: boolean;
  let raw: string | undefined;
  let collab: CollabServerInstance | undefined;
  let requests: Array<{ action: string; body: any; secret?: string; type?: string }>;

  beforeEach(async () => {
    app = Fastify();
    requests = [];
    response = snapshot(document('Live state'));
    status = 200;
    slow = false;
    raw = undefined;
    app.post('/internal/documents/:name/:action', async (request, reply) => {
      const { action } = request.params as { action: string };
      requests.push({ action, body: request.body, secret: request.headers['x-gateway-secret'] as string, type: request.headers['content-type'] });
      if (request.headers['x-gateway-secret'] !== secret) return reply.status(401).send({ success: false, code: 'UNAUTHORIZED' });
      if (slow) await new Promise((resolve) => setTimeout(resolve, 100));
      if (raw !== undefined) return reply.status(status).type('application/json').send(raw);
      return reply.status(status).send(response);
    });
    url = await app.listen({ port: 0, host: '127.0.0.1' });
    service = new CollabService({ collabUrl: url, gatewaySecret: secret });
  });

  afterEach(async () => {
    await collab?.destroy();
    collab = undefined;
    await app.close();
  });

  it('sends a real JSON object for flush and accepts coherent empty Markdown', async () => {
    response = snapshot(document(''));
    const result = await service.flushDocument(id);
    expect(result.inMemory).toBe(true);
    if (!result.inMemory) throw new Error('Expected active capture');
    expect(result.workingMarkdown).toBe('');
    expect(result.fingerprint).toBe(fingerprintDocumentState(result.yjsState));
    const decoded = new Y.Doc();
    Y.applyUpdate(decoded, result.yjsState);
    expect(decoded.getXmlFragment('prosemirror').toString()).toBe('<paragraph></paragraph>');
    expect(requests).toEqual([{ action: 'flush', body: {}, secret, type: 'application/json' }]);
  });

  it('returns inactive only for an authenticated, explicit successful inactive acknowledgement', async () => {
    response = { success: true, inMemory: false, documentName: room };
    await expect(service.flushDocument(id)).resolves.toEqual({ inMemory: false, documentName: room });
    expect(requests[0].body).toEqual({});
    response = { inMemory: false, documentName: room };
    await expect(service.flushDocument(id)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', statusCode: 503 });
  });

  it.each(['missing-state', 'false-success', 'bad-base64', 'bad-yjs', 'bad-fingerprint', 'bad-markdown', 'wrong-room', 'mixed-inactive'])('rejects malformed %s responses, never claiming inactivity', async (failure) => {
    const valid = snapshot(document('Live state'));
    switch (failure) {
      case 'missing-state': response = { success: true, documentName: room, inMemory: true }; break;
      case 'false-success': response = { ...valid, success: false }; break;
      case 'bad-base64': response = { ...valid, yjsState: 'not base64!' }; break;
      case 'bad-yjs': response = { ...valid, yjsState: Buffer.from('corrupted Yjs update').toString('base64') }; break;
      case 'bad-fingerprint': response = { ...valid, fingerprint: '0'.repeat(64) }; break;
      case 'bad-markdown': response = { ...valid, workingMarkdown: '' }; break;
      case 'wrong-room': response = { ...valid, documentName: 'post-other' }; break;
      case 'mixed-inactive': response = { ...valid, inMemory: false }; break;
    }
    await expect(service.flushDocument(id)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', statusCode: 503 });
  });

  it('rejects invalid JSON and trailing bytes in an otherwise real Yjs update', async () => {
    raw = '{invalid JSON';
    await expect(service.flushDocument(id)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    raw = undefined;
    const valid = snapshot(document('Real Yjs'));
    response = { ...valid, yjsState: Buffer.concat([Buffer.from(valid.yjsState, 'base64'), Buffer.from([1])]).toString('base64') };
    await expect(service.flushDocument(id)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects corrupt/noncanonical restore inputs and missing fingerprints before sending a mutation', async () => {
    const state = Y.encodeStateAsUpdate(document('Historical target'));
    const corrupt = new Uint8Array(Buffer.concat([Buffer.from(state), Buffer.from([1])]));
    await expect(service.restoreDocument(id, corrupt, fingerprintDocumentState(null))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(service.restoreDocument(id, state, undefined as any)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(requests).toHaveLength(0);
  });

  it('throws typed dependency/auth errors for missing configuration, wrong secrets, and transport failures', async () => {
    for (const options of [{ collabUrl: '', gatewaySecret: secret }, { collabUrl: url, gatewaySecret: '' }]) {
      await expect(new CollabService(options).flushDocument(id)).rejects.toMatchObject({ code: 'UNAVAILABLE', statusCode: 503 });
    }
    expect(requests).toHaveLength(0);
    await expect(new CollabService({ collabUrl: url, gatewaySecret: 'wrong' }).flushDocument(id)).rejects.toMatchObject({ code: 'UNAUTHORIZED', statusCode: 503 });
    await app.close();
    await expect(service.flushDocument(id)).rejects.toMatchObject({ code: 'UNAVAILABLE', statusCode: 503 });
    await expect(service.tombstoneDocument(id)).rejects.toMatchObject({ code: 'UNAVAILABLE', outcomeUnknown: true });
  });

  it('bounds timeouts and reports unknown mutation outcomes without claiming rollback', async () => {
    slow = true;
    const bounded = new CollabService({ collabUrl: url, gatewaySecret: secret, timeoutMs: 20 });
    await expect(bounded.flushDocument(id)).rejects.toMatchObject({ code: 'UNAVAILABLE', outcomeUnknown: false });
    await expect(bounded.restoreDocument(id, Y.encodeStateAsUpdate(document('Target')), fingerprintDocumentState(null))).rejects.toMatchObject({ code: 'UNAVAILABLE', outcomeUnknown: true });
    await expect(bounded.tombstoneDocument(id)).rejects.toMatchObject({ code: 'UNAVAILABLE', outcomeUnknown: true });
  });

  it('passes the expected-current fingerprint and returns actual resulting causal state, including inactive restores', async () => {
    const current = document('Current');
    const target = document('Historical');
    const expected = fingerprintDocumentState(Y.encodeStateAsUpdate(current));
    current.transact(() => {
      const fragment = current.getXmlFragment('prosemirror');
      fragment.delete(0, fragment.length);
      fragment.insert(0, target.getXmlFragment('prosemirror').toArray().map((node) => (node as Y.XmlElement).clone()));
    });
    response = snapshot(current, false);
    const result = await service.restoreDocument(id, Y.encodeStateAsUpdate(target), expected);
    expect(result.inMemory).toBe(false);
    expect(result.workingMarkdown).toBe('Historical');
    expect(result.yjsState).toEqual(Y.encodeStateAsUpdate(current));
    expect(result.yjsState).not.toEqual(Y.encodeStateAsUpdate(target));
    expect(requests[0]).toEqual({ action: 'restore', body: { yjsState: Buffer.from(Y.encodeStateAsUpdate(target)).toString('base64'), expectedCurrentFingerprint: expected }, secret, type: 'application/json' });
  });

  it('distinguishes safe 409 conflicts from persistence failures and discards dependency error content', async () => {
    status = 409;
    response = { success: false, code: 'CONFLICT', outcomeUnknown: false };
    const target = Y.encodeStateAsUpdate(document('Target'));
    await expect(service.restoreDocument(id, target, fingerprintDocumentState(null))).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409, outcomeUnknown: false });
    status = 503;
    response = { success: false, code: 'PERSISTENCE_FAILED', outcomeUnknown: true, message: 'private document content and credentials' };
    try {
      await service.restoreDocument(id, target, fingerprintDocumentState(null));
      throw new Error('Expected persistence failure');
    } catch (error) {
      expect(error).toBeInstanceOf(CollabServiceError);
      expect(error).toMatchObject({ code: 'PERSISTENCE_FAILED', statusCode: 503, outcomeUnknown: true });
      expect((error as Error).message).not.toContain('private document');
    }
    await expect(service.flushDocument(id)).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });
  });

  it('requires a validated deletion acknowledgement and sends {} instead of empty JSON', async () => {
    response = { success: true, tombstoned: true, documentName: room };
    await expect(service.tombstoneDocument(id)).resolves.toEqual({ tombstoned: true, documentName: room });
    expect(requests[0]).toEqual({ action: 'tombstone', body: {}, secret, type: 'application/json' });
    response = { success: true, tombstoned: false, documentName: room };
    await expect(service.tombstoneDocument(id)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', outcomeUnknown: true });
  });

  it('hashes deletion changes even when the Yjs state vector is unchanged', () => {
    const doc = document('Current');
    const vector = Y.encodeStateVector(doc);
    const before = fingerprintDocumentState(Y.encodeStateAsUpdate(doc));
    doc.getXmlFragment('prosemirror').delete(0, 1);
    expect(Y.encodeStateVector(doc)).toEqual(vector);
    expect(fingerprintDocumentState(Y.encodeStateAsUpdate(doc))).not.toBe(before);
  });

  it('works through the real gateway for empty live capture, causal restore, and awaited deletion', async () => {
    const adapter = new InMemoryPersistenceAdapter();
    collab = await createCollabServer({ port: 0, adapter, gatewaySecret: secret, quiet: true });
    const { port } = await collab.listen();
    const direct = await collab.server.hocuspocus.openDirectConnection(room, { user: { id: 'fixture-editor', role: 'author', name: 'Editor', permissions: ['edit'] } });
    await direct.transact((doc) => {
      const legacy = new Y.XmlElement('paragraph');
      legacy.insert(0, [new Y.XmlText('Stale legacy content')]);
      doc.getXmlFragment('default').insert(0, [legacy]);
      doc.getXmlFragment('prosemirror');
    });
    const real = new CollabService({ collabUrl: `http://127.0.0.1:${port}`, gatewaySecret: secret });
    const captured = await real.flushDocument(id);
    expect(captured.inMemory).toBe(true);
    if (!captured.inMemory) throw new Error('Expected live capture');
    expect(captured.workingMarkdown).toBe('');
    const target = new Y.Doc();
    const restored = await real.restoreDocument(id, Y.encodeStateAsUpdate(target), captured.fingerprint);
    expect(restored.workingMarkdown).toBe('');
    expect(restored.yjsState).not.toEqual(Y.encodeStateAsUpdate(target));
    await expect(real.tombstoneDocument(id)).resolves.toEqual({ tombstoned: true, documentName: room });
    expect(collab.server.hocuspocus.documents.has(room)).toBe(false);
    expect(await adapter.fetch(room)).toBeNull();
    await direct.disconnect({ unloadImmediately: false });
  });
});
