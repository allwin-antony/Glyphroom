import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { createApiApp } from '../src/app.js';
import { users, notifications } from '../src/db/schema.js';

describe('notifications API', () => {
  let api: any;
  let db: any;
  let user: any;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db } = createInMemoryDatabase());
    ({ app: api, close } = await createApiApp({ db }));
    [user] = await db.insert(users).values({ email: 'notify@example.test', fullName: 'Notify User', role: 'author' }).returning();
    await db.insert(notifications).values([
      { userId: user.id, type: 'review_decision', title: 'One', body: 'First' },
      { userId: user.id, type: 'published', title: 'Two', body: 'Second' },
    ]);
  });

  afterAll(async () => close());

  function auth() {
    const secret = process.env.SESSION_SECRET || 'enterprise-blogger-session-secret-key-32b-min';
    const payload = Buffer.from(JSON.stringify({ userId: user.id, email: user.email, role: user.role, fullName: user.fullName, issuedAt: 1, expiresAt: 9999999999 })).toString('base64url');
    const token = `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
    return `blogger_session=${token}`;
  }

  it('lists paginated notifications and unread count', async () => {
    const response = await api.inject({ method: 'GET', url: '/api/v1/notifications?page=1&limit=1', headers: { cookie: auth() } });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).notifications).toHaveLength(1);
    expect(JSON.parse(response.body).unreadCount).toBe(2);
  });

  it('marks one and all notifications read for the current user', async () => {
    const list = await api.inject({ method: 'GET', url: '/api/v1/notifications', headers: { cookie: auth() } });
    const id = JSON.parse(list.body).notifications[0].id;
    const one = await api.inject({ method: 'POST', url: `/api/v1/notifications/${id}/read`, headers: { cookie: auth(), 'x-csrf-token': '' } });
    expect(one.statusCode).toBe(403);
    const secret = process.env.SESSION_SECRET || 'enterprise-blogger-session-secret-key-32b-min';
    const token = auth().slice('blogger_session='.length);
    const csrf = crypto.createHmac('sha256', secret).update(`csrf:${token}`).digest('hex');
    const marked = await api.inject({ method: 'POST', url: `/api/v1/notifications/${id}/read`, headers: { cookie: auth(), 'x-csrf-token': csrf } });
    expect(marked.statusCode).toBe(200);
    const all = await api.inject({ method: 'POST', url: '/api/v1/notifications/read-all', headers: { cookie: auth(), 'x-csrf-token': csrf } });
    expect(all.statusCode).toBe(200);
    const after = await api.inject({ method: 'GET', url: '/api/v1/notifications', headers: { cookie: auth() } });
    expect(JSON.parse(after.body).unreadCount).toBe(0);
  });
});
