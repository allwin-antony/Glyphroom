import { newDb } from 'pg-mem';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/db/schema.js';
import type { Database } from '../../src/db/index.js';
import crypto from 'node:crypto';

export function createInMemoryDatabase(): { db: Database; pgMem: any; pool: any } {
  const pgMem = newDb();

  pgMem.public.registerFunction({
    name: 'gen_random_uuid',
    returns: pgMem.public.getType('text' as any),
    impure: true,
    implementation: () => crypto.randomUUID(),
  });

  pgMem.public.registerFunction({
    name: 'current_timestamp',
    returns: pgMem.public.getType('text' as any),
    impure: true,
    implementation: () => new Date().toISOString(),
  });

  pgMem.public.none(`
    CREATE TABLE users (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      email text UNIQUE NOT NULL,
      full_name text NOT NULL,
      password_hash text,
      role text NOT NULL,
      sso_provider text,
      sso_subject text,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT NOW(),
      updated_at timestamp NOT NULL DEFAULT NOW()
    );

    CREATE TABLE centers_of_excellence (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      name text UNIQUE NOT NULL,
      code text UNIQUE NOT NULL,
      description text
    );

    CREATE TABLE spaces (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      slug text UNIQUE NOT NULL,
      name text NOT NULL,
      description text,
      is_archived boolean NOT NULL DEFAULT false,
      created_at timestamp NOT NULL DEFAULT NOW(),
      updated_at timestamp NOT NULL DEFAULT NOW()
    );

    CREATE TABLE space_members (
      space_id text NOT NULL,
      user_id text NOT NULL,
      role text NOT NULL,
      created_at timestamp NOT NULL DEFAULT NOW(),
      PRIMARY KEY (space_id, user_id)
    );

    CREATE TABLE space_requests (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      requested_by text NOT NULL,
      name text NOT NULL,
      slug text NOT NULL,
      reason text,
      status text NOT NULL DEFAULT 'pending',
      reviewed_by text,
      created_at timestamp NOT NULL DEFAULT NOW(),
      updated_at timestamp NOT NULL DEFAULT NOW()
    );

    CREATE TABLE posts (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      slug text UNIQUE NOT NULL,
      title text NOT NULL,
      excerpt text,
      status text NOT NULL DEFAULT 'draft',
      author_id text NOT NULL,
      space_id text,
      visibility text NOT NULL DEFAULT 'space',
      is_promoted boolean NOT NULL DEFAULT false,
      promoted_at timestamp,
      promoted_by text,
      coe_id text,
      yjs_state bytea NOT NULL,
      working_markdown text,
      published_version_id text,
      published_markdown text,
      search_vector text,
      working_search_vector text,
      published_at timestamp,
      created_at timestamp NOT NULL DEFAULT NOW(),
      updated_at timestamp NOT NULL DEFAULT NOW()
    );

    CREATE TABLE post_versions (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id text NOT NULL,
      version_number integer NOT NULL,
      trigger_reason text NOT NULL,
      yjs_state_snapshot bytea NOT NULL,
      markdown_snapshot text NOT NULL,
      created_by text NOT NULL,
      created_at timestamp NOT NULL DEFAULT NOW()
    );

    CREATE TABLE post_collaborators (
      post_id text NOT NULL,
      user_id text NOT NULL,
      permission text NOT NULL,
      PRIMARY KEY (post_id, user_id)
    );

    CREATE TABLE post_reviews (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id text NOT NULL,
      reviewer_id text NOT NULL,
      decision text NOT NULL DEFAULT 'pending',
      notes text,
      created_at timestamp NOT NULL DEFAULT NOW(),
      resolved_at timestamp
    );

    CREATE TABLE comments (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id text NOT NULL,
      author_id text NOT NULL,
      parent_id text,
      content text NOT NULL,
      yjs_anchor_start jsonb,
      yjs_anchor_end jsonb,
      is_review_comment boolean NOT NULL DEFAULT false,
      status text NOT NULL DEFAULT 'open',
      created_at timestamp NOT NULL DEFAULT NOW()
    );

    CREATE TABLE tags (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      name text UNIQUE NOT NULL,
      slug text UNIQUE NOT NULL
    );

    CREATE TABLE post_tags (
      post_id text NOT NULL,
      tag_id text NOT NULL,
      PRIMARY KEY (post_id, tag_id)
    );

    CREATE TABLE personal_access_tokens (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      name text NOT NULL,
      token_hash text UNIQUE NOT NULL,
      scopes jsonb NOT NULL,
      last_used_at timestamp,
      expires_at timestamp,
      revoked_at timestamp,
      created_at timestamp NOT NULL DEFAULT NOW()
    );

    CREATE TABLE attachments (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id text,
      storage_key text NOT NULL,
      mime_type text NOT NULL,
      size bigint NOT NULL,
      scan_status text NOT NULL DEFAULT 'clean',
      uploaded_by text,
      created_at timestamp NOT NULL DEFAULT NOW()
    );

    CREATE TABLE audit_logs (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_user_id text,
      actor_type text NOT NULL,
      pat_id text,
      action text NOT NULL,
      entity_type text,
      entity_id text,
      metadata jsonb,
      ip_address text,
      prev_hash text NOT NULL,
      row_hash text NOT NULL,
      created_at timestamp NOT NULL DEFAULT NOW()
    );

    CREATE TABLE post_view_counts (
      post_id text PRIMARY KEY,
      total_views bigint NOT NULL DEFAULT 0,
      last_viewed_at timestamp
    );

    CREATE TABLE post_attachments (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id text NOT NULL,
      file_name text NOT NULL,
      file_size integer NOT NULL,
      mime_type text NOT NULL,
      sha256 text NOT NULL,
      storage_path text NOT NULL,
      scan_status text NOT NULL DEFAULT 'clean',
      uploaded_by text NOT NULL,
      created_at timestamp NOT NULL DEFAULT NOW()
    );
  `);

  const pg = pgMem.adapters.createPg();
  const pool = new pg.Pool();

  function wrapQuery(orig: any) {
    return function (...args: any[]) {
      let isRowModeArray = false;
      const last = args[args.length - 1];
      const callback = typeof last === 'function' ? last : null;

      if (args[0] && typeof args[0] === 'object') {
        delete args[0].types;
        if (args[0].rowMode === 'array') {
          isRowModeArray = true;
          delete args[0].rowMode;
        }
      }

      if (callback) {
        args[args.length - 1] = (err: any, res: any) => {
          if (!err && isRowModeArray && res && Array.isArray(res.rows)) {
            res.rows = res.rows.map((r: any) => Object.values(r));
          }
          callback(err, res);
        };
        return orig(...args);
      }

      const result = orig(...args);
      if (result && typeof result.then === 'function') {
        return result.then((res: any) => {
          if (isRowModeArray && res && Array.isArray(res.rows)) {
            res.rows = res.rows.map((r: any) => Object.values(r));
          }
          return res;
        });
      }
      return result;
    };
  }

  pool.query = wrapQuery(pool.query.bind(pool));
  const origConnect = pool.connect.bind(pool);
  pool.connect = async function () {
    const client = await origConnect();
    client.query = wrapQuery(client.query.bind(client));
    return client;
  };

  const db = drizzle(pool, { schema }) as Database;

  return { db, pgMem, pool };
}
