/**
 * Enterprise Blogger 2.0 — Network Simulator Harness
 * Simulates network latency, packet reordering, packet drops, and disconnect/reconnect cycles.
 */

export interface NetworkPacket {
  id: number;
  from: string;
  to: string; // client id or '*' for broadcast
  payload: Uint8Array;
  type: 'update' | 'sync-step-1' | 'sync-step-2' | 'awareness';
  scheduledDeliveryTick: number;
}

export interface NetworkSimulatorOptions {
  latencyMinTicks?: number;
  latencyMaxTicks?: number;
  dropRate?: number;        // 0.0 to 1.0
  reorderRate?: number;     // 0.0 to 1.0
  prng?: () => number;      // deterministic random generator
}

export interface NetworkMetrics {
  sentCount: number;
  deliveredCount: number;
  droppedCount: number;
  reorderedCount: number;
}

export class NetworkSimulator {
  private options: Required<NetworkSimulatorOptions>;
  private clients = new Map<string, (packet: NetworkPacket) => void>();
  private onlineStatus = new Map<string, boolean>();
  private packetQueue: NetworkPacket[] = [];
  private currentTick = 0;
  private packetIdCounter = 0;
  private partitionGroups: [Set<string>, Set<string>] | null = null;

  private metrics: NetworkMetrics = {
    sentCount: 0,
    deliveredCount: 0,
    droppedCount: 0,
    reorderedCount: 0,
  };

  constructor(options: NetworkSimulatorOptions = {}) {
    this.options = {
      latencyMinTicks: options.latencyMinTicks ?? 1,
      latencyMaxTicks: options.latencyMaxTicks ?? 3,
      dropRate: options.dropRate ?? 0,
      reorderRate: options.reorderRate ?? 0,
      prng: options.prng ?? Math.random,
    };
  }

  public registerClient(clientId: string, onReceive: (packet: NetworkPacket) => void): void {
    this.clients.set(clientId, onReceive);
    if (!this.onlineStatus.has(clientId)) {
      this.onlineStatus.set(clientId, true);
    }
  }

  public unregisterClient(clientId: string): void {
    this.clients.delete(clientId);
    this.onlineStatus.delete(clientId);
  }

  public isOnline(clientId: string): boolean {
    return this.onlineStatus.get(clientId) ?? false;
  }

  public disconnect(clientId: string): void {
    this.onlineStatus.set(clientId, false);
  }

  public reconnect(clientId: string): void {
    this.onlineStatus.set(clientId, true);
  }

  public partition(groupA: string[], groupB: string[]): void {
    this.partitionGroups = [new Set(groupA), new Set(groupB)];
  }

  public healPartition(): void {
    this.partitionGroups = null;
  }

  public isPartitioned(): boolean {
    return this.partitionGroups !== null;
  }

  public canCommunicate(from: string, to: string): boolean {
    if (!this.isOnline(from) || !this.isOnline(to)) {
      return false;
    }
    if (this.partitionGroups) {
      const [groupA, groupB] = this.partitionGroups;
      const fromInA = groupA.has(from);
      const toInA = groupA.has(to);
      const fromInB = groupB.has(from);
      const toInB = groupB.has(to);

      // If they belong to opposing partition groups, communication is blocked
      if ((fromInA && toInB) || (fromInB && toInA)) {
        return false;
      }
    }
    return true;
  }

  public send(
    from: string,
    to: string,
    payload: Uint8Array,
    type: NetworkPacket['type'] = 'update'
  ): void {
    this.metrics.sentCount++;

    // Random packet drop simulation
    if (this.options.dropRate > 0 && this.options.prng() < this.options.dropRate) {
      this.metrics.droppedCount++;
      return;
    }

    const latencyRange = Math.max(0, this.options.latencyMaxTicks - this.options.latencyMinTicks);
    let latency = this.options.latencyMinTicks + Math.floor(this.options.prng() * (latencyRange + 1));

    // Reordering simulation: artificially delay or expedite
    if (this.options.reorderRate > 0 && this.options.prng() < this.options.reorderRate) {
      this.metrics.reorderedCount++;
      latency += Math.floor(this.options.prng() * 3) + 1;
    }

    const packet: NetworkPacket = {
      id: ++this.packetIdCounter,
      from,
      to,
      payload: new Uint8Array(payload), // Clone buffer to prevent shared-memory mutation
      type,
      scheduledDeliveryTick: this.currentTick + latency,
    };

    this.packetQueue.push(packet);
  }

  public broadcast(
    from: string,
    payload: Uint8Array,
    type: NetworkPacket['type'] = 'update'
  ): void {
    for (const to of this.clients.keys()) {
      if (to !== from) {
        this.send(from, to, payload, type);
      }
    }
  }

  public step(ticks = 1): number {
    let deliveredThisStep = 0;
    this.currentTick += ticks;

    // Separate deliverable packets
    const remaining: NetworkPacket[] = [];
    const deliverable: NetworkPacket[] = [];

    for (const packet of this.packetQueue) {
      if (packet.scheduledDeliveryTick <= this.currentTick) {
        deliverable.push(packet);
      } else {
        remaining.push(packet);
      }
    }

    this.packetQueue = remaining;

    for (const packet of deliverable) {
      if (this.canCommunicate(packet.from, packet.to)) {
        const handler = this.clients.get(packet.to);
        if (handler) {
          handler(packet);
          this.metrics.deliveredCount++;
          deliveredThisStep++;
        }
      } else {
        // Dropped due to offline or partition
        this.metrics.droppedCount++;
      }
    }

    return deliveredThisStep;
  }

  public flush(maxSteps = 1000): void {
    let stepCount = 0;
    while (this.packetQueue.length > 0 && stepCount < maxSteps) {
      this.step(1);
      stepCount++;
    }
  }

  public getQueueLength(): number {
    return this.packetQueue.length;
  }

  public getMetrics(): NetworkMetrics {
    return { ...this.metrics };
  }

  public reset(): void {
    this.packetQueue = [];
    this.currentTick = 0;
    this.packetIdCounter = 0;
    this.partitionGroups = null;
    this.metrics = {
      sentCount: 0,
      deliveredCount: 0,
      droppedCount: 0,
      reorderedCount: 0,
    };
  }
}
