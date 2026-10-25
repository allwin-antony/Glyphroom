import bcrypt from 'bcryptjs';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://blogger:REPLACE_WITH_STRONG_PASSWORD_IN_PROD@localhost:5432/enterprise_blogger',
});

async function seedTestUsers() {
  console.log('Seeding testing accounts across all roles & spaces...');

  const passwordHash = await bcrypt.hash('admin2026!', 10);

  // 1. Users to seed
  const testUsers = [
    {
      email: 'admin@enterprise-blogger.local',
      fullName: 'Break-Glass System Administrator',
      role: 'admin',
    },
    {
      email: 'arjun.maintainer@enterprise.internal',
      fullName: 'Arjun Maintainer',
      role: 'author',
    },
    {
      email: 'priya.sharma@enterprise.internal',
      fullName: 'Priya Sharma (Author)',
      role: 'author',
    },
    {
      email: 'marcus.chen@enterprise.internal',
      fullName: 'Marcus Chen (Moderator)',
      role: 'moderator',
    },
    {
      email: 'rahul.viewer@enterprise.internal',
      fullName: 'Rahul Verma (Viewer)',
      role: 'reader',
    },
    {
      email: 'elena.rostova@enterprise.internal',
      fullName: 'Elena Rostova (Staff SRE)',
      role: 'author',
    },
  ];

  const userIds: Record<string, string> = {};

  for (const u of testUsers) {
    const res = await pool.query(
      `INSERT INTO users (email, full_name, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           full_name = EXCLUDED.full_name,
           role = EXCLUDED.role,
           is_active = true
       RETURNING id, email`,
      [u.email, u.fullName, passwordHash, u.role]
    );
    userIds[u.email] = res.rows[0].id;
    console.log(`  ✓ User ready: ${u.fullName} <${u.email}> (${u.role})`);
  }

  // 2. Ensure "Payments Revamp" and "Platform Security" Spaces exist
  const space1 = await pool.query(
    `INSERT INTO spaces (slug, name, description)
     VALUES ('payments-revamp', 'Payments Revamp', 'Core banking payment infrastructure, settlement service refactor, and gateway integrations.')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
     RETURNING id, name`
  );
  const paymentsSpaceId = space1.rows[0].id;
  console.log(`  ✓ Space ready: Payments Revamp (${paymentsSpaceId})`);

  const space2 = await pool.query(
    `INSERT INTO spaces (slug, name, description)
     VALUES ('platform-security', 'Platform Security', 'Zero-trust architecture, mutual TLS, and threat models.')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
     RETURNING id, name`
  );
  const securitySpaceId = space2.rows[0].id;
  console.log(`  ✓ Space ready: Platform Security (${securitySpaceId})`);

  // 3. Assign Members to "Payments Revamp" space
  // Arjun -> Owner/Maintainer
  await pool.query(
    `INSERT INTO space_members (space_id, user_id, role)
     VALUES ($1, $2, 'owner')
     ON CONFLICT (space_id, user_id) DO UPDATE SET role = 'owner'`,
    [paymentsSpaceId, userIds['arjun.maintainer@enterprise.internal']]
  );

  // Priya -> Author
  await pool.query(
    `INSERT INTO space_members (space_id, user_id, role)
     VALUES ($1, $2, 'author')
     ON CONFLICT (space_id, user_id) DO UPDATE SET role = 'author'`,
    [paymentsSpaceId, userIds['priya.sharma@enterprise.internal']]
  );

  // Rahul -> Viewer
  await pool.query(
    `INSERT INTO space_members (space_id, user_id, role)
     VALUES ($1, $2, 'viewer')
     ON CONFLICT (space_id, user_id) DO UPDATE SET role = 'viewer'`,
    [paymentsSpaceId, userIds['rahul.viewer@enterprise.internal']]
  );

  // Marcus -> Maintainer in Platform Security
  await pool.query(
    `INSERT INTO space_members (space_id, user_id, role)
     VALUES ($1, $2, 'maintainer')
     ON CONFLICT (space_id, user_id) DO UPDATE SET role = 'maintainer'`,
    [securitySpaceId, userIds['marcus.chen@enterprise.internal']]
  );

  console.log('✓ Space memberships assigned successfully!');
  console.log('Ready to test!');
}

seedTestUsers()
  .catch((err) => {
    console.error('Failed to seed test users:', err);
    process.exit(1);
  })
  .finally(() => pool.end());
