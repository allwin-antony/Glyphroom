import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { AuthService } from '../src/services/auth.js';
import { users } from '../src/db/schema.js';
import type { Database } from '../src/db/index.js';

describe('Day-1 Corporate SSO & Break-Glass Local Admin Suite', () => {
  let db: Database;
  let authService: AuthService;

  beforeEach(() => {
    const mem = createInMemoryDatabase();
    db = mem.db;
    authService = new AuthService(db, 'super-secure-test-session-secret-32-chars-long');
  });

  describe('Break-Glass Local Admin Authentication', () => {
    it('verifies valid password for local admin account', async () => {
      const passwordHash = await authService.hashPassword('AdminRecoverySecret2026!');
      const [adminUser] = await db
        .insert(users)
        .values({
          email: 'admin@blogger.corp.internal',
          fullName: 'Emergency Local Administrator',
          role: 'admin',
          ssoProvider: 'local',
          passwordHash,
          isActive: true,
        })
        .returning();

      const verified = await authService.verifyLocalLogin('admin@blogger.corp.internal', 'AdminRecoverySecret2026!');
      expect(verified).not.toBeNull();
      expect(verified?.id).toBe(adminUser.id);
      expect(verified?.role).toBe('admin');
    });

    it('rejects wrong password with null', async () => {
      const passwordHash = await authService.hashPassword('CorrectPass123!');
      await db.insert(users).values({
        email: 'localadmin@test.com',
        fullName: 'Local Admin',
        role: 'admin',
        passwordHash,
        isActive: true,
      });

      const verified = await authService.verifyLocalLogin('localadmin@test.com', 'WrongPassword!');
      expect(verified).toBeNull();
    });

    it('rejects login for deactivated user accounts', async () => {
      const passwordHash = await authService.hashPassword('Password123!');
      await db.insert(users).values({
        email: 'deactivated@corp.com',
        fullName: 'Terminated Employee',
        role: 'author',
        passwordHash,
        isActive: false, // Deactivated!
      });

      const verified = await authService.verifyLocalLogin('deactivated@corp.com', 'Password123!');
      expect(verified).toBeNull();
    });
  });

  describe('Corporate SSO & JIT (Just-In-Time) User Provisioning', () => {
    it('provisions new user just-in-time on first OIDC SSO login', async () => {
      const newUser = await authService.handleSsoCallback(
        'oidc',
        {
          sub: 'entra-user-uuid-999',
          email: 'jane.engineer@corp.com',
          name: 'Jane Engineer',
          groups: ['Engineering_Authors'],
        },
        'author'
      );

      expect(newUser.id).toBeDefined();
      expect(newUser.email).toBe('jane.engineer@corp.com');
      expect(newUser.fullName).toBe('Jane Engineer');
      expect(newUser.role).toBe('author');
      expect(newUser.ssoProvider).toBe('oidc');
      expect(newUser.ssoSubject).toBe('entra-user-uuid-999');

      // Verify persisted in DB
      const [inDb] = await db.select().from(users).where(eq(users.id, newUser.id));
      expect(inDb).toBeDefined();
    });

    it('maps corporate IdP groups to system roles accurately', async () => {
      const adminUser = await authService.handleSsoCallback('okta', {
        sub: 'okta-sub-1',
        email: 'corp.admin@corp.com',
        groups: ['CORP_BLOGGER_ADMIN'],
      });
      expect(adminUser.role).toBe('admin');

      const modUser = await authService.handleSsoCallback('okta', {
        sub: 'okta-sub-2',
        email: 'corp.mod@corp.com',
        groups: ['Editorial_Reviewers'],
      });
      expect(modUser.role).toBe('moderator');
    });

    it('links SSO identity to existing pre-created user by email', async () => {
      // Pre-created local user
      const [existing] = await db
        .insert(users)
        .values({
          email: 'bob@corp.com',
          fullName: 'Bob Pre-Provisioned',
          role: 'author',
          isActive: true,
        })
        .returning();

      const linked = await authService.handleSsoCallback('keycloak', {
        sub: 'keycloak-sub-555',
        email: 'bob@corp.com',
        name: 'Bob Updated Name',
      });

      expect(linked.id).toBe(existing.id);
      expect(linked.ssoProvider).toBe('keycloak');
      expect(linked.ssoSubject).toBe('keycloak-sub-555');
      expect(linked.fullName).toBe('Bob Updated Name');
    });
  });

  describe('Session Tokens & CSRF Protection', () => {
    it('creates and verifies cryptographically signed session tokens', () => {
      const mockUser = {
        id: 'user-uuid-1',
        email: 'test@corp.com',
        role: 'author' as const,
        fullName: 'Test User',
        ssoProvider: 'oidc',
      };

      const token = authService.createSessionToken(mockUser as any, 3600);
      expect(token).toContain('.');

      const payload = authService.verifySessionToken(token);
      expect(payload).not.toBeNull();
      expect(payload?.userId).toBe('user-uuid-1');
      expect(payload?.role).toBe('author');
      expect(payload?.email).toBe('test@corp.com');
    });

    it('rejects tampered session tokens', () => {
      const mockUser = { id: 'u1', email: 'u@c.com', role: 'reader' as const, fullName: 'U' };
      const token = authService.createSessionToken(mockUser as any, 3600);

      const [encoded, sig] = token.split('.');
      const tamperedToken = `${encoded}.${sig}tampered`;

      expect(authService.verifySessionToken(tamperedToken)).toBeNull();
    });

    it('generates and validates CSRF token tied to session', () => {
      const mockUser = { id: 'u1', email: 'u@c.com', role: 'author' as const, fullName: 'U' };
      const sessionToken = authService.createSessionToken(mockUser as any, 3600);

      const csrf = authService.generateCsrfToken(sessionToken);
      expect(authService.verifyCsrfToken(sessionToken, csrf)).toBe(true);
      expect(authService.verifyCsrfToken(sessionToken, 'invalid-csrf-token')).toBe(false);
      expect(authService.verifyCsrfToken('different-session', csrf)).toBe(false);
    });
  });
});
