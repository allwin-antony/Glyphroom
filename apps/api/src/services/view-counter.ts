import { sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { postViewCounts } from '../db/schema.js';

export interface BufferedViewCounterOptions {
  flushIntervalMs?: number;
}

/**
 * Detached in-memory buffered view counter.
 * Eliminates hot-write row lock contention on the posts table
 * by coalescing view count increments and flushing periodically in batches.
 * Conforms to docs/DATA_MODEL.md (table: post_view_counts).
 */
export class BufferedViewCounter {
  private buffer: Map<string, number> = new Map();
  private timer: NodeJS.Timeout | null = null;
  private readonly flushIntervalMs: number;

  constructor(
    private readonly db: Database,
    options: BufferedViewCounterOptions = {}
  ) {
    this.flushIntervalMs = options.flushIntervalMs ?? 30000;
  }

  /**
   * Record a view increment in the in-memory buffer (zero DB locks)
   */
  increment(postId: string, count = 1): void {
    const current = this.buffer.get(postId) || 0;
    this.buffer.set(postId, current + count);
  }

  /**
   * Get the current pending in-memory buffer count for a post
   */
  getPendingCount(postId: string): number {
    return this.buffer.get(postId) || 0;
  }

  /**
   * Start automatic periodic flush timer
   */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.flush().catch((err) => {
        console.error('Error during periodic view counter flush:', err);
      });
    }, this.flushIntervalMs);
  }

  /**
   * Stop timer and perform final flush
   */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  /**
   * Flush all accumulated increments into post_view_counts table
   */
  async flush(): Promise<number> {
    if (this.buffer.size === 0) return 0;

    const entries = Array.from(this.buffer.entries());
    this.buffer.clear();

    let flushedRows = 0;

    for (const [postId, incrementBy] of entries) {
      if (incrementBy <= 0) continue;

      try {
        await this.db
          .insert(postViewCounts)
          .values({
            postId,
            totalViews: BigInt(incrementBy),
            lastViewedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: postViewCounts.postId,
            set: {
              totalViews: sql`${postViewCounts.totalViews} + ${BigInt(incrementBy)}`,
              lastViewedAt: new Date(),
            },
          });
        flushedRows++;
      } catch (err) {
        // Re-buffer failed increments so views are not dropped
        const existing = this.buffer.get(postId) || 0;
        this.buffer.set(postId, existing + incrementBy);
        console.error(`Failed to flush view count for post ${postId}:`, err);
      }
    }

    return flushedRows;
  }
}
