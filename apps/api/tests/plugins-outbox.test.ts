import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { createApiApp } from '../src/app.js';
import { BackendPluginRegistry } from '../src/plugins/registry.js';
import { OutboxService } from '../src/plugins/outbox.js';
import { pluginEventOutbox, users } from '../src/db/schema.js';
import type { GlyphroomBackendPlugin } from '../src/plugins/types.js';
import type { PluginEventEnvelope } from '@enterprise-blogger/shared';

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

describe('Phase 2: Durable Domain Events & Outbox Suite', () => {
  it('enqueues domain events on post creation and dispatches to registered plugin handlers', async () => {
    const { db } = createInMemoryDatabase();
    const registry = new BackendPluginRegistry();

    const receivedEvents: PluginEventEnvelope<any>[] = [];

    const eventConsumerPlugin: GlyphroomBackendPlugin = {
      manifest: {
        id: 'event-consumer',
        name: 'Event Consumer',
        version: '1.0.0',
        capabilities: ['api:events'],
      },
      registerEvents: (bus) => {
        bus.on('post:created', (event) => {
          receivedEvents.push(event);
        });
      },
    };

    registry.register(eventConsumerPlugin);

    // Seed test author user
    const [author] = await db
      .insert(users)
      .values({
        email: 'author@enterprise.local',
        fullName: 'Test Author',
        role: 'author',
        isActive: true,
      })
      .returning();

    const auth = createSessionCookie(author);

    const { app, outboxService, close } = await createApiApp({
      db,
      sessionSecret: TEST_SECRET,
      pluginRegistry: registry,
    });

    // 1. Create a post via API
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: {
        cookie: auth.cookie,
        'x-csrf-token': auth.csrf,
      },
      payload: {
        title: 'Durable Event Architecture',
        slug: 'durable-event-architecture',
        visibility: 'space',
      },
    });

    expect(res.statusCode).toBe(201);
    const createdPost = res.json().post;

    // 2. Verify row exists in plugin_event_outbox with status 'pending'
    const outboxRows = await db
      .select()
      .from(pluginEventOutbox)
      .where(eq(pluginEventOutbox.eventType, 'post:created'));

    expect(outboxRows.length).toBe(1);
    expect(outboxRows[0].status).toBe('pending');
    expect(outboxRows[0].payload).toMatchObject({
      postId: createdPost.id,
      authorId: author.id,
      title: 'Durable Event Architecture',
    });

    // 3. Process pending outbox batch
    const result = await outboxService.processPending();
    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);

    // 4. Verify listener received envelope
    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].type).toBe('post:created');
    expect(receivedEvents[0].payload.postId).toBe(createdPost.id);

    // 5. Verify row updated to 'delivered'
    const [updatedRow] = await db
      .select()
      .from(pluginEventOutbox)
      .where(eq(pluginEventOutbox.id, outboxRows[0].id));

    expect(updatedRow.status).toBe('delivered');
    expect(updatedRow.processedAt).not.toBeNull();
    expect(updatedRow.lastError).toBeNull();

    await close();
  });

  it('isolates plugin failures and performs bounded exponential backoff up to max attempts', async () => {
    const { db } = createInMemoryDatabase();
    const registry = new BackendPluginRegistry();

    let attemptsCount = 0;

    const flakyPlugin: GlyphroomBackendPlugin = {
      manifest: {
        id: 'flaky-webhook',
        name: 'Flaky Webhook',
        version: '1.0.0',
        capabilities: ['api:events'],
      },
      registerEvents: (bus) => {
        bus.on('comment:created', () => {
          attemptsCount++;
          throw new Error(`Webhook endpoint HTTP 503 Service Unavailable (attempt ${attemptsCount})`);
        });
      },
    };

    registry.register(flakyPlugin);

    const bus = registry.getEventBus();
    flakyPlugin.registerEvents!(bus);

    const outboxService = new OutboxService(db, bus, 3); // Max 3 attempts for test

    // Direct enqueue
    const eventId = await outboxService.enqueue(db, 'comment:created', {
      commentId: '00000000-0000-0000-0000-000000000001',
      postId: '00000000-0000-0000-0000-000000000002',
      authorId: '00000000-0000-0000-0000-000000000003',
    });

    // 1st attempt
    let batchResult = await outboxService.processPending();
    expect(batchResult.processed).toBe(1);
    expect(batchResult.succeeded).toBe(0);

    let [row] = await db.select().from(pluginEventOutbox).where(eq(pluginEventOutbox.id, eventId));
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain('HTTP 503');

    // Simulate time elapsed by resetting availableAt to the past
    await db
      .update(pluginEventOutbox)
      .set({ availableAt: new Date(Date.now() - 1000) })
      .where(eq(pluginEventOutbox.id, eventId));

    // 2nd attempt
    batchResult = await outboxService.processPending();
    expect(batchResult.processed).toBe(1);
    [row] = await db.select().from(pluginEventOutbox).where(eq(pluginEventOutbox.id, eventId));
    expect(row.attempts).toBe(2);
    expect(row.status).toBe('pending');

    // Simulate time elapsed again
    await db
      .update(pluginEventOutbox)
      .set({ availableAt: new Date(Date.now() - 1000) })
      .where(eq(pluginEventOutbox.id, eventId));

    // 3rd attempt -> reaches maxAttempts (3) -> status marked 'failed'
    batchResult = await outboxService.processPending();
    expect(batchResult.processed).toBe(1);
    expect(batchResult.failed).toBe(1);

    [row] = await db.select().from(pluginEventOutbox).where(eq(pluginEventOutbox.id, eventId));
    expect(row.attempts).toBe(3);
    expect(row.status).toBe('failed');
    expect(row.processedAt).not.toBeNull();

    // Verify retryFailed resets it back to pending
    const retriedCount = await outboxService.retryFailed(eventId);
    expect(retriedCount).toBe(1);

    [row] = await db.select().from(pluginEventOutbox).where(eq(pluginEventOutbox.id, eventId));
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(0);
    expect(row.lastError).toBeNull();
  });

  it('enqueues space:created and space:archived lifecycle events', async () => {
    const { db } = createInMemoryDatabase();
    const registry = new BackendPluginRegistry();

    const capturedEvents: string[] = [];
    const spaceAuditorPlugin: GlyphroomBackendPlugin = {
      manifest: {
        id: 'space-auditor',
        name: 'Space Auditor',
        version: '1.0.0',
        capabilities: ['api:events'],
      },
      registerEvents: (bus) => {
        bus.on('space:created', (e) => capturedEvents.push(`created:${e.payload.spaceId}`));
        bus.on('space:archived', (e) => capturedEvents.push(`archived:${e.payload.spaceId}`));
      },
    };

    registry.register(spaceAuditorPlugin);

    const [adminUser] = await db
      .insert(users)
      .values({
        email: 'admin@enterprise.local',
        fullName: 'Admin User',
        role: 'admin',
        isActive: true,
      })
      .returning();

    const auth = createSessionCookie(adminUser);

    const { app, outboxService, close } = await createApiApp({
      db,
      sessionSecret: TEST_SECRET,
      pluginRegistry: registry,
    });

    // 1. Create a space
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/spaces',
      headers: {
        cookie: auth.cookie,
        'x-csrf-token': auth.csrf,
      },
      payload: {
        name: 'Platform Infrastructure',
        slug: 'platform-infra',
        description: 'Core platform docs',
      },
    });

    expect(createRes.statusCode).toBe(201);
    const spaceId = createRes.json().space.id;

    // 2. Archive the space
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/spaces/${spaceId}`,
      headers: {
        cookie: auth.cookie,
        'x-csrf-token': auth.csrf,
      },
      payload: {
        isArchived: true,
      },
    });

    expect(patchRes.statusCode).toBe(200);

    // 3. Process outbox
    await outboxService.processPending();

    expect(capturedEvents).toEqual([`created:${spaceId}`, `archived:${spaceId}`]);

    await close();
  });

  it('dispatches post:submitted_for_review, post:reviewed, post:published, and comment:created through full publication lifecycle', async () => {
    const { db } = createInMemoryDatabase();
    const registry = new BackendPluginRegistry();

    const dispatchedEventTypes: string[] = [];

    const lifecyclePlugin: GlyphroomBackendPlugin = {
      manifest: {
        id: 'lifecycle-plugin',
        name: 'Lifecycle Plugin',
        version: '1.0.0',
        capabilities: ['api:events'],
      },
      registerEvents: (bus) => {
        bus.on('post:submitted_for_review', (e) => dispatchedEventTypes.push(e.type));
        bus.on('post:reviewed', (e) => dispatchedEventTypes.push(e.type));
        bus.on('post:published', (e) => dispatchedEventTypes.push(e.type));
        bus.on('comment:created', (e) => dispatchedEventTypes.push(e.type));
      },
    };

    registry.register(lifecyclePlugin);

    const [author] = await db
      .insert(users)
      .values({
        email: 'author@enterprise.local',
        fullName: 'Author User',
        role: 'author',
        isActive: true,
      })
      .returning();

    const [reviewer] = await db
      .insert(users)
      .values({
        email: 'reviewer@enterprise.local',
        fullName: 'Reviewer Admin',
        role: 'admin',
        isActive: true,
      })
      .returning();

    const authorAuth = createSessionCookie(author);
    const reviewerAuth = createSessionCookie(reviewer);

    const { app, outboxService, close } = await createApiApp({
      db,
      sessionSecret: TEST_SECRET,
      pluginRegistry: registry,
    });

    // 1. Create post
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/posts',
      headers: { cookie: authorAuth.cookie, 'x-csrf-token': authorAuth.csrf },
      payload: {
        title: 'Review Lifecycle Post',
        slug: 'review-lifecycle-post',
        visibility: 'space',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const postId = createRes.json().post.id;

    // 2. Submit for review
    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${postId}/submit-review`,
      headers: { cookie: authorAuth.cookie, 'x-csrf-token': authorAuth.csrf },
    });
    expect(submitRes.statusCode).toBe(200);

    // 3. Add comment
    const commentRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${postId}/comments`,
      headers: { cookie: reviewerAuth.cookie, 'x-csrf-token': reviewerAuth.csrf },
      payload: { content: 'Please double-check architectural diagrams.' },
    });
    expect(commentRes.statusCode).toBe(201);

    // 4. Submit review decision (approved)
    const reviewRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${postId}/reviews`,
      headers: { cookie: reviewerAuth.cookie, 'x-csrf-token': reviewerAuth.csrf },
      payload: { decision: 'approved', notes: 'Looks ready for production' },
    });
    expect(reviewRes.statusCode).toBe(201);

    // 5. Publish post
    const publishRes = await app.inject({
      method: 'POST',
      url: `/api/v1/posts/${postId}/publish`,
      headers: { cookie: reviewerAuth.cookie, 'x-csrf-token': reviewerAuth.csrf },
    });
    expect(publishRes.statusCode).toBe(200);

    // 6. Process outbox batch
    const batchResult = await outboxService.processPending();
    expect(batchResult.processed).toBeGreaterThanOrEqual(4);

    expect(dispatchedEventTypes).toContain('post:submitted_for_review');
    expect(dispatchedEventTypes).toContain('comment:created');
    expect(dispatchedEventTypes).toContain('post:reviewed');
    expect(dispatchedEventTypes).toContain('post:published');

    await close();
  });
});
