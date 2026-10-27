import { and, asc, eq, lte } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { pluginEventOutbox } from '../db/schema.js';
import {
  PluginEventTypeSchema,
  type PluginEventMap,
  type PluginEventEnvelope,
} from '@enterprise-blogger/shared';
import type { PluginEventBus } from './events.js';

export interface OutboxProcessResult {
  processed: number;
  succeeded: number;
  failed: number;
}

export class OutboxService {
  private db: Database;
  private bus: PluginEventBus;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private maxAttempts = 5;

  constructor(db: Database, bus: PluginEventBus, maxAttempts = 5) {
    this.db = db;
    this.bus = bus;
    this.maxAttempts = maxAttempts;
  }

  /**
   * Enqueue a domain event into the durable outbox table.
   * Can be called with either the root database handle or within an active transaction.
   */
  async enqueue<K extends keyof PluginEventMap>(
    txOrDb: Database | any,
    eventType: K,
    payload: PluginEventMap[K]
  ): Promise<string> {
    // Validate that the event type conforms to known schema
    PluginEventTypeSchema.parse(eventType);

    const [row] = await txOrDb
      .insert(pluginEventOutbox)
      .values({
        eventType,
        payload: payload as any,
        status: 'pending',
        attempts: 0,
        availableAt: new Date(),
      })
      .returning({ id: pluginEventOutbox.id });

    return row.id;
  }

  /**
   * Process a batch of pending events whose available_at timestamp has passed.
   */
  async processPending(limit = 20): Promise<OutboxProcessResult> {
    if (this.isProcessing) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    this.isProcessing = true;
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    try {
      const now = new Date();
      const rows = await this.db
        .select()
        .from(pluginEventOutbox)
        .where(
          and(
            eq(pluginEventOutbox.status, 'pending'),
            lte(pluginEventOutbox.availableAt, now)
          )
        )
        .orderBy(asc(pluginEventOutbox.createdAt))
        .limit(limit);

      for (const row of rows) {
        processed++;
        // 1. Mark as processing
        await this.db
          .update(pluginEventOutbox)
          .set({ status: 'processing' })
          .where(eq(pluginEventOutbox.id, row.id));

        const envelope: PluginEventEnvelope<any> = {
          id: row.id,
          type: row.eventType as any,
          occurredAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
          payload: row.payload,
        };

        try {
          // 2. Dispatch to registered plugin listeners via in-memory bus
          await this.bus.emit(envelope);

          // 3. Mark delivered
          await this.db
            .update(pluginEventOutbox)
            .set({
              status: 'delivered',
              processedAt: new Date(),
              lastError: null,
            })
            .where(eq(pluginEventOutbox.id, row.id));

          succeeded++;
        } catch (err: any) {
          const attempts = row.attempts + 1;
          const errorMessage =
            err instanceof AggregateError && err.errors?.length > 0
              ? err.errors.map((e: any) => e?.message || String(e)).join('; ')
              : err?.message || String(err);

          if (attempts >= this.maxAttempts) {
            // Reached maximum attempts - mark permanently failed
            await this.db
              .update(pluginEventOutbox)
              .set({
                status: 'failed',
                attempts,
                lastError: errorMessage,
                processedAt: new Date(),
              })
              .where(eq(pluginEventOutbox.id, row.id));

            failed++;
          } else {
            // Bounded exponential backoff: 2^attempts * 1000 ms, capped at 60s
            const delayMs = Math.min(1000 * Math.pow(2, attempts), 60000);
            const nextAvailable = new Date(Date.now() + delayMs);

            await this.db
              .update(pluginEventOutbox)
              .set({
                status: 'pending',
                attempts,
                availableAt: nextAvailable,
                lastError: errorMessage,
              })
              .where(eq(pluginEventOutbox.id, row.id));
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return { processed, succeeded, failed };
  }

  /**
   * Reset failed outbox event(s) back to pending for administrative replay.
   */
  async retryFailed(id?: string): Promise<number> {
    const query = this.db
      .update(pluginEventOutbox)
      .set({
        status: 'pending',
        attempts: 0,
        availableAt: new Date(),
        lastError: null,
      });

    const res = id
      ? await query.where(and(eq(pluginEventOutbox.id, id), eq(pluginEventOutbox.status, 'failed'))).returning()
      : await query.where(eq(pluginEventOutbox.status, 'failed')).returning();

    return res.length;
  }

  /**
   * Start recurring background polling loop.
   */
  start(intervalMs = 3000): void {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      try {
        await this.processPending();
      } catch (err) {
        console.error('[OutboxService] Worker error processing batch:', err);
      }
    }, intervalMs);
    // Don't keep Node process alive just for outbox polling in test/cli environments
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /**
   * Stop background polling loop.
   */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Wait for any active in-flight batch to finish
    while (this.isProcessing) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
