/**
 * Enterprise Blogger 2.0 — Headless Yjs Client Pool Harness
 * Manages 5 human clients + 1 agent client for opaque-box CRDT convergence testing.
 */

import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness.js';
import { yDocToProsemirrorJSON, prosemirrorJSONToYDoc, yDocToProsemirror } from 'y-prosemirror';
import {
  blogSchema,
  AgentMetadata,
  MARK_SUGGESTION_INSERT,
  MARK_SUGGESTION_DELETE,
  ProseMirrorDocJSON,
  nodeFromJSON,
} from '@enterprise-blogger/shared';
import { NetworkSimulator, NetworkPacket } from './network-simulator.js';

export type ClientRole = 'human' | 'agent';

export interface ClientConfig {
  id: string;
  role: ClientRole;
  name: string;
  color: string;
}

export interface ClientPoolOptions {
  humanCount?: number;      // default: 5
  agentCount?: number;      // default: 1
  initialDoc?: ProseMirrorDocJSON;
  network?: NetworkSimulator;
}

export function resolveXmlText(element: Y.XmlElement): Y.XmlText {
  for (let i = 0; i < element.length; i++) {
    const item = element.get(i);
    if (item instanceof Y.XmlText) {
      return item;
    }
  }
  for (let i = 0; i < element.length; i++) {
    const item = element.get(i);
    if (item instanceof Y.XmlElement) {
      return resolveXmlText(item);
    }
  }
  const t = new Y.XmlText();
  element.insert(0, [t]);
  return t;
}

export class HeadlessClient {
  public readonly id: string;
  public readonly role: ClientRole;
  public readonly name: string;
  public readonly color: string;
  public readonly doc: Y.Doc;
  public readonly awareness: awarenessProtocol.Awareness;
  public readonly xmlFragment: Y.XmlFragment;
  public readonly undoManager: Y.UndoManager;
  public connected = true;

  constructor(config: ClientConfig, initialDoc?: ProseMirrorDocJSON) {
    this.id = config.id;
    this.role = config.role;
    this.name = config.name;
    this.color = config.color;

    // Create fresh Y.Doc with unique clientID
    this.doc = new Y.Doc();
    this.xmlFragment = this.doc.getXmlFragment('prosemirror');
    this.awareness = new awarenessProtocol.Awareness(this.doc);

    // Initial awareness state
    this.awareness.setLocalStateField('user', {
      name: this.name,
      color: this.color,
      role: this.role,
      cursor: null,
    });

    if (initialDoc) {
      const tempDoc = prosemirrorJSONToYDoc(blogSchema, initialDoc);
      Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(tempDoc), 'init');
      tempDoc.destroy();
    }

