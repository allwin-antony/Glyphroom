import 'dotenv/config';
import { createCollabServer } from './server.js';
import { PostgresPersistenceAdapter } from './persistence/postgres.js';
import { InMemoryPersistenceAdapter } from './persistence/in-memory.js';

export * from './server.js';
export * from './persistence/index.js';
export * from './auth/index.js';
export * from './gateway/index.js';

export const COLLAB_APP_NAME = 'enterprise-blogger-collab';

/**
 * Main application bootstrap for Collab service.
 */
async function main() {
  const port = parseInt(process.env.PORT || '4000', 10);
  const dbUrl =
    process.env.DATABASE_URL ||
    'postgres://blogger:REPLACE_WITH_STRONG_PASSWORD_IN_PROD@localhost:5432/enterprise_blogger';
  const persistenceType = process.env.PERSISTENCE_ADAPTER || (dbUrl ? 'postgres' : 'in-memory');

  const adapter =
    persistenceType === 'postgres'
      ? new PostgresPersistenceAdapter({ connectionString: dbUrl })
      : new InMemoryPersistenceAdapter();

  const instance = await createCollabServer({
    port,
    adapter,
    redisUrl: process.env.REDIS_URL,
    quiet: false,
  });

  const { url } = await instance.listen();
  console.log(`[Collab] Collaboration service listening on ${url} (HTTP: http://0.0.0.0:${port}/healthz)`);

  const shutdown = async (signal: string) => {
    console.log(`[Collab] ${signal} received. Initiating graceful shutdown...`);
    await instance.destroy();
    console.log('[Collab] Shutdown complete.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Only launch daemon if this file is the execution entrypoint and not running under tests
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  main().catch((err) => {
    console.error('[Collab] Fatal server startup error:', err);
    process.exit(1);
  });
}
