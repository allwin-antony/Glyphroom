# Enterprise Blogger 2.0 — Data Model

> **Rev 3** | See [README.md](README.md) for the full document index.

---

## Design Principles

1. **Yjs ProseMirror document tree is the canonical state** of every post. `working_markdown` and `published_markdown` are derived exports — never inputs.
2. **No hot-write columns on `posts`**: view counts live in a separate table; suggestion mark state lives in the Yjs document.
3. **Audit immutability**: the application role has `INSERT` only on `audit_logs`. Each row hash-chains to the previous row.
4. **Comment anchors survive concurrent edits**: stored as Yjs relative positions, resolved against the working state at read time.
5. **Milestone-only versioning**: `post_versions` rows are written on discrete events, never per-keystroke.
6. **Export rules are enforced at query time**: pending agent insertions are excluded from all published/indexed content.

---

## Entity-Relationship Overview

```
users ──────┬── posts (author_id)
            ├── post_collaborators (user_id)
            ├── post_reviews (reviewer_id) [CHECK: reviewer_id != author_id]
            ├── comments (author_id)
            ├── personal_access_tokens (user_id)
            └── audit_logs (actor_user_id)

posts ──────┬── post_collaborators (post_id)
            ├── post_versions (post_id) ◄── posts.published_version_id
            ├── post_reviews (post_id)
            ├── comments (post_id)
            ├── post_tags (post_id)
            ├── post_view_counts (post_id, 1:1)
            ├── attachments (post_id)
            └── centers_of_excellence (coe_id)

tags ───────── post_tags (tag_id)
personal_access_tokens ── audit_logs (pat_id)
```

---

## Table Definitions

### `users`
| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `email` | `varchar(255)` | UNIQUE, NOT NULL | Normalized to lowercase |
| `full_name` | `varchar(255)` | NOT NULL | |
| `password_hash` | `varchar(255)` | NULLABLE | Null for SSO-only accounts |
| `role` | `varchar(20)` | NOT NULL, CHECK IN (`admin`, `moderator`, `author`, `reader`) | |
| `sso_provider` | `varchar(50)` | NULLABLE | `local`, `oidc`, `saml`, `ldap` |
| `sso_subject` | `varchar(512)` | NULLABLE, UNIQUE with `sso_provider` | Issuer-scoped subject claim |
| `is_active` | `boolean` | NOT NULL, DEFAULT true | Deactivated users lose all access immediately via live revocation |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT NOW() | |
| `updated_at` | `timestamptz` | NOT NULL, DEFAULT NOW() | Updated by trigger |

---

### `centers_of_excellence`
| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `name` | `varchar(255)` | UNIQUE, NOT NULL |
| `code` | `varchar(50)` | UNIQUE, NOT NULL |
| `description` | `text` | NULLABLE |

---

### `posts`
| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `slug` | `varchar(255)` | UNIQUE, NOT NULL | URL-safe identifier |
| `title` | `varchar(500)` | NOT NULL | |
| `excerpt` | `text` | NULLABLE | Hand-written or auto-derived |
| `status` | `varchar(20)` | NOT NULL, CHECK IN (`draft`, `in_review`, `approved`, `published`, `archived`), DEFAULT `draft` | |
| `author_id` | `uuid` | FK → `users.id`, NOT NULL, ON DELETE RESTRICT | |
| `coe_id` | `uuid` | FK → `centers_of_excellence.id`, NULLABLE | |
| `yjs_state` | `bytea` | NOT NULL | Canonical CRDT state; `Y.encodeStateAsUpdate(doc)` |
| `working_markdown` | `text` | NULLABLE | Derived from `yjs_state`; refreshed on each debounced flush; never used as input |
| `published_version_id` | `uuid` | FK → `post_versions.id`, NULLABLE | Null until first publication |
| `published_markdown` | `text` | NULLABLE | Derived export of the published snapshot; stable until republished |
| `search_vector` | `tsvector` | NULLABLE | Built from `published_markdown`; GIN indexed; public search |
| `working_search_vector` | `tsvector` | NULLABLE | Built from `working_markdown`; GIN indexed; draft search |
| `published_at` | `timestamptz` | NULLABLE | |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT NOW() | |
| `updated_at` | `timestamptz` | NOT NULL, DEFAULT NOW() | |

**Indexes**:
```sql
CREATE INDEX idx_posts_search_vector         ON posts USING GIN(search_vector);
CREATE INDEX idx_posts_working_search_vector ON posts USING GIN(working_search_vector);
CREATE INDEX idx_posts_author                ON posts(author_id);
CREATE INDEX idx_posts_status               ON posts(status);
CREATE INDEX idx_posts_published_at         ON posts(published_at DESC) WHERE status = 'published';
CREATE INDEX idx_posts_title_trgm           ON posts USING GIN(title gin_trgm_ops);
```

