import { z } from 'zod';

/**
 * Status of a suggestion hunk.
 */
export const SuggestionStatusSchema = z.enum(['pending', 'accepted', 'rejected']);
export type SuggestionStatus = z.infer<typeof SuggestionStatusSchema>;

/**
 * ProseMirror Mark Attributes for suggestion_insert.
 */
export const SuggestionInsertAttrsSchema = z.object({
  id: z.string().uuid().or(z.string().min(1)).optional(),
  agentId: z.string().min(1, 'agentId is required'),
  tokenId: z.string().min(1, 'tokenId is required'),
  ownerUserId: z.string().min(1, 'ownerUserId is required'),
  timestamp: z.number().int().positive('timestamp must be a positive integer'),
  status: SuggestionStatusSchema.default('pending'),
});
export type SuggestionInsertAttrs = z.infer<typeof SuggestionInsertAttrsSchema>;

/**
 * ProseMirror Mark Attributes for suggestion_delete.
 */
export const SuggestionDeleteAttrsSchema = z.object({
  id: z.string().uuid().or(z.string().min(1)).optional(),
  agentId: z.string().min(1, 'agentId is required'),
  tokenId: z.string().min(1, 'tokenId is required'),
  ownerUserId: z.string().min(1, 'ownerUserId is required'),
  timestamp: z.number().int().positive('timestamp must be a positive integer'),
  status: SuggestionStatusSchema.default('pending'),
});
export type SuggestionDeleteAttrs = z.infer<typeof SuggestionDeleteAttrsSchema>;

/**
 * Attributes for attribution mark (applied to accepted suggestions).
 */
export const AttributionAttrsSchema = z.object({
  authorType: z.enum(['agent', 'human']).default('agent'),
  agentId: z.string().min(1).optional(),
  tokenId: z.string().min(1).optional(),
  ownerUserId: z.string().min(1).optional(),
  acceptedBy: z.string().min(1).optional(),
  acceptedAt: z.number().int().positive().optional(),
});
export type AttributionAttrs = z.infer<typeof AttributionAttrsSchema>;

/**
 * Suggestion Hunk Descriptor for diff operations and UI representation.
 */
export const SuggestionHunkSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['insert', 'delete']),
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  text: z.string(),
  attributes: SuggestionInsertAttrsSchema,
});
export type SuggestionHunk = z.infer<typeof SuggestionHunkSchema>;

/**
 * Payload to accept or reject a suggestion.
 */
export const ResolveSuggestionPayloadSchema = z.object({
  suggestionId: z.string().min(1, 'suggestionId is required'),
  action: z.enum(['accept', 'reject']),
  resolvedByUserId: z.string().min(1, 'resolvedByUserId is required'),
  resolvedAt: z.number().int().positive().default(() => Date.now()),
});
export type ResolveSuggestionPayload = z.infer<typeof ResolveSuggestionPayloadSchema>;
