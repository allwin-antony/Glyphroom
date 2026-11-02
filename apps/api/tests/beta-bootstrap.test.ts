import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapLocalAdmin, type BootstrapAdminEnvironment } from '../src/db/bootstrap-admin.js';
import { users } from '../src/db/schema.js';
import { createInMemoryDatabase } from './helpers/test-db.js';

const VALID_BOOTSTRAP: BootstrapAdminEnvironment = {
  BOOTSTRAP_ADMIN_EMAIL: 'initial.operator@example.test',
  BOOTSTRAP_ADMIN_PASSWORD: '7vN!q2Zp#4Lm$8Rx',
};

describe('beta local-admin bootstrap', () => {
  const pools: Array<{ end: () => Promise<void> }> = [];

  function createDatabase() {
    const fixture = createInMemoryDatabase();
    pools.push(fixture.pool);
    return fixture.db;
  }

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(pools.splice(0).map((pool) => pool.end()));
  });

  it('refuses an empty database without explicit credentials', async () => {
    const db = createDatabase();

    await expect(bootstrapLocalAdmin(db, {})).rejects.toThrow(
      /users table is empty.*BOOTSTRAP_ADMIN_EMAIL.*BOOTSTRAP_ADMIN_PASSWORD/i,
    );

    expect(await db.select().from(users)).toEqual([]);
  });

  it('reads default credentials at invocation time instead of module load', async () => {
    vi.stubEnv('BOOTSTRAP_ADMIN_EMAIL', '');
    vi.stubEnv('BOOTSTRAP_ADMIN_PASSWORD', '');
    vi.resetModules();
    const { bootstrapLocalAdmin: bootstrapFromEnvironment } = await import('../src/db/bootstrap-admin.js');
    const db = createDatabase();

    await expect(bootstrapFromEnvironment(db)).rejects.toThrow(/users table is empty/i);
    expect(await db.select().from(users)).toEqual([]);

    vi.stubEnv('BOOTSTRAP_ADMIN_EMAIL', VALID_BOOTSTRAP.BOOTSTRAP_ADMIN_EMAIL!);
    vi.stubEnv('BOOTSTRAP_ADMIN_PASSWORD', VALID_BOOTSTRAP.BOOTSTRAP_ADMIN_PASSWORD!);

    await expect(bootstrapFromEnvironment(db)).resolves.toEqual({ created: true, reason: 'created' });
    const createdUsers = await db.select().from(users);
    expect(createdUsers).toHaveLength(1);
    const [admin] = createdUsers;
    expect(admin).toMatchObject({
      email: VALID_BOOTSTRAP.BOOTSTRAP_ADMIN_EMAIL,
      role: 'admin',
      ssoProvider: 'local',
      isActive: true,
    });
    await expect(bcrypt.compare(VALID_BOOTSTRAP.BOOTSTRAP_ADMIN_PASSWORD!, admin.passwordHash!)).resolves.toBe(true);
  });

  it.each([
    [
      'partial configuration',
      { BOOTSTRAP_ADMIN_EMAIL: 'initial.operator@example.test' },
      /must either both be set or both be unset/i,
    ],
    [
      'known weak password',
      {
        BOOTSTRAP_ADMIN_EMAIL: 'initial.operator@example.test',
        BOOTSTRAP_ADMIN_PASSWORD: 'Password12345678!',
      },
      /too predictable/i,
    ],
    [
      'password without required character classes',
      {
        BOOTSTRAP_ADMIN_EMAIL: 'initial.operator@example.test',
        BOOTSTRAP_ADMIN_PASSWORD: 'alllowercase123456789',
      },
      /uppercase, lowercase, numeric, and symbol/i,
    ],
  ])('rejects %s before creating an account', async (_label, environment, expectedMessage) => {
    const db = createDatabase();

    await expect(bootstrapLocalAdmin(db, environment)).rejects.toThrow(expectedMessage);
    expect(await db.select().from(users)).toEqual([]);
  });

  it('creates one active admin from strong operator-supplied credentials', async () => {
    const db = createDatabase();

    await expect(bootstrapLocalAdmin(db, VALID_BOOTSTRAP)).resolves.toEqual({
      created: true,
      reason: 'created',
    });

    const [admin] = await db.select().from(users);
    expect(admin).toMatchObject({
      email: 'initial.operator@example.test',
      fullName: 'Local Administrator',
      role: 'admin',
      ssoProvider: 'local',
      isActive: true,
    });
    expect(admin.passwordHash).not.toBe(VALID_BOOTSTRAP.BOOTSTRAP_ADMIN_PASSWORD);
    await expect(bcrypt.compare(VALID_BOOTSTRAP.BOOTSTRAP_ADMIN_PASSWORD!, admin.passwordHash!)).resolves.toBe(true);
  });

  it('is idempotent and never rewrites the created account', async () => {
    const db = createDatabase();
    await bootstrapLocalAdmin(db, VALID_BOOTSTRAP);
    const [before] = await db.select().from(users);

    await expect(bootstrapLocalAdmin(db, VALID_BOOTSTRAP)).resolves.toEqual({
      created: false,
      reason: 'existing-users',
    });

    const [after] = await db.select().from(users);
    expect(after).toEqual(before);
  });

  it('does not reset, activate, or elevate an existing account', async () => {
    const db = createDatabase();
    const originalHash = await bcrypt.hash('Existing-Reader!47', 4);
    await db.insert(users).values({
      email: VALID_BOOTSTRAP.BOOTSTRAP_ADMIN_EMAIL!,
      fullName: 'Existing Reader',
      passwordHash: originalHash,
      role: 'reader',
      ssoProvider: 'local',
      isActive: false,
    });

    await expect(bootstrapLocalAdmin(db, VALID_BOOTSTRAP)).resolves.toEqual({
      created: false,
      reason: 'existing-users',
    });
    await expect(bootstrapLocalAdmin(db, {})).resolves.toEqual({
      created: false,
      reason: 'existing-users',
    });

    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.email, VALID_BOOTSTRAP.BOOTSTRAP_ADMIN_EMAIL!));
    expect(existing).toMatchObject({
      fullName: 'Existing Reader',
      passwordHash: originalHash,
      role: 'reader',
      isActive: false,
    });
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('does not add a privileged account to a non-empty database', async () => {
    const db = createDatabase();
    await db.insert(users).values({
      email: 'existing.reader@example.test',
      fullName: 'Existing Reader',
      role: 'reader',
      isActive: true,
    });

    await expect(bootstrapLocalAdmin(db, VALID_BOOTSTRAP)).resolves.toMatchObject({ created: false });
    expect(await db.select().from(users)).toHaveLength(1);
  });
});