    // Configure UndoManager for human clients with captureTimeout: 0.
    // Agent mutations use origin 'agent' or agent ID and are strictly ignored by this UndoManager.
    this.undoManager = new Y.UndoManager(this.xmlFragment, {
      trackedOrigins: new Set([this.id, 'human', `user:${this.id}`]),
      captureTimeout: 0,
    });
  }

  private suggestionCounter = 0;

  public clearHistory(): void {
    this.undoManager.clear();
  }

  public getOrigin(): string {
    return this.role === 'human' ? this.id : `agent:${this.id}`;
  }

  /**
   * Apply raw Yjs update
   */
  public applyUpdate(update: Uint8Array, origin?: any): void {
    if (!this.connected) return;
    try {
      Y.applyUpdate(this.doc, update, origin ?? 'remote');
    } catch (err) {
      console.error(`Failed to apply update to client ${this.id}:`, err);
      throw err;
    }
  }

  public getStateVector(): Uint8Array {
    return Y.encodeStateVector(this.doc);
  }

  public getStateAsUpdate(targetVector?: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc, targetVector);
  }

  public getDocJson(): any {
    return yDocToProsemirrorJSON(this.doc);
  }

  public getTextContent(): string {
    const parts: string[] = [];
    const extractText = (item: any) => {
      if (item instanceof Y.XmlText) {
        parts.push(item.toString());
      } else if (item instanceof Y.XmlElement || item instanceof Y.XmlFragment) {
        for (let i = 0; i < item.length; i++) {
          extractText(item.get(i));
        }
      }
    };
    extractText(this.xmlFragment);
    return parts.join('\n');
  }

  // --- Document Operations ---

  public insertParagraph(text: string, index?: number, origin?: any): void {
    const opOrigin = origin ?? this.getOrigin();
    this.doc.transact(() => {
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText(text);
      p.insert(0, [t]);
      const targetIdx = index !== undefined ? Math.min(index, this.xmlFragment.length) : this.xmlFragment.length;
      this.xmlFragment.insert(targetIdx, [p]);
    }, opOrigin);
  }

  public insertHeading(text: string, level = 1, index?: number, origin?: any): void {
    const opOrigin = origin ?? this.getOrigin();
    this.doc.transact(() => {
      const h = new Y.XmlElement('heading');
      h.setAttribute('level', String(level));
      const t = new Y.XmlText(text);
      h.insert(0, [t]);
      const targetIdx = index !== undefined ? Math.min(index, this.xmlFragment.length) : this.xmlFragment.length;
      this.xmlFragment.insert(targetIdx, [h]);
    }, opOrigin);
  }

  public insertCallout(text: string, alertType = 'NOTE', origin?: any): void {
    const opOrigin = origin ?? this.getOrigin();
    this.doc.transact(() => {
      const alert = new Y.XmlElement('callout_alert');
      alert.setAttribute('alertType', alertType);
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText(text);
      p.insert(0, [t]);
      alert.insert(0, [p]);
      this.xmlFragment.insert(this.xmlFragment.length, [alert]);
    }, opOrigin);
  }

  public insertCodeBlock(code: string, language = 'typescript', origin?: any): void {
    const opOrigin = origin ?? this.getOrigin();
    this.doc.transact(() => {
      const cb = new Y.XmlElement('code_block');
      cb.setAttribute('language', language);
      const t = new Y.XmlText(code);
      cb.insert(0, [t]);
      this.xmlFragment.insert(this.xmlFragment.length, [cb]);
    }, opOrigin);
  }

  public insertMathDisplay(tex: string, origin?: any): void {
    const opOrigin = origin ?? this.getOrigin();
    this.doc.transact(() => {
      const m = new Y.XmlElement('math_display');
      m.setAttribute('tex', tex);
      this.xmlFragment.insert(this.xmlFragment.length, [m]);
    }, opOrigin);
  }

  public insertMermaid(diagram: string, origin?: any): void {
    const opOrigin = origin ?? this.getOrigin();
    this.doc.transact(() => {
      const mb = new Y.XmlElement('mermaid_block');
      mb.setAttribute('securityLevel', 'strict');
      const t = new Y.XmlText(diagram);
      mb.insert(0, [t]);
      this.xmlFragment.insert(this.xmlFragment.length, [mb]);
    }, opOrigin);
  }

  public insertTable(rows = 2, cols = 2, defaultText = 'Cell', origin?: any): void {
    const opOrigin = origin ?? this.getOrigin();
    this.doc.transact(() => {
      const table = new Y.XmlElement('table');
      for (let r = 0; r < rows; r++) {
        const row = new Y.XmlElement('table_row');
        for (let c = 0; c < cols; c++) {
          const cellType = r === 0 ? 'table_header' : 'table_cell';
          const cell = new Y.XmlElement(cellType);
          cell.setAttribute('colspan', '1');
          cell.setAttribute('rowspan', '1');
          const p = new Y.XmlElement('paragraph');
          const t = new Y.XmlText(`${defaultText} [${r},${c}]`);
          p.insert(0, [t]);
          cell.insert(0, [p]);
          row.insert(c, [cell]);
        }
        table.insert(r, [row]);
      }
      this.xmlFragment.insert(this.xmlFragment.length, [table]);
    }, opOrigin);
  }

  public insertTextInBlock(blockIndex: number, offset: number, text: string, origin?: any): void {
    if (this.xmlFragment.length === 0) {
      this.insertParagraph(text, 0, origin);
      return;
    }
    const idx = Math.min(blockIndex, this.xmlFragment.length - 1);
    const block = this.xmlFragment.get(idx) as Y.XmlElement;
    const opOrigin = origin ?? this.getOrigin();

    this.doc.transact(() => {
      const xmlText = resolveXmlText(block);
      const safeOffset = Math.min(offset, xmlText.length);
      xmlText.insert(safeOffset, text);
    }, opOrigin);
  }

  public deleteTextInBlock(blockIndex: number, offset: number, length: number, origin?: any): void {
    if (this.xmlFragment.length === 0) return;
    const idx = Math.min(blockIndex, this.xmlFragment.length - 1);
    const block = this.xmlFragment.get(idx) as Y.XmlElement;
    const opOrigin = origin ?? this.getOrigin();

    this.doc.transact(() => {
      const xmlText = resolveXmlText(block);
      if (xmlText.length > 0) {
        const safeOffset = Math.min(offset, xmlText.length - 1);
        const safeLength = Math.min(length, xmlText.length - safeOffset);
        if (safeLength > 0) {
          xmlText.delete(safeOffset, safeLength);
        }
      }
    }, opOrigin);
  }

  // --- Agent Suggestion Operations ---

  public suggestInsert(
    blockIndex: number,
    offset: number,
    text: string,
    meta: AgentMetadata,
    suggestionId?: string
  ): string {
    const id = suggestionId ?? `sug-ins-${this.id}-${++this.suggestionCounter}`;
    const opOrigin = `agent:${meta.agentId}`;
    this.doc.transact(() => {
      if (this.xmlFragment.length === 0) {
        const p = new Y.XmlElement('paragraph');
        this.xmlFragment.insert(0, [p]);
      }
      const idx = Math.min(blockIndex, this.xmlFragment.length - 1);
      const block = this.xmlFragment.get(idx) as Y.XmlElement;
      const xmlText = resolveXmlText(block);

      const safeOffset = Math.min(offset, xmlText.length);
      xmlText.insert(safeOffset, text, {
        [MARK_SUGGESTION_INSERT]: {
          id,
          agentId: meta.agentId,
          tokenId: meta.tokenId,
          ownerUserId: meta.ownerUserId,
          timestamp: meta.timestamp,
          status: 'pending',
        },
      });
    }, opOrigin);

    return id;
  }

  public suggestDelete(
    blockIndex: number,
    offset: number,
    length: number,
    meta: AgentMetadata,
    suggestionId?: string
  ): string {
    const id = suggestionId ?? `sug-del-${this.id}-${++this.suggestionCounter}`;
    const opOrigin = `agent:${meta.agentId}`;
    this.doc.transact(() => {
      if (this.xmlFragment.length === 0) return;
      const idx = Math.min(blockIndex, this.xmlFragment.length - 1);
      const block = this.xmlFragment.get(idx) as Y.XmlElement;
      const xmlText = resolveXmlText(block);
      const safeOffset = Math.min(offset, Math.max(0, xmlText.length - 1));
      const safeLength = Math.min(length, xmlText.length - safeOffset);
      if (safeLength > 0) {
        xmlText.format(safeOffset, safeLength, {
          [MARK_SUGGESTION_DELETE]: {
            id,
            agentId: meta.agentId,
            tokenId: meta.tokenId,
            ownerUserId: meta.ownerUserId,
            timestamp: meta.timestamp,
            status: 'pending',
          },
        });
      }
    }, opOrigin);

    return id;
  }

  public appendSection(title: string, content: string, meta?: AgentMetadata): void {
    const opOrigin = meta ? `agent:${meta.agentId}` : this.getOrigin();
    this.doc.transact(() => {
      const h = new Y.XmlElement('heading');
      h.setAttribute('level', '2');
      const ht = new Y.XmlText(title);
      h.insert(0, [ht]);

      const p = new Y.XmlElement('paragraph');
      const pt = new Y.XmlText(content);
      p.insert(0, [pt]);

      this.xmlFragment.insert(this.xmlFragment.length, [h, p]);
    }, opOrigin);
  }

  public insertAfterSection(targetTitle: string, title: string, content: string, meta?: AgentMetadata): boolean {
    const opOrigin = meta ? `agent:${meta.agentId}` : this.getOrigin();
    let foundIndex = -1;

    for (let i = 0; i < this.xmlFragment.length; i++) {
      const item = this.xmlFragment.get(i);
      if (item instanceof Y.XmlElement && item.nodeName === 'heading') {
        const text = item.length > 0 ? item.get(0).toString() : '';
        if (text === targetTitle) {
          foundIndex = i;
          break;
        }
      }
    }

    if (foundIndex === -1) {
      this.appendSection(title, content, meta);
      return false;
    }

    // Find the end of this section (until next heading of same or higher level or doc end)
    let insertIndex = foundIndex + 1;
    while (insertIndex < this.xmlFragment.length) {
      const nextItem = this.xmlFragment.get(insertIndex);
      if (nextItem instanceof Y.XmlElement && nextItem.nodeName === 'heading') {
        break;
      }
      insertIndex++;
    }

    this.doc.transact(() => {
      const h = new Y.XmlElement('heading');
      h.setAttribute('level', '2');
      const ht = new Y.XmlText(title);
      h.insert(0, [ht]);

      const p = new Y.XmlElement('paragraph');
      const pt = new Y.XmlText(content);
      p.insert(0, [pt]);

      this.xmlFragment.insert(insertIndex, [h, p]);
    }, opOrigin);

    return true;
  }

  public undo(): boolean {
    if (this.undoManager.undoStack.length > 0) {
      this.undoManager.undo();
      return true;
    }
    return false;
  }

  public redo(): boolean {
    if (this.undoManager.redoStack.length > 0) {
      this.undoManager.redo();
      return true;
    }
    return false;
  }

  public destroy(): void {
    this.undoManager.destroy();
    this.awareness.destroy();
    this.doc.destroy();
  }
}

