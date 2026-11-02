import bcrypt from 'bcryptjs';
import { users } from './schema.js';
import type { Database } from './index.js';

const MIN_PASSWORD_BYTES = 16;
const MAX_BCRYPT_PASSWORD_BYTES = 72;

export interface BootstrapAdminEnvironment {
  BOOTSTRAP_ADMIN_EMAIL?: string;
  BOOTSTRAP_ADMIN_PASSWORD?: string;
}

export interface BootstrapAdminResult {
  created: boolean;
  reason: 'created' | 'existing-users' | 'concurrent-bootstrap';
}

interface BootstrapAdminConfig {
  email: string;
  password: string;
}

function validateEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL must be a valid email address.');
  }
  return email;
}

function validatePassword(password: string, email: string): void {
  const byteLength = Buffer.byteLength(password, 'utf8');
  const canonicalPassword = password.toLowerCase().replace(/[^a-z0-9]/g, '');
  const emailLocalPart = email.split('@')[0]!.toLowerCase().replace(/[^a-z0-9]/g, '');
  const knownWeakPatterns = [
    'password',
    'administrator',
    'admin123',
    'changeme',
    'letmein',
    'enterpriseblogger',
    'glyphroomadmin',
    'replacewithstrongpassword',
  ];

  if (password !== password.trim()) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must not begin or end with whitespace.');
  }
  if (byteLength < MIN_PASSWORD_BYTES || byteLength > MAX_BCRYPT_PASSWORD_BYTES) {
    throw new Error(
      `BOOTSTRAP_ADMIN_PASSWORD must be between ${MIN_PASSWORD_BYTES} and ${MAX_BCRYPT_PASSWORD_BYTES} UTF-8 bytes.`,
    );
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new Error(
      'BOOTSTRAP_ADMIN_PASSWORD must include uppercase, lowercase, numeric, and symbol characters.',
    );
  }
  if (
    knownWeakPatterns.some((pattern) => canonicalPassword.includes(pattern)) ||
    (emailLocalPart.length >= 4 && canonicalPassword.includes(emailLocalPart))
  ) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD is too predictable; use a unique password-manager-generated value.');
  }
}

function readBootstrapConfig(environment: BootstrapAdminEnvironment): BootstrapAdminConfig | null {
  const rawEmail = environment.BOOTSTRAP_ADMIN_EMAIL;
  const rawPassword = environment.BOOTSTRAP_ADMIN_PASSWORD;
  const hasEmail = typeof rawEmail === 'string' && rawEmail.trim().length > 0;
  const hasPassword = typeof rawPassword === 'string' && rawPassword.length > 0;

  if (!hasEmail && !hasPassword) {
    return null;
  }
  if (!hasEmail || !hasPassword) {
    throw new Error(
      'BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must either both be set or both be unset.',
    );
  }

  const email = validateEmail(rawEmail!);
  validatePassword(rawPassword!, email);
  return { email, password: rawPassword! };
}

/**
 * Creates one local administrator only for a completely empty users table.
 * Existing rows are never updated, activated, promoted, or assigned a password.
 */
export async function bootstrapLocalAdmin(
  db: Database,
  environment: BootstrapAdminEnvironment = {
    BOOTSTRAP_ADMIN_EMAIL: process.env.BOOTSTRAP_ADMIN_EMAIL,
    BOOTSTRAP_ADMIN_PASSWORD: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  },
): Promise<BootstrapAdminResult> {
  const config = readBootstrapConfig(environment);

  return db.transaction(
    async (tx) => {
      const [existingUser] = await tx.select({ id: users.id }).from(users).limit(1);
      if (existingUser) {
        return { created: false, reason: 'existing-users' };
      }

      if (!config) {
        throw new Error(
          'The users table is empty. Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD to strong operator-supplied values for the first startup.',
        );
      }

      const passwordHash = await bcrypt.hash(config.password, 12);
      const [createdUser] = await tx
        .insert(users)
        .values({
          email: config.email,
          fullName: 'Local Administrator',
          passwordHash,
          role: 'admin',
          ssoProvider: 'local',
          isActive: true,
        })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id });

      if (createdUser) {
        return { created: true, reason: 'created' };
      }

      // Another startup using the same explicit email may have committed first.
      const [concurrentUser] = await tx.select({ id: users.id }).from(users).limit(1);
      if (concurrentUser) {
        return { created: false, reason: 'concurrent-bootstrap' };
      }

      throw new Error('Local administrator bootstrap did not create an account.');
    },
    { isolationLevel: 'serializable' },
  );
}
