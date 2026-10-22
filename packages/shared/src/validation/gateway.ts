import { z } from 'zod';

/**
 * Headers required by the Agent Gateway internal HTTP endpoint.
 */
export const AgentGatewayHeadersSchema = z.object({
  'x-internal-service-key': z.string().min(1, 'Internal service key required'),
  'x-user-id': z.string().min(1, 'Owner user id required'),
  'x-agent-id': z.string().min(1, 'Agent id required'),
  'x-token-id': z.string().min(1).optional(),
});
export type AgentGatewayHeaders = z.infer<typeof AgentGatewayHeadersSchema>;

/**
 * Discriminated union of edit operations supported by Agent Gateway.
 */
export const AppendSectionPayloadSchema = z.object({
  operation: z.literal('append_section'),
  documentId: z.string().min(1, 'documentId is required'),
  heading: z.string().optional(),
  content: z.string().min(1, 'content must not be empty'),
  tokenId: z.string().optional(),
});
export type AppendSectionPayload = z.infer<typeof AppendSectionPayloadSchema>;

export const InsertAfterSectionPayloadSchema = z.object({
  operation: z.literal('insert_after_section'),
  documentId: z.string().min(1, 'documentId is required'),
  targetHeading: z.string().min(1, 'targetHeading is required to anchor insertion'),
  heading: z.string().optional(),
  content: z.string().min(1, 'content must not be empty'),
  tokenId: z.string().optional(),
});
export type InsertAfterSectionPayload = z.infer<typeof InsertAfterSectionPayloadSchema>;

export const SuggestEditSectionPayloadSchema = z.object({
  operation: z.literal('suggest_edit_section'),
  documentId: z.string().min(1, 'documentId is required'),
  targetHeading: z.string().min(1, 'targetHeading is required to target section diff'),
  content: z.string().min(1, 'content must not be empty'),
  instruction: z.string().optional(),
  tokenId: z.string().optional(),
});
export type SuggestEditSectionPayload = z.infer<typeof SuggestEditSectionPayloadSchema>;

export const AgentGatewayEditRequestSchema = z.discriminatedUnion('operation', [
  AppendSectionPayloadSchema,
  InsertAfterSectionPayloadSchema,
  SuggestEditSectionPayloadSchema,
]);
export type AgentGatewayEditRequest = z.infer<typeof AgentGatewayEditRequestSchema>;

/**
 * Successful response from the Agent Gateway.
 */
export const AgentGatewayEditResponseSchema = z.object({
  success: z.literal(true),
  operation: z.enum(['append_section', 'insert_after_section', 'suggest_edit_section']),
  documentId: z.string().min(1),
  appliedAt: z.number().int().positive(),
  documentVersion: z.number().int().nonnegative().optional(),
  changesSummary: z.object({
    insertions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    hunksApplied: z.number().int().nonnegative().optional(),
  }),
  suggestionIds: z.array(z.string()).optional(),
});
export type AgentGatewayEditResponse = z.infer<typeof AgentGatewayEditResponseSchema>;

/**
 * Error response from the Agent Gateway.
 */
export const AgentGatewayErrorCodeSchema = z.enum([
  'UNAUTHORIZED',
  'FORBIDDEN',
  'DOCUMENT_NOT_FOUND',
  'SECTION_NOT_FOUND',
  'INVALID_OPERATION',
  'CRDT_MUTATION_FAILED',
  'VALIDATION_FAILED',
  'INTERNAL_ERROR',
]);
export type AgentGatewayErrorCode = z.infer<typeof AgentGatewayErrorCodeSchema>;

export const AgentGatewayErrorResponseSchema = z.object({
  success: z.literal(false),
  code: AgentGatewayErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});
export type AgentGatewayErrorResponse = z.infer<typeof AgentGatewayErrorResponseSchema>;

export type AgentGatewayResponse = AgentGatewayEditResponse | AgentGatewayErrorResponse;