export class ClientPool {
  private clients = new Map<string, HeadlessClient>();
  private network: NetworkSimulator | null = null;
  private updateListeners = new Map<string, (update: Uint8Array, origin: any) => void>();

  constructor(options: ClientPoolOptions = {}) {
    const humanCount = options.humanCount ?? 5;
    const agentCount = options.agentCount ?? 1;

    const colors = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#e11d48'];

    // Create human clients
    for (let i = 1; i <= humanCount; i++) {
      const id = `human-${i}`;
      const client = new HeadlessClient({
        id,
        role: 'human',
        name: `Human Engineer ${i}`,
        color: colors[(i - 1) % colors.length],
      }, options.initialDoc);
      client.doc.clientID = 1000 + i;
      this.clients.set(id, client);
    }

    // Create agent client(s)
    for (let i = 1; i <= agentCount; i++) {
      const id = `agent-gateway-${i}`;
      const client = new HeadlessClient({
        id,
        role: 'agent',
        name: `AI Agent Gateway ${i}`,
        color: '#dc2626',
      }, options.initialDoc);
      client.doc.clientID = 9000 + i;
      this.clients.set(id, client);
    }

    if (options.network) {
      this.attachNetwork(options.network);
    }
  }

  public attachNetwork(network: NetworkSimulator): void {
    this.network = network;

    for (const client of this.clients.values()) {
      // Register with network
      network.registerClient(client.id, (packet: NetworkPacket) => {
        if (packet.type === 'update') {
          client.applyUpdate(packet.payload, 'network');
        }
      });

      // Hook up doc update listener to broadcast through network
      const listener = (update: Uint8Array, origin: any) => {
        // Only forward updates that originated locally (not from network delivery, init, or direct sync)
        if (
          origin !== 'network' &&
          origin !== 'init' &&
          origin !== 'syncDirect' &&
          client.connected
        ) {
          network.broadcast(client.id, update, 'update');
        }
      };

      client.doc.on('update', listener);
      this.updateListeners.set(client.id, listener);
    }
  }

