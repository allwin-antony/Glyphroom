import type { Database } from './index.js';
import { sql } from 'drizzle-orm';

/**
 * Auto-migration runner executed on application startup.
 * Ensures that tables and new schema columns exist automatically
 * without requiring the developer or deployment operator to run manual scripts.
 */
export async function ensureDatabaseSchema(db: Database): Promise<void> {
  try {
    await db.execute(sql`
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
      ALTER TABLE post_reviews ADD COLUMN IF NOT EXISTS submitted_version_id UUID REFERENCES post_versions(id) ON DELETE RESTRICT;

      CREATE TABLE IF NOT EXISTS bookmarks (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        note TEXT,
        bookmarked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, post_id)
      );
      CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id ON bookmarks(user_id);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_post_id ON bookmarks(post_id);

      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        entity_type VARCHAR(50),
        entity_id UUID,
        href VARCHAR(500),
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read_at);

      -- Ensure default "General Engineering" Space exists
      INSERT INTO spaces (id, slug, name, description)
      VALUES ('00000000-0000-0000-0000-000000000101', 'general-engineering', 'General Engineering', 'Default shared engineering workspace for core project documentation.')
      ON CONFLICT (slug) DO NOTHING;

      -- Bind any unassigned posts to General Engineering
      UPDATE posts
      SET space_id = '00000000-0000-0000-0000-000000000101',
          is_promoted = (status = 'published')
      WHERE space_id IS NULL;
    `);
  } catch (err: any) {
    // If running in in-memory test databases without raw postgres extensions, silently skip
    if (!err?.message?.includes('does not exist')) {
      console.warn('Schema auto-migration check notice:', err?.message || err);
    }
  }
}