---

### `post_view_counts`
Separated from `posts` to eliminate hot-write lock contention.

| Column | Type | Constraints |
|---|---|---|
| `post_id` | `uuid` | PK, FK → `posts.id`, ON DELETE CASCADE |
| `total_views` | `bigint` | NOT NULL, DEFAULT 0 |
| `last_viewed_at` | `timestamptz` | NULLABLE |

Written by a **buffered counter** that accumulates increments in Redis (or in-memory) and flushes every 30 seconds to avoid per-request row locks.

---

### `post_collaborators`
| Column | Type | Constraints |
|---|---|---|
| `post_id` | `uuid` | PK (composite), FK → `posts.id`, ON DELETE CASCADE |
| `user_id` | `uuid` | PK (composite), FK → `users.id`, ON DELETE CASCADE |
| `permission` | `varchar(10)` | NOT NULL, CHECK IN (`edit`, `review`, `view`) |

The post author always has implicit `edit` permission; this table stores explicitly granted collaborators.

---

### `post_versions`
| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `post_id` | `uuid` | FK → `posts.id`, ON DELETE CASCADE, NOT NULL | |
| `version_number` | `integer` | NOT NULL | Monotonically increasing per post |
| `trigger_reason` | `varchar(30)` | NOT NULL, CHECK IN (`manual_save`, `review_submission`, `publication`, `hourly_checkpoint`) | Never written per-keystroke |
| `yjs_state_snapshot` | `bytea` | NOT NULL | Point-in-time Yjs state |
| `markdown_snapshot` | `text` | NOT NULL | Derived Markdown with pending agent insertions excluded |
| `created_by` | `uuid` | FK → `users.id`, NOT NULL | |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT NOW() | |

---

### `post_reviews`
| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `post_id` | `uuid` | FK → `posts.id`, ON DELETE CASCADE, NOT NULL | |
| `reviewer_id` | `uuid` | FK → `users.id`, ON DELETE RESTRICT, NOT NULL | |
| `decision` | `varchar(20)` | NOT NULL, CHECK IN (`pending`, `approved`, `changes_requested`), DEFAULT `pending` | |
| `notes` | `text` | NULLABLE | |
| `created_at` | `timestamptz` | NOT NULL | |
| `resolved_at` | `timestamptz` | NULLABLE | |

```sql
-- Enforced at DB level: reviewer must not be the author
ALTER TABLE post_reviews
  ADD CONSTRAINT chk_reviewer_not_author
  CHECK (reviewer_id != (SELECT author_id FROM posts WHERE id = post_id));
```

---

### `comments`
| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `post_id` | `uuid` | FK → `posts.id`, ON DELETE CASCADE, NOT NULL | |
| `author_id` | `uuid` | FK → `users.id`, ON DELETE RESTRICT, NOT NULL | |
| `parent_id` | `uuid` | FK → `comments.id`, NULLABLE | Null = top-level; set = reply (1-level nesting enforced in application) |
| `content` | `text` | NOT NULL | Markdown; sanitized on render |
| `yjs_anchor_start` | `jsonb` | NULLABLE | Yjs `RelativePosition` JSON for inline comment anchoring |
| `yjs_anchor_end` | `jsonb` | NULLABLE | Yjs `RelativePosition` JSON for inline comment anchoring |
| `is_review_comment` | `boolean` | NOT NULL, DEFAULT false | |
| `status` | `varchar(10)` | NOT NULL, CHECK IN (`open`, `resolved`), DEFAULT `open` | |
| `created_at` | `timestamptz` | NOT NULL | |

**Comment anchoring**: Relative positions are stored as `Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(...))` serialized to JSON. They are resolved against the current `yjs_state` at read time. Anchors are not copied to published snapshots.

---

### `tags` and `post_tags`
```sql
CREATE TABLE tags (
    id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name  varchar(100) NOT NULL UNIQUE,
    slug  varchar(100) NOT NULL UNIQUE
);

CREATE TABLE post_tags (
    post_id  uuid REFERENCES posts(id)  ON DELETE CASCADE,
    tag_id   uuid REFERENCES tags(id)   ON DELETE CASCADE,
    PRIMARY KEY (post_id, tag_id)
);
```

---

