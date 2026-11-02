import type { Database } from './index.js';
import { sql } from 'drizzle-orm';

/**
 * Auto-migration runner executed on application startup.
 * Ensures that tables and new schema columns exist automatically
 * without requiring the developer or deployment operator to run manual scripts.
 */
export async function ensureDatabaseSchema(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
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
      CREATE INDEX IF NOT EXISTS idx_space_members_user ON space_members(user_id);

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
      CREATE INDEX IF NOT EXISTS idx_space_requests_status ON space_requests(status);

      ALTER TABLE posts ADD COLUMN IF NOT EXISTS space_id UUID REFERENCES spaces(id) ON DELETE SET NULL;
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'space';
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_promoted BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ;
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS promoted_by UUID REFERENCES users(id);
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS submitted_version_id UUID REFERENCES post_versions(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_posts_space_id ON posts(space_id);
      CREATE INDEX IF NOT EXISTS idx_posts_promoted ON posts(is_promoted);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_post_versions_post_version ON post_versions(post_id, version_number);
      ALTER TABLE post_reviews ADD COLUMN IF NOT EXISTS submitted_version_id UUID REFERENCES post_versions(id) ON DELETE RESTRICT;
      CREATE INDEX IF NOT EXISTS idx_post_reviews_submitted_version_id ON post_reviews(submitted_version_id);

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

      CREATE TABLE IF NOT EXISTS post_attachments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        file_name VARCHAR(255) NOT NULL,
        file_size INTEGER NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        sha256 VARCHAR(64) NOT NULL,
        storage_path TEXT NOT NULL,
        scan_status VARCHAR(20) NOT NULL DEFAULT 'clean'
          CHECK (scan_status IN ('scanning', 'clean', 'blocked')),
        uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_post_attachments_post_id ON post_attachments(post_id);
      CREATE INDEX IF NOT EXISTS idx_post_attachments_sha256 ON post_attachments(sha256);

      CREATE TABLE IF NOT EXISTS plugin_storage (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plugin_id VARCHAR(50) NOT NULL,
        scope VARCHAR(50) NOT NULL DEFAULT 'global',
        key VARCHAR(200) NOT NULL,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_plugin_storage_unique ON plugin_storage(plugin_id, scope, key);
      CREATE INDEX IF NOT EXISTS idx_plugin_storage_lookup ON plugin_storage(plugin_id, scope);
      CREATE TABLE IF NOT EXISTS plugin_event_outbox (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_plugin_event_outbox_poll ON plugin_event_outbox(status, available_at);

      -- Ensure default "General Engineering" Space exists
      INSERT INTO spaces (id, slug, name, description)
      VALUES ('00000000-0000-0000-0000-000000000101', 'general-engineering', 'General Engineering', 'Default shared engineering workspace for core project documentation.')
      ON CONFLICT (slug) DO NOTHING;
    `);
  });
}
