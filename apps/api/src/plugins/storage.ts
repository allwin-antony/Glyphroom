import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { pluginStorage } from '../db/schema.js';
import {
  PluginStorageScopeSchema,
  PluginStorageKeySchema,
  MAX_PLUGIN_STORAGE_VALUE_BYTES,
} from '@enterprise-blogger/shared';

export class PluginStorage {
  constructor(
    private readonly db: Database,
    private readonly pluginId: string
  ) {}

  /**
   * Retrieves a typed value stored under (pluginId, scope, key).
   */
  async get<T = unknown>(scope: string, key: string): Promise<T | null> {
    const validScope = PluginStorageScopeSchema.parse(scope);
    const validKey = PluginStorageKeySchema.parse(key);

    const [row] = await this.db
      .select({ value: pluginStorage.value })
      .from(pluginStorage)
      .where(
        and(
          eq(pluginStorage.pluginId, this.pluginId),
          eq(pluginStorage.scope, validScope),
          eq(pluginStorage.key, validKey)
        )
      )
      .limit(1);

    if (!row) return null;
    return row.value as T;
  }

  /**
   * Sets or updates a value stored under (pluginId, scope, key).
   * Automatically enforces a 256 KB serialized limit.
   */
  async set<T = unknown>(scope: string, key: string, value: T): Promise<void> {
    const validScope = PluginStorageScopeSchema.parse(scope);
    const validKey = PluginStorageKeySchema.parse(key);

    const serialized = JSON.stringify(value);
    const byteLength = Buffer.byteLength(serialized, 'utf8');

    if (byteLength > MAX_PLUGIN_STORAGE_VALUE_BYTES) {
      throw new Error(
        `Plugin storage value exceeds maximum size of ${MAX_PLUGIN_STORAGE_VALUE_BYTES} bytes (actual: ${byteLength} bytes)`
      );
    }

    await this.db
      .insert(pluginStorage)
      .values({
        pluginId: this.pluginId,
        scope: validScope,
        key: validKey,
        value: value as any,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [pluginStorage.pluginId, pluginStorage.scope, pluginStorage.key],
        set: {
          value: value as any,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Deletes a stored item under (pluginId, scope, key).
   */
  async delete(scope: string, key: string): Promise<void> {
    const validScope = PluginStorageScopeSchema.parse(scope);
    const validKey = PluginStorageKeySchema.parse(key);

    await this.db
      .delete(pluginStorage)
      .where(
        and(
          eq(pluginStorage.pluginId, this.pluginId),
          eq(pluginStorage.scope, validScope),
          eq(pluginStorage.key, validKey)
        )
      );
  }

  /**
   * Lists all keys and values stored under a given scope for this plugin.
   */
  async list(scope: string): Promise<Array<{ key: string; value: unknown }>> {
    const validScope = PluginStorageScopeSchema.parse(scope);

    const rows = await this.db
      .select({ key: pluginStorage.key, value: pluginStorage.value })
      .from(pluginStorage)
      .where(
        and(
          eq(pluginStorage.pluginId, this.pluginId),
          eq(pluginStorage.scope, validScope)
        )
      );

    return rows;
  }
}
