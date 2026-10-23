import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { users } from '../db/schema.js';

export interface OidcClaims {
  sub: string;
  email: string;
  name?: string;
  roles?: string[];
  groups?: string[];
}

export interface SessionPayload {
  userId: string;
  email: string;
  role: 'admin' | 'moderator' | 'author' | 'reader';
  fullName: string;
  ssoProvider?: string | null;
  issuedAt: number;
  expiresAt: number;
}

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly sessionSecret: string = process.env.SESSION_SECRET || 'enterprise-blogger-session-secret-key-32b-min'
  ) {}

  /**
   * Hash password for break-glass local admin or local testing
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  /**
   * Verify break-glass local admin credentials
   */
  async verifyLocalLogin(email: string, password: string): Promise<typeof users.$inferSelect | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (!user || !user.isActive || !user.passwordHash) {
      return null;
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return null;
    }

    return user;
  }

  /**
   * Just-In-Time (JIT) provisioning for corporate OIDC / SAML SSO
   */
  async handleSsoCallback(
    provider: 'oidc' | 'entra' | 'okta' | 'keycloak' | 'saml',
    claims: OidcClaims,
    defaultRole: 'author' | 'reader' = 'author'
  ): Promise<typeof users.$inferSelect> {
    const normalizedEmail = claims.email.trim().toLowerCase();
    const fullName = claims.name || normalizedEmail.split('@')[0];

    // Determine role from corporate claims/groups if provided
    let assignedRole: 'admin' | 'moderator' | 'author' | 'reader' = defaultRole;
    const combinedRoles = [...(claims.roles || []), ...(claims.groups || [])].map((r) => r.toLowerCase());

    if (combinedRoles.some((r) => r.includes('admin') || r.includes('blogger_admin'))) {
      assignedRole = 'admin';
    } else if (combinedRoles.some((r) => r.includes('mod') || r.includes('editor') || r.includes('reviewer'))) {
      assignedRole = 'moderator';
    } else if (combinedRoles.some((r) => r.includes('author') || r.includes('writer'))) {
      assignedRole = 'author';
    }

    // 1. Look up existing user by SSO subject or email
    const [existingBySubject] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.ssoProvider, provider), eq(users.ssoSubject, claims.sub)))
      .limit(1);

    if (existingBySubject) {
      if (!existingBySubject.isActive) {
        throw new Error('Account has been deactivated');
      }

      // Update full name or role if changed
      const [updated] = await this.db
        .update(users)
        .set({
          fullName,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingBySubject.id))
        .returning();

      return updated;
    }

    const [existingByEmail] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existingByEmail) {
      if (!existingByEmail.isActive) {
        throw new Error('Account has been deactivated');
      }

      // Link SSO identity to existing email account
      const [updated] = await this.db
        .update(users)
        .set({
          ssoProvider: provider,
          ssoSubject: claims.sub,
          fullName,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingByEmail.id))
        .returning();

      return updated;
    }

    // 2. JIT Provision new user
    const [newUser] = await this.db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        email: normalizedEmail,
        fullName,
        role: assignedRole,
        ssoProvider: provider,
        ssoSubject: claims.sub,
        isActive: true,
      })
      .returning();

    return newUser;
  }

  /**
   * Create a tamper-proof signed session token (HMAC-SHA256)
   */
  createSessionToken(user: typeof users.$inferSelect, ttlSeconds = 86400): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: SessionPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      ssoProvider: user.ssoProvider,
      issuedAt: now,
      expiresAt: now + ttlSeconds,
    };

    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.sessionSecret)
      .update(encodedPayload)
      .digest('base64url');

    return `${encodedPayload}.${signature}`;
  }

  /**
   * Verify and decode a session token
   */
  verifySessionToken(token: string): SessionPayload | null {
    if (!token || !token.includes('.')) return null;

    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) return null;

    const expectedSignature = crypto
      .createHmac('sha256', this.sessionSecret)
      .update(encodedPayload)
      .digest('base64url');

    if (
      signature.length !== expectedSignature.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
    ) {
      return null;
    }

    try {
      const payload: SessionPayload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
      const now = Math.floor(Date.now() / 1000);
      if (payload.expiresAt < now) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Generate CSRF token cryptographically bound to session
   */
  generateCsrfToken(sessionToken: string): string {
    return crypto
      .createHmac('sha256', this.sessionSecret)
      .update(`csrf:${sessionToken}`)
      .digest('hex');
  }

  /**
   * Verify CSRF token
   */
  verifyCsrfToken(sessionToken: string, csrfToken: string): boolean {
    if (!sessionToken || !csrfToken) return false;
    const expected = this.generateCsrfToken(sessionToken);
    if (csrfToken.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(csrfToken), Buffer.from(expected));
  }
}
