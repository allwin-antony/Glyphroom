import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { createApiApp } from '../src/app.js';
import { users, auditLogs } from '../src/db/schema.js';
import type { Database } from '../src/db/index.js';

describe('Milestone M1 Adversarial Security Suite (Backend API)', () => {
  let db: Database;
  let app: any;
  let close: () => Promise<void>;

  const BREAK_GLASS_EMAIL = 'admin@enterprise-blogger.local';
  const BREAK_GLASS_PASSWORD = 'admin2026!';
  const SESSION_SECRET = 'adversarial-security-session-secret-32b-min';

  let adminSession: string;
  let adminCsrf: string;
  let modSession: string;
  let modCsrf: string;
  let authorSession: string;
  let authorCsrf: string;
  let readerSession: string;
  let readerCsrf: string;

  beforeEach(async () => {
    const mem = createInMemoryDatabase();
    db = mem.db;

    // Seed break-glass admin
    const breakGlassHash = await bcrypt.hash(BREAK_GLASS_PASSWORD, 10);
    await db.insert(users).values({
      email: BREAK_GLASS_EMAIL,
      fullName: 'Break-Glass System Administrator',
      role: 'admin',
      ssoProvider: 'local',
      passwordHash: breakGlassHash,
      isActive: true,
    });

    // Seed moderator
    const [mod] = await db.insert(users).values({
      email: 'moderator@enterprise-blogger.local',
      fullName: 'Editorial Moderator',
      role: 'moderator',
      ssoProvider: 'oidc',
      isActive: true,
    }).returning();

    // Seed author
    const [author] = await db.insert(users).values({
      email: 'author@enterprise-blogger.local',
      fullName: 'Content Author',
      role: 'author',
      ssoProvider: 'oidc',
      isActive: true,
    }).returning();

    // Seed reader
    const [reader] = await db.insert(users).values({
      email: 'reader@enterprise-blogger.local',
      fullName: 'General Reader',
      role: 'reader',
      ssoProvider: 'oidc',
      isActive: true,
    }).returning();

    const instance = await createApiApp({
      db,
      sessionSecret: SESSION_SECRET,
    });
    app = instance.app;
    close = instance.close;
    await app.ready();

    // Helper login for break-glass admin
    const adminLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: BREAK_GLASS_EMAIL, password: BREAK_GLASS_PASSWORD },
    });
    adminSession = adminLoginRes.cookies.find((c: any) => c.name === 'blogger_session')?.value;
    adminCsrf = adminLoginRes.json().csrfToken;

    // Helper SSO login for moderator
    const modLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sso/callback',
      payload: { provider: 'oidc', sub: 'mod-sub', email: mod.email, roles: ['moderator'] },
    });
    modSession = modLoginRes.cookies.find((c: any) => c.name === 'blogger_session')?.value;
    modCsrf = modLoginRes.json().csrfToken;

    // Helper SSO login for author
    const authorLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sso/callback',
      payload: { provider: 'oidc', sub: 'author-sub', email: author.email, roles: ['author'] },
    });
    authorSession = authorLoginRes.cookies.find((c: any) => c.name === 'blogger_session')?.value;
    authorCsrf = authorLoginRes.json().csrfToken;

    // Helper SSO login for reader
    const readerLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sso/callback',
      payload: { provider: 'oidc', sub: 'reader-sub', email: reader.email, roles: ['reader'] },
    });
    readerSession = readerLoginRes.cookies.find((c: any) => c.name === 'blogger_session')?.value;
    readerCsrf = readerLoginRes.json().csrfToken;
  });

  afterEach(async () => {
    if (close) {
      await close();
    }
  });

  // =========================================================================
  // 1. ADVERSARIAL CSRF INJECTION & INTEGRITY
  // =========================================================================
  describe('Adversarial CSRF Injection & Integrity', () => {
    it('rejects POST requests with missing x-csrf-token header (403 Forbidden)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/posts',
        headers: { cookie: `blogger_session=${authorSession}` },
        payload: { title: 'CSRF Attack', slug: 'csrf-attack-1' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toContain('CSRF token');
    });

    it('rejects PUT/PATCH/DELETE mutating requests with missing x-csrf-token header', async () => {
      // Create a post with valid CSRF first
      const postRes = await app.inject({
        method: 'POST',
        url: '/api/v1/posts',
        headers: {
          cookie: `blogger_session=${authorSession}`,
          'x-csrf-token': authorCsrf,
        },
        payload: { title: 'Original Post', slug: 'orig-post' },
      });
      const postId = postRes.json().post.id;

      // PATCH without CSRF -> 403
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/posts/${postId}`,
        headers: { cookie: `blogger_session=${authorSession}` },
        payload: { title: 'Tampered Title' },
      });
      expect(patchRes.statusCode).toBe(403);

      // DELETE (via PAT route or similar mutation) without CSRF -> 403
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: '/api/v1/pats/00000000-0000-0000-0000-000000000001',
        headers: { cookie: `blogger_session=${adminSession}` },
      });
      expect(deleteRes.statusCode).toBe(403);
    });

    it('rejects completely fabricated/random CSRF tokens (403 Forbidden)', async () => {
      const randomTokens = [
        '0000000000000000000000000000000000000000000000000000000000000000',
        'deadbeefcafe1234567890abcdef',
        'invalid-csrf-format',
        '',
        '   ',
        '!@#$%^&*()',
      ];

      for (const token of randomTokens) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/posts',
          headers: {
            cookie: `blogger_session=${authorSession}`,
            'x-csrf-token': token,
          },
          payload: { title: 'Fabricated Token Post', slug: 'fab-post' },
        });
        expect(res.statusCode).toBe(403);
      }
    });

    it('STRESS TEST: rejects Cross-Session CSRF Token Swapping (Token fixation/theft)', async () => {
      // Author attempts mutation sending their session cookie BUT using Admin's CSRF token
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/posts',
        headers: {
          cookie: `blogger_session=${authorSession}`,
          'x-csrf-token': adminCsrf, // Swapped token!
        },
        payload: { title: 'Token Swap Attack', slug: 'swap-attack' },
      });
      expect(res1.statusCode).toBe(403);
      expect(res1.json().message).toContain('CSRF token');

      // Admin attempts mutation sending their session cookie BUT using Reader's CSRF token
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/pats',
        headers: {
          cookie: `blogger_session=${adminSession}`,
          'x-csrf-token': readerCsrf, // Swapped token!
        },
        payload: { name: 'Exploit Token', scopes: ['post:read'] },
      });
      expect(res2.statusCode).toBe(403);
      expect(res2.json().message).toContain('CSRF token');
    });

    it('permits safe GET requests without requiring x-csrf-token header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/posts',
        headers: { cookie: `blogger_session=${readerSession}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().posts).toBeDefined();
    });

    it('returns 401 Unauthorized (not 403) when mutating request has no session at all', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/posts',
        payload: { title: 'Unauthenticated Post', slug: 'unauth-post' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('Unauthorized');
    });
  });

  // =========================================================================
  // 2. BREAK-GLASS LOCAL ADMIN LOGIN ADVERSARIAL STRESS
  // =========================================================================
  describe('Break-Glass Local Admin Authentication', () => {
    it('authenticates seeded admin credentials with valid session and CSRF token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'admin@enterprise-blogger.local',
          password: 'admin2026!',
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.user.email).toBe('admin@enterprise-blogger.local');
      expect(data.user.role).toBe('admin');
      expect(data.csrfToken).toBeDefined();
      expect(typeof data.csrfToken).toBe('string');
      expect(data.csrfToken.length).toBe(64); // 32-byte hex HMAC

      const sessionCookie = res.cookies.find((c: any) => c.name === 'blogger_session');
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie?.httpOnly).toBe(true);
      expect(sessionCookie?.sameSite).toBe('Strict');
    });

    it('rejects wrong passwords with 401 Unauthorized', async () => {
      const badPasswords = [
        'wrongpassword',
        'admin2026',
        'ADMIN2026!',
        'admin2026! ',
        ' admin2026!',
        'password123',
        'admin',
      ];

      for (const badPass of badPasswords) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: {
            email: 'admin@enterprise-blogger.local',
            password: badPass,
          },
        });
        expect(res.statusCode).toBe(401);
        expect(res.json().message).toBe('Invalid credentials');
      }
    });

    it('normalizes email casing and handles case-insensitive break-glass login', async () => {
      const caseVariations = [
        'ADMIN@ENTERPRISE-BLOGGER.LOCAL',
        'Admin@Enterprise-Blogger.Local',
        'admin@ENTERPRISE-BLOGGER.local',
      ];

      for (const emailVar of caseVariations) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: {
            email: emailVar,
            password: 'admin2026!',
          },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().user.email).toBe('admin@enterprise-blogger.local');
      }
    });

    it('rejects raw untrimmed email with 400 Validation failed at API boundary', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: '  admin@enterprise-blogger.local  ',
          password: 'admin2026!',
        },
      });
      // Zod z.string().email() requires trimming; without .trim() on schema it returns 400
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Validation failed');
    });

    it('rejects SQL injection and malicious payloads in email field with 400 or 401', async () => {
      const maliciousEmails = [
        "' OR '1'='1",
        "admin@enterprise-blogger.local'--",
        "admin@enterprise-blogger.local'; DROP TABLE users; --",
        "\" or 1=1--@evil.com",
        "admin@enterprise-blogger.local<script>alert(1)</script>",
        "",
        null,
      ];

      for (const badEmail of maliciousEmails) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: {
            email: badEmail,
            password: 'admin2026!',
          },
        });
        // Zod validation should reject malformed email format with 400
        expect([400, 401]).toContain(res.statusCode);
      }
    });

    it('rejects login when account is deactivated (isActive: false) with 401', async () => {
      // Deactivate break-glass admin
      await db.update(users)
        .set({ isActive: false })
        .where(eq(users.email, 'admin@enterprise-blogger.local'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'admin@enterprise-blogger.local',
          password: 'admin2026!',
        },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().message).toBe('Invalid credentials');

      // Re-activate for downstream tests
      await db.update(users)
        .set({ isActive: true })
        .where(eq(users.email, 'admin@enterprise-blogger.local'));
    });

    it('records audit log entries on failed and successful break-glass logins', async () => {
      // Trigger failure
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'admin@enterprise-blogger.local', password: 'bad' },
      });

      // Trigger success
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'admin@enterprise-blogger.local', password: 'admin2026!' },
      });

      const logs = await db.select().from(auditLogs);
      const failedEntry = logs.find((l) => l.action === 'auth_login_failed');
      const successEntry = logs.find((l) => l.action === 'auth_local_login_success');

      expect(failedEntry).toBeDefined();
      expect(failedEntry?.rowHash).toBeDefined();
      expect(successEntry).toBeDefined();
      expect(successEntry?.rowHash).toBeDefined();
    });
  });

  // =========================================================================
  // 3. AUDIT VERIFY ROUTE ALIAS & CRYPTOGRAPHIC CHAIN INTEGRITY
  // =========================================================================
  describe('Audit Verify Route Alias (/api/v1/audit/verify)', () => {
    it('returns 200 OK with valid: true for Admin on /api/v1/audit/verify', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/audit/verify',
        headers: { cookie: `blogger_session=${adminSession}` },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.valid).toBe(true);
      expect(typeof data.totalRows).toBe('number');
      expect(data.totalRows).toBeGreaterThan(0);
    });

    it('produces identical payload on /api/v1/audit/verify and /api/v1/audit-logs/verify', async () => {
      const resAlias = await app.inject({
        method: 'GET',
        url: '/api/v1/audit/verify',
        headers: { cookie: `blogger_session=${adminSession}` },
      });

      const resCanonical = await app.inject({
        method: 'GET',
        url: '/api/v1/audit-logs/verify',
        headers: { cookie: `blogger_session=${adminSession}` },
      });

      expect(resAlias.statusCode).toBe(200);
      expect(resCanonical.statusCode).toBe(200);
      expect(resAlias.json()).toEqual(resCanonical.json());
    });

    it('enforces RBAC: returns 401 for unauthenticated requests on /api/v1/audit/verify', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/audit/verify',
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('Unauthorized');
    });

    it('enforces RBAC: returns 403 Forbidden for non-admin users (reader, author, moderator)', async () => {
      const nonAdminSessions = [
        { role: 'reader', session: readerSession },
        { role: 'author', session: authorSession },
        { role: 'moderator', session: modSession },
      ];

      for (const { role, session } of nonAdminSessions) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/audit/verify',
          headers: { cookie: `blogger_session=${session}` },
        });
        expect(res.statusCode).toBe(403);
        expect(res.json().message).toContain('Insufficient role permissions');
      }
    });

    it('ADVERSARIAL ATTACK: detects payload tampering and returns valid: false with tamperedRowId', async () => {
      // 1. Verify chain is initially valid
      const initial = await app.inject({
        method: 'GET',
        url: '/api/v1/audit/verify',
        headers: { cookie: `blogger_session=${adminSession}` },
      });
      expect(initial.json().valid).toBe(true);

      // 2. Tamper with the most recent audit entry in the database
      const [lastLog] = await db.select().from(auditLogs).limit(1);
      expect(lastLog).toBeDefined();

      await db.update(auditLogs)
        .set({ action: 'tampered_adversarial_action' })
        .where(eq(auditLogs.id, lastLog.id));

      // 3. Chain verification endpoint must catch the tampering
      const tamperedRes = await app.inject({
        method: 'GET',
        url: '/api/v1/audit/verify',
        headers: { cookie: `blogger_session=${adminSession}` },
      });

      expect(tamperedRes.statusCode).toBe(200);
      const tamperedData = tamperedRes.json();
      expect(tamperedData.valid).toBe(false);
      expect(tamperedData.tamperedRowId).toBe(lastLog.id);
      expect(tamperedData.reason).toContain('tampering detected');
    });
  });

  // =========================================================================
  // 4. ROLE-BASED ROUTE ACCESS CONTROL STRESS
  // =========================================================================
  describe('RBAC Route Protection Hardening', () => {
    it('prevents reader from creating posts (403 Forbidden)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/posts',
        headers: {
          cookie: `blogger_session=${readerSession}`,
          'x-csrf-token': readerCsrf,
        },
        payload: { title: 'Unauthorized Post', slug: 'unauth-post' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('prevents author from revoking another user PAT token (Admin only -> 404/403)', async () => {
      // Admin creates a PAT
      const adminPatRes = await app.inject({
        method: 'POST',
        url: '/api/v1/pats',
        headers: {
          cookie: `blogger_session=${adminSession}`,
          'x-csrf-token': adminCsrf,
        },
        payload: { name: 'Admin Only PAT', scopes: ['admin:all'] },
      });
      const adminPatId = adminPatRes.json().token.id;

      // Author attempts to delete Admin's PAT -> 404 Not Found or Access Denied
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/pats/${adminPatId}`,
        headers: {
          cookie: `blogger_session=${authorSession}`,
          'x-csrf-token': authorCsrf,
        },
      });
      expect(deleteRes.statusCode).toBe(404);
      expect(deleteRes.json().message).toContain('Token not found or access denied');
    });

    it('prevents non-admins from listing audit logs (/api/v1/audit-logs and /api/v1/audit)', async () => {
      for (const url of ['/api/v1/audit-logs', '/api/v1/audit']) {
        const res = await app.inject({
          method: 'GET',
          url,
          headers: { cookie: `blogger_session=${modSession}` },
        });
        expect(res.statusCode).toBe(403);
      }
    });
  });
});
