import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { AuditService, GENESIS_PREV_HASH, computeRowHash } from '../src/services/audit.js';
import { auditLogs } from '../src/db/schema.js';
import type { Database } from '../src/db/index.js';

describe('Audit Log Tamper-Evident SHA-256 Hash Chaining Suite', () => {
  let db: Database;
  let auditService: AuditService;

  beforeEach(() => {
    const mem = createInMemoryDatabase();
    db = mem.db;
    auditService = new AuditService(db);
  });

  it('correctly sets 64-character zeros as genesis prev_hash on first entry', async () => {
    const entry1 = await auditService.appendLog({
      actorType: 'system',
      action: 'system_bootstrapped',
      metadata: { env: 'test' },
    });

    expect(entry1.prevHash).toBe(GENESIS_PREV_HASH);
    expect(entry1.rowHash).toBeDefined();
    expect(entry1.rowHash.length).toBe(64);

    const integrity = await auditService.verifyChainIntegrity();
    expect(integrity.valid).toBe(true);
    expect(integrity.totalRows).toBe(1);
  });

  it('cryptographically chains subsequent entries sequentially', async () => {
    const e1 = await auditService.appendLog({
      actorType: 'human',
      actorUserId: 'user-alice-111',
      action: 'post_created',
      entityType: 'post',
      entityId: 'post-100',
      metadata: { title: 'First Post' },
    });

    const e2 = await auditService.appendLog({
      actorType: 'agent',
      patId: 'pat-claude-222',
      action: 'mcp_suggest_edit',
      entityType: 'post',
      entityId: 'post-100',
      metadata: { section: 'Summary' },
    });

    const e3 = await auditService.appendLog({
      actorType: 'human',
      actorUserId: 'user-bob-333',
      action: 'review_approved',
      entityType: 'post',
      entityId: 'post-100',
    });

    expect(e2.prevHash).toBe(e1.rowHash);
    expect(e3.prevHash).toBe(e2.rowHash);

    const integrity = await auditService.verifyChainIntegrity();
    expect(integrity.valid).toBe(true);
    expect(integrity.totalRows).toBe(3);
  });

  it('detects tampering when row action or metadata is retroactively modified', async () => {
    const e1 = await auditService.appendLog({
      actorType: 'human',
      action: 'post_created',
      entityId: 'post-100',
      metadata: { original: true },
    });

    const e2 = await auditService.appendLog({
      actorType: 'human',
      action: 'post_published',
      entityId: 'post-100',
      metadata: { approvedBy: 'reviewer' },
    });

    // Verify valid before attack
    const beforeTampering = await auditService.verifyChainIntegrity();
    expect(beforeTampering.valid).toBe(true);

    // ADVERSARIAL ATTACK: directly modify metadata in e1
    await db
      .update(auditLogs)
      .set({ metadata: { original: true, hacked: 'tampered' } })
      .where(eq(auditLogs.id, e1.id));

    // Chain verification must detect the payload hash mismatch on row e1
    const afterTampering = await auditService.verifyChainIntegrity();
    expect(afterTampering.valid).toBe(false);
    expect(afterTampering.tamperedRowId).toBe(e1.id);
    expect(afterTampering.tamperedRowIndex).toBe(0);
    expect(afterTampering.reason).toContain('Payload tampering detected');
  });

  it('detects broken chain link when an intermediate row is deleted', async () => {
    const e1 = await auditService.appendLog({ actorType: 'system', action: 'a1' });
    const e2 = await auditService.appendLog({ actorType: 'human', action: 'a2' });
    const e3 = await auditService.appendLog({ actorType: 'human', action: 'a3' });

    // ADVERSARIAL ATTACK: delete e2 from database
    await db.delete(auditLogs).where(eq(auditLogs.id, e2.id));

    // Chain verification must detect that e3.prevHash does not match e1.rowHash
    const check = await auditService.verifyChainIntegrity();
    expect(check.valid).toBe(false);
    expect(check.tamperedRowId).toBe(e3.id);
    expect(check.reason).toContain('Broken chain link');
  });
});