  public getClient(id: string): HeadlessClient {
    const client = this.clients.get(id);
    if (!client) {
      throw new Error(`Client not found in pool: ${id}`);
    }
    return client;
  }

  public getHumans(): HeadlessClient[] {
    return Array.from(this.clients.values()).filter((c) => c.role === 'human');
  }

  public getAgents(): HeadlessClient[] {
    return Array.from(this.clients.values()).filter((c) => c.role === 'agent');
  }

  public getAgent(): HeadlessClient {
    const agents = this.getAgents();
    if (agents.length === 0) {
      throw new Error('No agent client found in pool');
    }
    return agents[0];
  }

  public getAllClients(): HeadlessClient[] {
    return Array.from(this.clients.values());
  }

  public disconnectClient(id: string): void {
    const client = this.getClient(id);
    client.connected = false;
    if (this.network) {
      this.network.disconnect(id);
    }
  }

  public reconnectClient(id: string): void {
    const client = this.getClient(id);
    client.connected = true;
    if (this.network) {
      this.network.reconnect(id);
      // Initiate sync with an online peer
      const onlinePeer = this.getAllClients().find((c) => c.id !== id && c.connected);
      if (onlinePeer) {
        // Send state vector and exchange updates
        const updateForPeer = client.getStateAsUpdate(onlinePeer.getStateVector());
        const updateForClient = onlinePeer.getStateAsUpdate(client.getStateVector());
        this.network.send(client.id, onlinePeer.id, updateForPeer, 'update');
        this.network.send(onlinePeer.id, client.id, updateForClient, 'update');
      }
    }
  }

