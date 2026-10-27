import { z } from 'zod';

export const UiSlotIdentifierSchema = z.enum([
  'topbar:actions',
  'sidebar:navigation',
  'editor:toolbar:actions',
  'editor:drawer:tabs',
  'editor:slash:commands',
  'reader:header:actions',
  'reader:content:banner',
  'admin:console:tabs',
]);

export type UiSlotIdentifier = z.infer<typeof UiSlotIdentifierSchema>;

export interface UiSlotRegistrationMetadata {
  id: string;
  pluginId: string;
  slot: UiSlotIdentifier;
  order?: number;
}
