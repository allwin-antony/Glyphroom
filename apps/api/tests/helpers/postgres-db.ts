import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createDatabaseClient } from '../../src/db/index.js';

/** Each suite owns only its random schema in an explicitly selected test database. */
export async function createPostgresTestDatabase() {
  const connectionString = process.env.GLYPHROOM_TEST_DATABASE_URL;
  if (!connectionString) throw new Error('GLYPHROOM_TEST_DATABASE_URL is required for PostgreSQL tests');
  const admin = new pg.Pool({ connectionString });
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  await admin.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public; CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public');
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema},public` });
  const { db } = createDatabaseClient({ pool });
  const close = async () => {
    await pool.end();
    try { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
    finally { await admin.end(); }
  };
  try {
    await pool.query(await readFile(new URL('../../../../docker/postgres/init.sql', import.meta.url), 'utf8'));
    return { db, pool, close };
  } catch (error) {
    await close();
    throw error;
  }
}
