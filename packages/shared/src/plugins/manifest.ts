import { z } from 'zod';

export const PluginCapabilitySchema = z.enum([
  'ui:slots',
  'ui:editor',
  'api:routes',
  'api:events',
  'api:storage',
  'mcp:tools',
]);

export const PluginManifestSchema = z.object({
  id: z
    .string()
    .min(1, 'Plugin ID is required')
    .max(50, 'Plugin ID must be 50 characters or less')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Plugin ID must be lower-case alphanumeric with optional hyphens (kebab-case)'),
  name: z.string().min(1, 'Plugin name is required').max(100, 'Plugin name cannot exceed 100 characters'),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'Plugin version must follow SemVer format (e.g. 1.0.0)'),
  description: z.string().max(500, 'Plugin description cannot exceed 500 characters').optional(),
  author: z.string().max(200, 'Plugin author cannot exceed 200 characters').optional(),
  capabilities: z.array(PluginCapabilitySchema).default([]),
});

export type PluginCapability = z.infer<typeof PluginCapabilitySchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/**
 * Validates a plugin manifest object against the schema.
 * Throws ZodError on validation failure.
 */
export function validatePluginManifest(manifest: unknown): PluginManifest {
  return PluginManifestSchema.parse(manifest);
}

/**
 * Validates whether a given string is a valid plugin ID (kebab-case alphanumeric).
 */
export function isValidPluginId(id: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}
