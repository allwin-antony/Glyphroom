import crypto from 'node:crypto';
import { desc, asc } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { auditLogs } from '../db/schema.js';

export const GENESIS_PREV_HASH = '0'.repeat(64);

export interface CreateAuditEntryInput {
  actorUserId?: string | null;
  actorType: 'human' | 'agent' | 'system';
  patId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

export interface HashPayload {
  id: string;
  actorUserId?: string | null;
  action: string;
  entityId?: string | null;
  metadata?: unknown | null;
  prevHash: string;
}

/**
 * Deterministically serialize metadata to ensure hash stability
 */
export function canonicalStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') return String(obj);

  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }

  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map((key) => {
    const val = (obj as Record<string, unknown>)[key];
    return `"${key}":${JSON.stringify(val)}`;
  });
  return '{' + pairs.join(',') + '}';
}

/**
 * Compute SHA-256 row_hash according to docs/DATA_MODEL.md:
 * SHA-256(id || actor_user_id || action || entity_id || metadata || prev_hash)
 */
export function computeRowHash(payload: HashPayload): string {
  const serialized = [
    payload.id,
    payload.actorUserId ?? '',
    payload.action,
    payload.entityId ?? '',
    canonicalStringify(payload.metadata),
    payload.prevHash,
  ].join('|');

  return crypto.createHash('sha256').update(serialized).digest('hex');
}

export class AuditService {
  constructor(private readonly db: Database) {}

  /**
   * Append a new tamper-evident audit log entry linked to the previous row hash
   */
  async appendLog(input: CreateAuditEntryInput): Promise<typeof auditLogs.$inferSelect> {
    const id = crypto.randomUUID();

    // Fetch the most recent audit log entry to get its row_hash
    const [latestEntry] = await this.db
      .select({ rowHash: auditLogs.rowHash })
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(1);

    const prevHash = latestEntry?.rowHash ?? GENESIS_PREV_HASH;

    const rowHash = computeRowHash({
      id,
      actorUserId: input.actorUserId,
      action: input.action,
      entityId: input.entityId,
      metadata: input.metadata,
      prevHash,
    });

    const [inserted] = await this.db
      .insert(auditLogs)
      .values({
        id,
        actorUserId: input.actorUserId,
        actorType: input.actorType,
        patId: input.patId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata,
        ipAddress: input.ipAddress,
        prevHash,
        rowHash,
      })
      .returning();

    return inserted;
  }

  /**
   * Verify the cryptographic chain integrity of all audit logs
   */
  async verifyChainIntegrity(): Promise<{
    valid: boolean;
    totalRows: number;
    tamperedRowId?: string;
    tamperedRowIndex?: number;
    reason?: string;
  }> {
    const rows = await this.db
      .select()
      .from(auditLogs)
      .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));

    let expectedPrevHash = GENESIS_PREV_HASH;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // 1. Verify that prevHash points to the previous row's rowHash
      if (i === 0) {
        if (row.prevHash !== GENESIS_PREV_HASH) {
          return {
            valid: false,
            totalRows: rows.length,
            tamperedRowId: row.id,
            tamperedRowIndex: i,
            reason: `Genesis row prev_hash mismatch. Expected ${GENESIS_PREV_HASH}, found ${row.prevHash}`,
          };
        }
      } else {
        if (row.prevHash !== expectedPrevHash) {
          return {
            valid: false,
            totalRows: rows.length,
            tamperedRowId: row.id,
            tamperedRowIndex: i,
            reason: `Broken chain link at row ${i}: prev_hash does not match previous row_hash`,
          };
        }
      }

      // 2. Recompute rowHash and assert exact match
      const recomputed = computeRowHash({
        id: row.id,
        actorUserId: row.actorUserId,
        action: row.action,
        entityId: row.entityId,
        metadata: row.metadata,
        prevHash: row.prevHash,
      });

      if (recomputed !== row.rowHash) {
        return {
          valid: false,
          totalRows: rows.length,
          tamperedRowId: row.id,
          tamperedRowIndex: i,
          reason: `Payload tampering detected at row ${i} (${row.id}): recomputed hash ${recomputed} does not match stored hash ${row.rowHash}`,
        };
      }

      expectedPrevHash = row.rowHash;
    }

    return {
      valid: true,
      totalRows: rows.length,
    };
  }
}
