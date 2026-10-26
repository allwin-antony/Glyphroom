import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { createApiApp } from '../src/app.js';
import { users, personalAccessTokens, auditLogs } from '../src/db/schema.js';
import type { Database } from '../src/db/index.js';
import { AuthService } from '../src/services/auth.js';

describe('admin user and PAT inventory', () => {
  let db: Database;
  let app: any;
  let close: () => Promise<void>;
  let adminId: string;
  let readerId: string;
  let csrfToken: string;
  let cookie: string;

  beforeEach(async () => {
    const mem = createInMemoryDatabase();
    db = mem.db;
    const [admin] = await db.insert(users).values({ email: 'admin@example.com', fullName: 'Admin', role: 'admin', isActive: true }).returning();
    const [reader] = await db.insert(users).values({ email: 'reader@example.com', fullName: 'Reader', role: 'reader', isActive: true }).returning();
    adminId = admin.id;
    readerId = reader.id;
    const instance = await createApiApp({ db, sessionSecret: 'admin-console-test-secret' });
    app = instance.app;
    close = instance.close;
    await app.ready();
    const authService = new AuthService(db, 'admin-console-test-secret');
    const token = authService.createSessionToken(admin);
    cookie = `blogger_session=${token}`;
    csrfToken = authService.generateCsrfToken(token);
  });

  afterEach(async () => close?.());

  it('lists users with search and updates role/status with audit records', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/users?q=reader', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().users.map((user: any) => user.id)).toContain(readerId);

    const role = await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${readerId}/role`, headers: { cookie, 'x-csrf-token': csrfToken }, payload: { role: 'author' } });
    expect(role.statusCode).toBe(200);
    const deactivate = await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${readerId}/status`, headers: { cookie, 'x-csrf-token': csrfToken }, payload: { isActive: false } });
    expect(deactivate.statusCode).toBe(200);
    expect(deactivate.json().user.isActive).toBe(false);
    const events = await db.select({ action: auditLogs.action }).from(auditLogs);
    expect(events.map((event) => event.action)).toEqual(expect.arrayContaining(['admin_user_role_updated', 'admin_user_deactivated']));
  });

  it('restricts inventory and user mutations to admins', async () => {
    const authService = new AuthService(db, 'admin-console-test-secret');
    const reader = await db.select().from(users);
    const readerUser = reader.find((user) => user.id === readerId)!;
    const token = authService.createSessionToken(readerUser);
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: { cookie: `blogger_session=${token}` } });
    expect(response.statusCode).toBe(403);
  });

  it('lists PATs without hashes and revokes them with audit logging', async () => {
    const [pat] = await db.insert(personalAccessTokens).values({ userId: readerId, name: 'Automation', tokenHash: 'secret-hash', scopes: ['post:read'] }).returning();
    const list = await app.inject({ method: 'GET', url: '/api/v1/admin/pats?status=active', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json().tokens[0]).not.toHaveProperty('tokenHash');
    expect(list.json().tokens[0].userEmail).toBe('reader@example.com');
    const revoke = await app.inject({ method: 'DELETE', url: `/api/v1/admin/pats/${pat.id}`, headers: { cookie, 'x-csrf-token': csrfToken } });
    expect(revoke.statusCode).toBe(200);
    const events = await db.select({ action: auditLogs.action }).from(auditLogs);
    expect(events.map((event) => event.action)).toContain('admin_pat_revoked');
  });
});
