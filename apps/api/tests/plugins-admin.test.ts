import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { createApiApp } from '../src/app.js';
import { BackendPluginRegistry } from '../src/plugins/registry.js';
import { pluginEventOutbox, users, auditLogs } from '../src/db/schema.js';
import type { GlyphroomBackendPlugin } from '../src/plugins/types.js';

const TEST_SECRET = 'test-secret-at-least-32-chars-long-for-hmac';

function createSessionCookie(user: { id: string; email: string; role: string; fullName: string }) {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    fullName: user.fullName,
    issuedAt: Math.floor(Date.now() / 1000),
    expiresAt: Math.floor(Date.now() / 1000) + 86400,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', TEST_SECRET).update(encoded).digest('base64url');
  const token = `${encoded}.${signature}`;
  const csrf = crypto.createHmac('sha256', TEST_SECRET).update(`csrf:${token}`).digest('hex');
  return {
    cookie: `blogger_session=${token}`,
    csrf,
  };
}

describe('Phase 6: Admin Operations & Plugin Diagnostics Suite', () => {
  it('allows admins to inspect installed plugins and retry failed outbox events with audit logging', async () => {
    const { db } = createInMemoryDatabase();
    const registry = new BackendPluginRegistry();

    const samplePlugin: GlyphroomBackendPlugin = {
      manifest: {
        id: 'sample-audit-plugin',
        name: 'Sample Audit Plugin',
        version: '1.2.0',
        description: 'Audits published articles',
        capabilities: ['api:events'],
      },
      registerEvents: () => {},
    };

    registry.register(samplePlugin);

    const [adminUser] = await db
      .insert(users)
      .values({
        email: 'admin@enterprise.local',
        fullName: 'Admin User',
        role: 'admin',
        isActive: true,
      })
      .returning();

    const [authorUser] = await db
      .insert(users)
      .values({
        email: 'author@enterprise.local',
        fullName: 'Author User',
        role: 'author',
        isActive: true,
      })
      .returning();

    const adminAuth = createSessionCookie(adminUser);
    const authorAuth = createSessionCookie(authorUser);

    // Seed a failed outbox event
    const [failedEvent] = await db
      .insert(pluginEventOutbox)
      .values({
        eventType: 'post:published',
        payload: { postId: 'p-1', title: 'Post 1' },
        status: 'failed',
        attempts: 5,
        lastError: 'Slack webhook connection timed out after 5000ms',
        processedAt: new Date(),
      })
      .returning();

    const { app, close } = await createApiApp({
      db,
      sessionSecret: TEST_SECRET,
      pluginRegistry: registry,
    });

    // 1. Author should be rejected with 403 Forbidden
    const unauthRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/plugins',
      headers: { cookie: authorAuth.cookie },
    });
    expect(unauthRes.statusCode).toBe(403);

    // 2. Admin inspects installed plugins
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/plugins',
      headers: { cookie: adminAuth.cookie },
    });

    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json();
    expect(listBody.plugins.length).toBe(1);
    expect(listBody.plugins[0].id).toBe('sample-audit-plugin');
    expect(listBody.plugins[0].version).toBe('1.2.0');
    expect(listBody.totalFailedOutboxEvents).toBe(1);

    // 3. Admin inspects failed events list
    const failedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/plugins/outbox/failed',
      headers: { cookie: adminAuth.cookie },
    });

    expect(failedRes.statusCode).toBe(200);
    const failedBody = failedRes.json();
    expect(failedBody.failedEvents.length).toBe(1);
    expect(failedBody.failedEvents[0].id).toBe(failedEvent.id);
    expect(failedBody.failedEvents[0].lastError).toContain('Slack webhook connection timed out');

    // 4. Admin triggers retry of failed events
    const retryRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/plugins/outbox/retry',
      headers: {
        cookie: adminAuth.cookie,
        'x-csrf-token': adminAuth.csrf,
      },
      payload: { eventId: failedEvent.id },
    });

    expect(retryRes.statusCode).toBe(200);
    expect(retryRes.json().retriedCount).toBe(1);

    // 5. Verify row is now 'pending' with reset attempts
    const [retriedRow] = await db
      .select()
      .from(pluginEventOutbox)
      .where(eq(pluginEventOutbox.id, failedEvent.id));

    expect(retriedRow.status).toBe('pending');
    expect(retriedRow.attempts).toBe(0);
    expect(retriedRow.lastError).toBeNull();

    // 6. Verify audit log entry was generated
    const auditEntries = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'plugin_outbox_retry'));

    expect(auditEntries.length).toBe(1);
    expect(auditEntries[0].actorUserId).toBe(adminUser.id);
    expect(auditEntries[0].entityId).toBe(failedEvent.id);

    await close();
  });
});
