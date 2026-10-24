-- Enterprise Blogger 2.0 — Relational & Yjs CRDT PostgreSQL Schema
-- Executed automatically on container initialization via /docker-entrypoint-initdb.d/
-- Conforms strictly to docs/DATA_MODEL.md & docs/ARCHITECTURE.md

-- ===========================================================================
-- 1. PostgreSQL Extensions
-- ===========================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ===========================================================================
-- 2. Schema Migration Tracking Table
-- ===========================================================================
CREATE TABLE IF NOT EXISTS _schema_migrations (
    id SERIAL PRIMARY KEY,
    version VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===========================================================================
-- 3. Core Users & RBAC
-- Global Roles: admin, moderator, author, reader (docs/ARCHITECTURE.md D8)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255),
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'moderator', 'author', 'reader')),
    sso_provider VARCHAR(50),
    sso_subject VARCHAR(512),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_users_sso UNIQUE (sso_provider, sso_subject)
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ===========================================================================
-- 4. Centers of Excellence (Taxonomy)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS centers_of_excellence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    description TEXT
);

-- ===========================================================================
-- 5. Posts (Yjs CRDT Canonical Working State & Derived Projections)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(255) UNIQUE NOT NULL,
    title VARCHAR(500) NOT NULL,
    excerpt TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'approved', 'published', 'archived')),
    author_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    coe_id UUID REFERENCES centers_of_excellence(id),
    yjs_state BYTEA NOT NULL,
    working_markdown TEXT,
    published_version_id UUID,
    published_markdown TEXT,
    search_vector TSVECTOR,
    working_search_vector TSVECTOR,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_published_at ON posts(published_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_posts_search_vector ON posts USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_posts_working_search_vector ON posts USING GIN(working_search_vector);
CREATE INDEX IF NOT EXISTS idx_posts_title_trgm ON posts USING GIN(title gin_trgm_ops);

-- ===========================================================================
-- 6. Post Milestone Versions (Discrete Snapshots, Never Per-Keystroke)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS post_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE NOT NULL,
    version_number INTEGER NOT NULL,
    trigger_reason VARCHAR(30) NOT NULL CHECK (trigger_reason IN ('manual_save', 'review_submission', 'publication', 'hourly_checkpoint')),
    yjs_state_snapshot BYTEA NOT NULL,
    markdown_snapshot TEXT NOT NULL,
    created_by UUID REFERENCES users(id) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_post_version UNIQUE (post_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_post_versions_post_id ON post_versions(post_id);

-- Alter posts to bind foreign key for published_version_id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_posts_published_version'
    ) THEN
        ALTER TABLE posts
            ADD CONSTRAINT fk_posts_published_version
            FOREIGN KEY (published_version_id) REFERENCES post_versions(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ===========================================================================
-- 7. Post Collaborators (Per-Post Permissions: edit, review, view)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS post_collaborators (
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(10) NOT NULL CHECK (permission IN ('edit', 'review', 'view')),
    PRIMARY KEY (post_id, user_id)
);

-- ===========================================================================
-- 8. Post Reviews (Workflow Gate: Reviewer != Author Enforced)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS post_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE NOT NULL,
    reviewer_id UUID REFERENCES users(id) ON DELETE RESTRICT NOT NULL,
    decision VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'approved', 'changes_requested')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_post_reviews_post_id ON post_reviews(post_id);

-- ===========================================================================
-- 9. Comments & Yjs Relative Anchors
-- ===========================================================================
CREATE TABLE IF NOT EXISTS comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE NOT NULL,
    author_id UUID REFERENCES users(id) ON DELETE RESTRICT NOT NULL,
    parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    yjs_anchor_start JSONB,
    yjs_anchor_end JSONB,
    is_review_comment BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);

-- ===========================================================================
-- 10. Tags Taxonomy
-- ===========================================================================
CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS post_tags (
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, tag_id)
);

-- ===========================================================================
-- 11. Personal Access Tokens (PATs) for Agents & Developers
-- ===========================================================================
CREATE TABLE IF NOT EXISTS personal_access_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255) NOT NULL,
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    scopes JSONB NOT NULL,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pat_token_hash ON personal_access_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_pat_user_id ON personal_access_tokens(user_id);

-- ===========================================================================
-- 12. Local Attachments Metadata
-- ===========================================================================
CREATE TABLE IF NOT EXISTS attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
    storage_key VARCHAR(1024) NOT NULL,
    mime_type VARCHAR(255) NOT NULL,
    size BIGINT NOT NULL,
    scan_status VARCHAR(20) NOT NULL DEFAULT 'clean' CHECK (scan_status IN ('pending', 'clean', 'quarantined')),
    uploaded_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===========================================================================
-- 13. Audit Logs (Tamper-Evident SHA-256 Chained Hash Log)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES users(id),
    actor_type VARCHAR(10) NOT NULL CHECK (actor_type IN ('human', 'agent', 'system')),
    pat_id UUID REFERENCES personal_access_tokens(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    metadata JSONB,
    ip_address INET,
    prev_hash VARCHAR(64) NOT NULL,
    row_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ===========================================================================
-- 14. Post View Counts (Buffered Counter Table)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS post_view_counts (
    post_id UUID PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
    total_views BIGINT NOT NULL DEFAULT 0,
    last_viewed_at TIMESTAMPTZ
);

-- ===========================================================================
-- 15. Initial Seed: Genesis Audit Hash & Default System Admin
-- ===========================================================================
INSERT INTO _schema_migrations (version, name)
VALUES ('001', 'initial_schema_and_extensions')
ON CONFLICT (version) DO NOTHING;

-- Default System Admin (Preserved for turnkey deployment & integration suites)
INSERT INTO users (id, email, full_name, password_hash, role, is_active)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'admin@blogger.corp.internal',
    'System Administrator',
    '$2a$10$wYNBVWEHmj6BkDKsMjwwEuAfvPY2WS7ausLRXg613Nnls10A3/8Re',
    'admin',
    true
)
ON CONFLICT (email) DO UPDATE
SET password_hash = EXCLUDED.password_hash,
    role = EXCLUDED.role,
    is_active = EXCLUDED.is_active;

-- Break-Glass Local Admin (Mandated by ORIGINAL_REQUEST.md & E2E Acceptance Criteria)
INSERT INTO users (id, email, full_name, password_hash, role, is_active)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    'admin@enterprise-blogger.local',
    'Break-Glass System Administrator',
    '$2a$10$wYNBVWEHmj6BkDKsMjwwEuAfvPY2WS7ausLRXg613Nnls10A3/8Re',
    'admin',
    true
)
ON CONFLICT (email) DO UPDATE
SET password_hash = EXCLUDED.password_hash,
    role = EXCLUDED.role,
    is_active = EXCLUDED.is_active;

INSERT INTO audit_logs (id, actor_type, action, prev_hash, row_hash, metadata)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'system',
    'system_bootstrapped',
    '0000000000000000000000000000000000000000000000000000000000000000',
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    '{"message": "Genesis audit log entry created on database initialization"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;
