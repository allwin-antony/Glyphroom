import { z } from 'zod';

export const MAX_PLUGIN_STORAGE_KEY_LENGTH = 200;
export const MAX_PLUGIN_STORAGE_VALUE_BYTES = 256 * 1024; // 256 KB

export const PluginStorageScopeRegex = /^(global|space:[0-9a-fA-F-]{36}|post:[0-9a-fA-F-]{36})$/;

export const PluginStorageScopeSchema = z
  .string()
  .regex(
    PluginStorageScopeRegex,
    "Scope must be 'global', 'space:<uuid>', or 'post:<uuid>'"
  );

export const PluginStorageKeySchema = z
  .string()
  .min(1, 'Storage key cannot be empty')
  .max(MAX_PLUGIN_STORAGE_KEY_LENGTH, `Storage key cannot exceed ${MAX_PLUGIN_STORAGE_KEY_LENGTH} characters`)
  .regex(/^[a-zA-Z0-9_.:-]+$/, 'Storage key contains invalid characters');

export interface PluginStorageItem<T = unknown> {
  key: string;
  value: T;
  updatedAt?: string;
}
