import { describe, it, expect, afterAll } from 'vitest';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { createApiApp } from '../src/app.js';
import { BackendPluginRegistry } from '../src/plugins/registry.js';
import type { GlyphroomBackendPlugin } from '../src/plugins/types.js';

describe('Phase 1: Backend Plugin Registry & Scoped Storage Suite', () => {
  it('boots a registered plugin and serves namespaced routes under /api/v1/plugins/:pluginId', async () => {
    const { db } = createInMemoryDatabase();
    const registry = new BackendPluginRegistry();

    let startupCalled = false;
    let shutdownCalled = false;

    const testPlugin: GlyphroomBackendPlugin = {
      manifest: {
        id: 'sample-analytics',
        name: 'Sample Analytics',
        version: '1.0.0',
        capabilities: ['api:routes', 'api:storage'],
      },
      onStartup: async (context) => {
        startupCalled = true;
        // Test initial storage set
        await context.storage.set('global', 'status', { initialized: true });
      },
      onShutdown: async () => {
        shutdownCalled = true;
      },
      registerRoutes: async (fastify, context) => {
        fastify.get('/ping', async () => {
          const status = await context.storage.get('global', 'status');
          return { reply: 'pong', status, pluginId: context.pluginId };
        });
      },
    };

    registry.register(testPlugin);

    const { app, close } = await createApiApp({
      db,
      pluginRegistry: registry,
    });

    expect(startupCalled).toBe(true);

    // Call the namespaced route
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/plugins/sample-analytics/ping',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reply).toBe('pong');
    expect(body.pluginId).toBe('sample-analytics');
    expect(body.status).toEqual({ initialized: true });

    await close();
    expect(shutdownCalled).toBe(true);
  });

  it('strictly isolates plugin storage between different plugins', async () => {
    const { db } = createInMemoryDatabase();
    const registry = new BackendPluginRegistry();

    let pluginAValue: unknown = null;

    const pluginA: GlyphroomBackendPlugin = {
      manifest: {
        id: 'plugin-a',
        name: 'Plugin A',
        version: '1.0.0',
        capabilities: ['api:storage'],
      },
      onStartup: async (context) => {
        await context.storage.set('global', 'secret', { token: 'A-secret-123' });
      },
    };

    const pluginB: GlyphroomBackendPlugin = {
      manifest: {
        id: 'plugin-b',
        name: 'Plugin B',
        version: '1.0.0',
        capabilities: ['api:storage'],
      },
      onStartup: async (context) => {
        // Plugin B attempts to read key 'secret'
        pluginAValue = await context.storage.get('global', 'secret');
        // Plugin B sets its own key 'secret'
        await context.storage.set('global', 'secret', { token: 'B-custom-456' });
      },
    };

    registry.register(pluginA);
    registry.register(pluginB);

    const { close } = await createApiApp({
      db,
      pluginRegistry: registry,
    });

    // Plugin B should receive null because its namespace has no 'secret' yet when reading
    expect(pluginAValue).toBeNull();

    await close();
  });

  it('enforces maximum 256 KB value limit in plugin storage', async () => {
    const { db } = createInMemoryDatabase();
    const registry = new BackendPluginRegistry();

    const largeDataPlugin: GlyphroomBackendPlugin = {
      manifest: {
        id: 'large-data-plugin',
        name: 'Large Data',
        version: '1.0.0',
        capabilities: ['api:storage'],
      },
      onStartup: async (context) => {
        const largeString = 'x'.repeat(257 * 1024); // 257 KB > 256 KB limit
        await expect(context.storage.set('global', 'blob', { data: largeString })).rejects.toThrow(
          /exceeds maximum size of 262144 bytes/
        );
      },
    };

    registry.register(largeDataPlugin);

    const { close } = await createApiApp({
      db,
      pluginRegistry: registry,
    });

    await close();
  });

  it('rejects duplicate plugin IDs at registration time', () => {
    const registry = new BackendPluginRegistry();
    const manifest = {
      id: 'duplicate-plugin',
      name: 'First',
      version: '1.0.0',
      capabilities: [] as any[],
    };

    registry.register({ manifest });
    expect(() => registry.register({ manifest: { ...manifest, name: 'Second' } })).toThrow(
      /Duplicate plugin ID registered/
    );
  });

  it('rejects plugins declaring capability without providing implementation', () => {
    const registry = new BackendPluginRegistry();
    expect(() =>
      registry.register({
        manifest: {
          id: 'missing-impl',
          name: 'Missing',
          version: '1.0.0',
          capabilities: ['api:routes'],
        },
      })
    ).toThrow(/declared 'api:routes' capability but did not provide registerRoutes\(\)/);
  });

  it('blocks plugins from attempting to register forbidden core route prefixes', async () => {
    const { db } = createInMemoryDatabase();
    const registry = new BackendPluginRegistry();

    const hijackingPlugin: GlyphroomBackendPlugin = {
      manifest: {
        id: 'hijacker',
        name: 'Hijacker',
        version: '1.0.0',
        capabilities: ['api:routes'],
      },
      registerRoutes: async (fastify) => {
        fastify.get('/posts/hijacked', async () => ({ status: 'compromised' }));
      },
    };

    registry.register(hijackingPlugin);

    await expect(
      createApiApp({
        db,
        pluginRegistry: registry,
      })
    ).rejects.toThrow(/Security violation: Plugin "hijacker" attempted to register a forbidden core route prefix/);
  });
});
