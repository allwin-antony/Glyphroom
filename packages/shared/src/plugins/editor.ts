import { z } from 'zod';

export const CORE_SLASH_COMMAND_IDS = [
  'heading-1',
  'heading-2',
  'heading-3',
  'bullet-list',
  'numbered-list',
  'task-list',
  'table',
  'callout',
  'math-block',
  'mermaid-diagram',
  'project-status',
  'attachment',
] as const;

export type CoreSlashCommandId = typeof CORE_SLASH_COMMAND_IDS[number];

export const PluginSlashCommandSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Command ID must be lower-case alphanumeric with optional hyphens')
    .refine((id) => !CORE_SLASH_COMMAND_IDS.includes(id as any), {
      message: 'Plugin slash command ID conflicts with a reserved core command ID',
    }),
  pluginId: z.string().min(1),
  label: z.string().min(1).max(50),
  description: z.string().max(200),
  keywords: z.array(z.string()).optional(),
  order: z.number().int().optional(),
});

export type PluginSlashCommandDefinition = z.infer<typeof PluginSlashCommandSchema>;
