import pg from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export * from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseOptions {
  pool?: pg.Pool;
  connectionString?: string;
}

export function createDatabaseClient(options: DatabaseOptions = {}): { db: Database; pool: pg.Pool; close: () => Promise<void> } {
  let pool: pg.Pool;
  let ownsPool = false;

  if (options.pool) {
    pool = options.pool;
  } else {
    pool = new pg.Pool({
      connectionString: options.connectionString || process.env.DATABASE_URL || 'postgresql://blogger:blogger_secret@localhost:5432/enterprise_blogger',
      max: 20,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    });
    ownsPool = true;
  }

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: async () => {
      if (ownsPool) {
        await pool.end();
      }
    },
  };
}