### `personal_access_tokens`
| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `user_id` | `uuid` | FK → `users.id`, ON DELETE CASCADE, NOT NULL | |
| `name` | `varchar(255)` | NOT NULL | Human-readable label, e.g. "Claude Desktop — Engineering Blog" |
| `token_hash` | `varchar(255)` | UNIQUE, NOT NULL | bcrypt or SHA-256 of the token secret; raw secret shown once on creation |
| `scopes` | `jsonb` | NOT NULL | Array of granted scope strings |
| `last_used_at` | `timestamptz` | NULLABLE | |
| `expires_at` | `timestamptz` | NULLABLE | Checked on WebSocket heartbeat |
| `revoked_at` | `timestamptz` | NULLABLE | Soft-revocation; triggers live WebSocket disconnect |
| `created_at` | `timestamptz` | NOT NULL | |

---

### `attachments`
| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `post_id` | `uuid` | FK → `posts.id`, ON DELETE CASCADE |
| `storage_key` | `varchar(1024)` | NOT NULL — path in local volume or object storage |
| `mime_type` | `varchar(255)` | NOT NULL — server-verified from file signature |
| `size` | `bigint` | NOT NULL (bytes) |
| `scan_status` | `varchar(20)` | NOT NULL, CHECK IN (`pending`, `clean`, `quarantined`), DEFAULT `pending` |
| `uploaded_by` | `uuid` | FK → `users.id` |
| `created_at` | `timestamptz` | NOT NULL |

---

### `notifications`
| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | FK → `users.id`, ON DELETE CASCADE |
| `type` | `varchar(50)` | NOT NULL — `review_request`, `mention`, `suggestion_activity`, `publish_event`, etc. |
| `payload` | `jsonb` | NOT NULL — type-specific structured data |
| `read_at` | `timestamptz` | NULLABLE |
| `created_at` | `timestamptz` | NOT NULL |

---

### `audit_logs`
| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `actor_user_id` | `uuid` | FK → `users.id`, NULLABLE | Null for system actions |
| `actor_type` | `varchar(10)` | NOT NULL, CHECK IN (`human`, `agent`, `system`) | |
| `pat_id` | `uuid` | FK → `personal_access_tokens.id`, NULLABLE | Set for agent actions |
| `action` | `varchar(100)` | NOT NULL | e.g. `create_post`, `mcp_suggest_edit`, `approve_post`, `revoke_pat` |
| `entity_type` | `varchar(50)` | NULLABLE | e.g. `post`, `user`, `comment` |
| `entity_id` | `uuid` | NULLABLE | |
| `metadata` | `jsonb` | NULLABLE | Action-specific detail (diff summary, IP, user-agent, etc.) |
| `ip_address` | `inet` | NULLABLE | |
| `prev_hash` | `varchar(64)` | NOT NULL | SHA-256 of the previous row's `row_hash` |
| `row_hash` | `varchar(64)` | NOT NULL | SHA-256(`id || actor_user_id || action || entity_id || metadata || prev_hash`) |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT NOW() | |

```sql
-- The application role can ONLY insert into audit_logs
REVOKE UPDATE, DELETE ON audit_logs FROM blogger_app;
GRANT INSERT, SELECT ON audit_logs TO blogger_app;
```

---

## Search Visibility SQL

```sql
-- Full visibility rules enforced on every search query
WHERE (
    -- Public: only published posts, built from the published snapshot
    (p.status = 'published' AND p.search_vector @@ query)

    -- Draft / working: editors, collaborators, moderators, admins
    OR (
        p.working_search_vector @@ query
        AND (
            p.author_id = :current_user_id
            OR EXISTS (
                SELECT 1 FROM post_collaborators c
                WHERE c.post_id = p.id
                  AND c.user_id = :current_user_id
            )
            OR :current_user_role IN ('admin', 'moderator')
        )
    )
)
```

Both `search_vector` and `working_search_vector` are built after applying the export rules: pending agent `suggestion-insert` marks are stripped; pending `suggestion-delete` marks retain the original text. Unreviewed AI text is never indexed.

---

## Retention and Housekeeping

- **`post_versions`**: Configurable retention; default 1 year. Hourly checkpoint versions beyond 7 days may be pruned while preserving milestone versions (review submission, publication).
- **`audit_logs`**: Never deleted from the database. Exported to external write-once storage monthly for the compliance archive.
- **Yjs state size monitoring**: A periodic job alerts when `length(yjs_state) > threshold` (configurable, default 5 MB) for a single post, prompting an investigation or state reset with a frozen snapshot.
- **Stale suggestions**: Agent suggestion marks older than 30 days are flagged in the editor UI. They are not auto-rejected — that is always a human decision.
