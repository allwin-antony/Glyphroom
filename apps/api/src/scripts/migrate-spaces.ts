import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://blogger:REPLACE_WITH_STRONG_PASSWORD_IN_PROD@localhost:5432/enterprise_blogger',
});

async function migrate() {
  console.log('Running Spaces & Access Model migration...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS spaces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      is_archived BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS space_members (
      space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (space_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS space_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NOT NULL,
      reason TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      reviewed_by UUID REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE posts ADD COLUMN IF NOT EXISTS space_id UUID REFERENCES spaces(id) ON DELETE SET NULL;
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'space';
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_promoted BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ;
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS promoted_by UUID REFERENCES users(id);

    -- Seed default "General Engineering" Space if no space exists
    INSERT INTO spaces (id, slug, name, description)
    VALUES ('00000000-0000-0000-0000-000000000101', 'general-engineering', 'General Engineering', 'Default shared engineering workspace for core project documentation.')
    ON CONFLICT (slug) DO NOTHING;

    -- Attach existing posts to General Engineering and mark published as promoted
    UPDATE posts
    SET space_id = '00000000-0000-0000-0000-000000000101',
        is_promoted = (status = 'published')
    WHERE space_id IS NULL;
  `);

  console.log('Migration completed successfully!');
}

migrate()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => pool.end());