  /**
   * Direct synchronization across all connected clients by exchanging state updates.
   * Useful for immediate convergence verification without network simulator delays.
   */
  public syncAllDirectly(): void {
    const connectedClients = Array.from(this.clients.values()).filter((c) => c.connected);
    if (connectedClients.length < 2) return;

    // Merge all updates into a single cumulative vector
    const rootDoc = new Y.Doc();
    for (const client of connectedClients) {
      const update = Y.encodeStateAsUpdate(client.doc);
      Y.applyUpdate(rootDoc, update);
    }

    const masterUpdate = Y.encodeStateAsUpdate(rootDoc);
    for (const client of connectedClients) {
      Y.applyUpdate(client.doc, masterUpdate, 'syncDirect');
    }
    rootDoc.destroy();
  }

  /**
   * Asserts 100% convergence across all connected clients.
   * Checks state vectors, ProseMirror JSON, and plain text content.
   */
  public assertConvergence(): void {
    const connectedClients = Array.from(this.clients.values()).filter((c) => c.connected);
    if (connectedClients.length === 0) return;

    const baseClient = connectedClients[0];
    const baseText = baseClient.getTextContent();
    const baseDoc = yDocToProsemirror(blogSchema, baseClient.doc);

    for (let i = 1; i < connectedClients.length; i++) {
      const target = connectedClients[i];
      const targetText = target.getTextContent();
      const targetDoc = yDocToProsemirror(blogSchema, target.doc);

      if (baseText !== targetText) {
        throw new Error(
          `Text divergence detected between ${baseClient.id} and ${target.id}!\nBase: "${baseText}"\nTarget: "${targetText}"`
        );
      }

      if (!baseDoc.eq(targetDoc)) {
        throw new Error(
          `ProseMirror node divergence detected between ${baseClient.id} and ${target.id}!`
        );
      }

      // Check CRDT state vector equivalence and absence of pending structs
      const sv1 = Y.encodeStateVector(baseClient.doc);
      const sv2 = Y.encodeStateVector(target.doc);
      const svEqual = sv1.length === sv2.length && sv1.every((val, idx) => val === sv2[idx]);

      if (!svEqual) {
        const diff1 = Y.encodeStateAsUpdate(baseClient.doc, sv2);
        const diff2 = Y.encodeStateAsUpdate(target.doc, sv1);
        const dec1 = Y.decodeUpdate(diff1);
        const dec2 = Y.decodeUpdate(diff2);
        if (dec1.structs.length > 0 || dec2.structs.length > 0) {
          throw new Error(
            `CRDT state divergence between ${baseClient.id} and ${target.id}! Missing structs: ${dec1.structs.length} / ${dec2.structs.length}`
          );
        }
      }
    }
  }

  public destroy(): void {
    for (const [id, listener] of this.updateListeners.entries()) {
      const client = this.clients.get(id);
      if (client) {
        client.doc.off('update', listener);
      }
    }
    for (const client of this.clients.values()) {
      client.destroy();
    }
    this.clients.clear();
    this.updateListeners.clear();
  }
}
