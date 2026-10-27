import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { createDatabaseClient, type Database } from './db/index.js';
import { ensureDatabaseSchema } from './db/auto-migrate.js';
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
import { attachmentRoutes } from './routes/attachments.js';
import { spaceRoutes } from './routes/spaces.js';
import { notificationRoutes } from './routes/notifications.js';
import { NotificationService } from './services/notifications.js';
import { adminRoutes } from './routes/admin.js';
import { bookmarkRoutes } from './routes/bookmarks.js';
import { BackendPluginRegistry, defaultBackendRegistry, OutboxService } from './plugins/index.js';

export interface ApiAppOptions {
  db?: Database;
  connectionString?: string;
  sessionSecret?: string;
  logger?: boolean | Record<string, unknown>;
  pluginRegistry?: BackendPluginRegistry;
  outboxService?: OutboxService;
}

export async function createApiApp(options: ApiAppOptions = {}): Promise<{
  app: FastifyInstance;
  db: Database;
  viewCounter: BufferedViewCounter;
  outboxService: OutboxService;
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
    // Auto-run schema migration check on startup
    await ensureDatabaseSchema(db);
  }

  const app = Fastify({
    logger: options.logger ?? false,
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(multipart, {
    limits: {
      fileSize: 25 * 1024 * 1024,
    },
  });

  const authService = new AuthService(db, options.sessionSecret);
  const auditService = new AuditService(db);
  const permissionService = new PermissionService(db);
  const viewCounter = new BufferedViewCounter(db);
  const notificationService = new NotificationService(db);
  viewCounter.start();

  const pluginRegistry = options.pluginRegistry ?? defaultBackendRegistry;
  const outboxService = options.outboxService ?? new OutboxService(db, pluginRegistry.getEventBus());
  outboxService.start();

  await app.register(authPlugin, { authService, db });

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
    notificationService,
    outboxService,
  });

  await app.register(collaboratorRoutes, {
    prefix: '/api/v1/posts',
    db,
    permissionService,
    auditService,
    notificationService,
  });

  await app.register(collaboratorRoutes, {
    prefix: '/api/v1',
    db,
    permissionService,
    auditService,
    notificationService,
  });

  await app.register(reviewRoutes, {
    prefix: '/api/v1/posts',
    db,
    permissionService,
    auditService,
    notificationService,
    outboxService,
  });

  await app.register(commentRoutes, {
    prefix: '/api/v1/posts',
    db,
    permissionService,
    auditService,
    outboxService,
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

  await app.register(auditRoutes, {
    prefix: '/api/v1/audit',
    db,
    auditService,
  });

  await app.register(attachmentRoutes, {
    prefix: '/api/v1/posts',
    db,
    permissionService,
    auditService,
  });

  await app.register(attachmentRoutes, {
    prefix: '/api/v1',
    db,
    permissionService,
    auditService,
  });

  await app.register(spaceRoutes, {
    prefix: '/api/v1/spaces',
    db,
    permissionService,
    auditService,
    notificationService,
    outboxService,
  });

  await app.register(adminRoutes, {
    prefix: '/api/v1/admin',
    db,
    auditService,
    pluginRegistry,
    outboxService,
  });

  await app.register(notificationRoutes, { prefix: '/api/v1/notifications', db });

  await app.register(bookmarkRoutes, {
    prefix: '/api/v1/bookmarks',
    db,
    permissionService,
  });

  await pluginRegistry.boot(app, db);

  const close = async () => {
    await outboxService.stop();
    await pluginRegistry.shutdown();
    await viewCounter.stop();
    await app.close();
    await closeDb();
  };

  return { app, db, viewCounter, outboxService, close };
}
