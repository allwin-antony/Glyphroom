import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { Database } from '../db/index.js';
import type { PluginManifest } from '@enterprise-blogger/shared';
import type { PluginStorage } from './storage.js';
import type { PluginEventBus } from './events.js';

export interface BackendPluginContext {
  db: Database;
  pluginId: string;
  storage: PluginStorage;
  logger: FastifyBaseLogger;
  apiBasePath: string;
}

export interface GlyphroomBackendPlugin {
  manifest: PluginManifest;
  registerRoutes?: (fastify: FastifyInstance, context: BackendPluginContext) => Promise<void> | void;
  registerEvents?: (bus: PluginEventBus) => void;
  onStartup?: (context: BackendPluginContext) => Promise<void> | void;
  onShutdown?: () => Promise<void> | void;
}
