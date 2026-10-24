import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { createDatabaseClient, type Database } from './db/index.js';
import { AuthService } from './services/auth.js';
import { AuditService } from './services/audit.js';
import { PermissionService } from './services/permissions.js';
import { BufferedViewCounter } from './services/view-counter.js';
import { authPlugin } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { postRoutes } from './routes/posts.js';
import { collaboratorRoutes } from './routes/collaborators.js';
import { reviewRoutes } from './routes/reviews.js';
import { commentRoutes } from './routes/comments.js';
import { patRoutes } from './routes/pats.js';
import { auditRoutes } from './routes/audit.js';

export interface ApiAppOptions {
  db?: Database;
  connectionString?: string;
  sessionSecret?: string;
  logger?: boolean | Record<string, unknown>;
}

export async function createApiApp(options: ApiAppOptions = {}): Promise<{
  app: FastifyInstance;
  db: Database;
  viewCounter: BufferedViewCounter;
  close: () => Promise<void>;
}> {
  let db: Database;
  let closeDb: () => Promise<void>;

  if (options.db) {
    db = options.db;
    closeDb = async () => {};
  } else {
    const client = createDatabaseClient({ connectionString: options.connectionString });
    db = client.db;
    closeDb = client.close;
  }

  const app = Fastify({
    logger: options.logger ?? false,
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  const authService = new AuthService(db, options.sessionSecret);
  const auditService = new AuditService(db);
  const permissionService = new PermissionService(db);
  const viewCounter = new BufferedViewCounter(db);
  viewCounter.start();

  await app.register(authPlugin, { authService });

  // Health check endpoint
  app.get('/health', async () => ({ status: 'ok', service: 'enterprise-blogger-api' }));

  // Register API v1 modules
  await app.register(authRoutes, {
    prefix: '/api/v1/auth',
    db,
    authService,
    auditService,
  });

  await app.register(postRoutes, {
    prefix: '/api/v1/posts',
    db,
    permissionService,
    auditService,
    viewCounter,
  });

  await app.register(collaboratorRoutes, {
    prefix: '/api/v1/posts',
    db,
    permissionService,
    auditService,
  });

  await app.register(reviewRoutes, {
    prefix: '/api/v1/posts',
    db,
    permissionService,
    auditService,
  });

  await app.register(commentRoutes, {
    prefix: '/api/v1/posts',
    db,
    permissionService,
    auditService,
  });

  await app.register(patRoutes, {
    prefix: '/api/v1/pats',
    db,
    auditService,
  });

  await app.register(auditRoutes, {
    prefix: '/api/v1/audit-logs',
    db,
    auditService,
  });

  const close = async () => {
    await viewCounter.stop();
    await app.close();
    await closeDb();
  };

  return { app, db, viewCounter, close };
}
