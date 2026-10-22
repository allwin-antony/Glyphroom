import { z } from 'zod';

/**
 * Whitelist regex for safe identifiers (documentId, postId, userId, agentId, tokenId, suggestionId).
 * Enforces alphanumeric characters, hyphens, and underscores only.
 * Strictly disallows path traversal (../, ..\), slashes, dots, null bytes, shell metacharacters, and SQL/XSS tokens.
 */
export const SAFE_IDENTIFIER_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Generic safe identifier schema bounded between 1 and 128 characters.
 */
export const SafeIdentifierSchema = z
  .string()
  .min(1, 'Identifier cannot be empty')
  .max(128, 'Identifier exceeds maximum length of 128 characters')
  .regex(
    SAFE_IDENTIFIER_REGEX,
    'Identifier must contain only alphanumeric characters, hyphens, and underscores'
  );

/**
 * Safe documentId schema ensuring strict sanitization against path traversal and null bytes.
 */
export const DocumentIdSchema = z
  .string()
  .min(1, 'documentId is required')
  .max(128, 'documentId exceeds maximum length of 128 characters')
  .regex(
    SAFE_IDENTIFIER_REGEX,
    'documentId must contain only alphanumeric characters, hyphens, and underscores'
  );

/**
 * Safe postId schema ensuring strict sanitization against path traversal and null bytes.
 */
export const PostIdSchema = z
  .string()
  .min(1, 'postId is required')
  .max(128, 'postId exceeds maximum length of 128 characters')
  .regex(
    SAFE_IDENTIFIER_REGEX,
    'postId must contain only alphanumeric characters, hyphens, and underscores'
  );

/**
 * Headers required by the Agent Gateway internal HTTP endpoint.
 * Supports both X-Gateway-Secret (PROJECT.md) and x-internal-service-key (legacy),
 * case-insensitively, normalizing the secret to both keys for downstream handlers.
 */
const RawAgentGatewayHeadersSchema = z
  .object({
    'x-gateway-secret': z.string().min(1, 'Gateway secret cannot be empty').optional(),
    'x-internal-service-key': z.string().min(1, 'Internal service key cannot be empty').optional(),
    'x-user-id': SafeIdentifierSchema,
    'x-agent-id': SafeIdentifierSchema,
    'x-token-id': SafeIdentifierSchema.optional(),
  })
  .refine(
    (headers) => Boolean(headers['x-gateway-secret'] || headers['x-internal-service-key']),
    {
      message: 'Gateway authentication secret is required (x-gateway-secret or x-internal-service-key)',
      path: ['x-gateway-secret'],
    }
  )
  .transform((headers) => {
    const secret = headers['x-gateway-secret'] || headers['x-internal-service-key']!;
    return {
      ...headers,
      'x-gateway-secret': headers['x-gateway-secret'] || secret,
      'x-internal-service-key': headers['x-internal-service-key'] || secret,
    };
  });

export const AgentGatewayHeadersSchema = z.preprocess((val) => {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const normalized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      normalized[k.toLowerCase()] = v;
    }
    return normalized;
  }
  return val;
}, RawAgentGatewayHeadersSchema);
export type AgentGatewayHeaders = z.infer<typeof AgentGatewayHeadersSchema>;

/**
 * Discriminated union of edit operations supported by Agent Gateway.
 */
export const AppendSectionPayloadSchema = z.object({
  operation: z.literal('append_section'),
  documentId: DocumentIdSchema,
  heading: z.string().max(500, 'Heading cannot exceed 500 characters').optional(),
  content: z.string().min(1, 'content must not be empty'),
  tokenId: SafeIdentifierSchema.optional(),
});
export type AppendSectionPayload = z.infer<typeof AppendSectionPayloadSchema>;

export const InsertAfterSectionPayloadSchema = z.object({
  operation: z.literal('insert_after_section'),
  documentId: DocumentIdSchema,
  targetHeading: z.string().min(1, 'targetHeading is required to anchor insertion').max(500),
  heading: z.string().max(500, 'Heading cannot exceed 500 characters').optional(),
  content: z.string().min(1, 'content must not be empty'),
  tokenId: SafeIdentifierSchema.optional(),
});
export type InsertAfterSectionPayload = z.infer<typeof InsertAfterSectionPayloadSchema>;

export const SuggestEditSectionPayloadSchema = z.object({
  operation: z.literal('suggest_edit_section'),
  documentId: DocumentIdSchema,
  targetHeading: z.string().min(1, 'targetHeading is required to target section diff').max(500),
  content: z.string().min(1, 'content must not be empty'),
  instruction: z.string().max(2000, 'Instruction cannot exceed 2000 characters').optional(),
  tokenId: SafeIdentifierSchema.optional(),
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
  documentId: DocumentIdSchema,
  appliedAt: z.number().int().positive(),
  documentVersion: z.number().int().nonnegative().optional(),
  changesSummary: z.object({
    insertions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    hunksApplied: z.number().int().nonnegative().optional(),
  }),
  suggestionIds: z.array(SafeIdentifierSchema).optional(),
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
