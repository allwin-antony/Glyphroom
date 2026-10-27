import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/index.js';
import {
  PluginManifestSchema,
  type PluginManifest,
  isValidPluginId,
} from '@enterprise-blogger/shared';
import type { GlyphroomBackendPlugin, BackendPluginContext } from './types.js';
import { PluginStorage } from './storage.js';
import { PluginEventBus } from './events.js';

export const FORBIDDEN_ROUTE_PREFIXES = [
  '/auth',
  '/posts',
  '/spaces',
  '/admin',
  '/internal',
  '/health',
  '/pats',
  '/bookmarks',
  '/notifications',
  '/audit',
  '/audit-logs',
];

export class BackendPluginRegistry {
  private plugins = new Map<string, GlyphroomBackendPlugin>();
  private bus = new PluginEventBus();
  private booted = false;

  getEventBus(): PluginEventBus {
    return this.bus;
  }

  /**
   * Registers a backend plugin definition with validation.
   */
  register(plugin: GlyphroomBackendPlugin): void {
    if (this.booted) {
      throw new Error('Cannot register plugins after the registry has booted');
    }

    // 1. Validate manifest
    const manifest = PluginManifestSchema.parse(plugin.manifest);

    // 2. Reject duplicate IDs
    if (this.plugins.has(manifest.id)) {
      throw new Error(`Duplicate plugin ID registered: "${manifest.id}"`);
    }

    // 3. Verify declared capabilities match implementation
    if (manifest.capabilities.includes('api:routes') && !plugin.registerRoutes) {
      throw new Error(
        `Plugin "${manifest.id}" declared 'api:routes' capability but did not provide registerRoutes()`
      );
    }
    if (manifest.capabilities.includes('api:events') && !plugin.registerEvents) {
      throw new Error(
        `Plugin "${manifest.id}" declared 'api:events' capability but did not provide registerEvents()`
      );
    }

    this.plugins.set(manifest.id, plugin);
  }

  /**
   * Returns list of all registered plugin manifests.
   */
  getPlugins(): GlyphroomBackendPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Boots all registered plugins, mounting their namespaced routes under /api/v1/plugins/:pluginId.
   */
  async boot(fastify: FastifyInstance, db: Database): Promise<void> {
    this.booted = true;

    for (const [pluginId, plugin] of this.plugins.entries()) {
      const storage = new PluginStorage(db, pluginId);
      const apiBasePath = `/api/v1/plugins/${pluginId}`;

      const context: BackendPluginContext = {
        db,
        pluginId,
        storage,
        logger: fastify.log.child({ pluginId }),
        apiBasePath,
      };

      // Lifecycle: registerEvents
      if (plugin.registerEvents) {
        plugin.registerEvents(this.bus);
        fastify.log.info({ pluginId }, `Plugin "${pluginId}" registered event listeners`);
      }

      // Lifecycle: onStartup
      if (plugin.onStartup) {
        try {
          await plugin.onStartup(context);
          fastify.log.info({ pluginId }, `Plugin "${pluginId}" initialized successfully`);
        } catch (err: any) {
          fastify.log.error(
            { pluginId, err: err?.message || err },
            `Plugin "${pluginId}" failed during onStartup`
          );
          throw err;
        }
      }

      // Lifecycle: registerRoutes
      if (plugin.registerRoutes) {
        await fastify.register(
          async (pluginScope) => {
            // Guard against unauthorized route prefix interception
            pluginScope.addHook('onRoute', (routeOptions) => {
              const subPath = routeOptions.url.startsWith(apiBasePath)
                ? routeOptions.url.slice(apiBasePath.length)
                : routeOptions.url;

              for (const forbidden of FORBIDDEN_ROUTE_PREFIXES) {
                if (subPath.startsWith(forbidden) || routeOptions.url.startsWith(forbidden)) {
                  throw new Error(
                    `Security violation: Plugin "${pluginId}" attempted to register a forbidden core route prefix "${routeOptions.url}"`
                  );
                }
              }
            });

            await plugin.registerRoutes!(pluginScope, context);
          },
          { prefix: apiBasePath }
        );

        await fastify.after();
      }
    }
  }

  /**
   * Shuts down all registered plugins cleanly.
   */
  async shutdown(): Promise<void> {
    for (const [pluginId, plugin] of this.plugins.entries()) {
      if (plugin.onShutdown) {
        try {
          await plugin.onShutdown();
        } catch (err: any) {
          console.error(`[PluginRegistry] Error shutting down plugin "${pluginId}":`, err);
        }
      }
    }
    this.bus.clear();
    this.booted = false;
  }
}

/**
 * Global singleton registry for the API service.
 */
export const defaultBackendRegistry = new BackendPluginRegistry();
