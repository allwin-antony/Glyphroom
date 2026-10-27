import type {
  PluginEventMap,
  PluginEventEnvelope,
  PluginEventHandler,
} from '@enterprise-blogger/shared';

export class PluginEventBus {
  private handlers = new Map<keyof PluginEventMap, Set<PluginEventHandler<any>>>();

  /**
   * Subscribe to a typed plugin domain event.
   * Returns an unsubscribe function.
   */
  on<K extends keyof PluginEventMap>(type: K, handler: PluginEventHandler<K>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => this.off(type, handler);
  }

  /**
   * Unsubscribe a handler from a typed domain event.
   */
  off<K extends keyof PluginEventMap>(type: K, handler: PluginEventHandler<K>): void {
    const set = this.handlers.get(type);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(type);
      }
    }
  }

  /**
   * Dispatches an event envelope to all registered subscribers.
   * Runs all handlers concurrently and collects any errors into an AggregateError.
   */
  async emit<K extends keyof PluginEventMap>(envelope: PluginEventEnvelope<K>): Promise<void> {
    const set = this.handlers.get(envelope.type);
    if (!set || set.size === 0) return;

    const errors: Error[] = [];
    for (const handler of Array.from(set)) {
      try {
        await handler(envelope);
      } catch (err: any) {
        errors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `Failed to dispatch event "${envelope.type}" to ${errors.length} handler(s)`
      );
    }
  }

  /**
   * Returns count of registered handlers for a specific event or in total.
   */
  getHandlerCount(type?: keyof PluginEventMap): number {
    if (type) {
      return this.handlers.get(type)?.size ?? 0;
    }
    let total = 0;
    for (const set of this.handlers.values()) {
      total += set.size;
    }
    return total;
  }

  /**
   * Clears all registered handlers.
   */
  clear(): void {
    this.handlers.clear();
  }
}
