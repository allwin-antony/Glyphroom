import { describe, it, expect } from 'vitest';
import {
  AgentGatewayEditRequestSchema,
  AgentGatewayEditResponseSchema,
  AgentGatewayErrorResponseSchema,
  SuggestionInsertAttrsSchema,
  McpSuggestEditSectionInputSchema,
  McpSearchPostsInputSchema,
  safeValidate,
  validateOrThrow,
} from '../src/validation/index.js';

describe('Zod Validation Contracts', () => {
  describe('Agent Gateway Edit Request Schemas', () => {
    it('successfully parses valid append_section payload', () => {
      const valid = {
        operation: 'append_section',
        documentId: 'post-101',
        heading: 'Conclusion',
        content: 'This is the new final section.',
      };

      const result = safeValidate(AgentGatewayEditRequestSchema, valid);
      expect(result.success).toBe(true);
    });

    it('successfully parses valid insert_after_section payload', () => {
      const valid = {
        operation: 'insert_after_section',
        documentId: 'post-101',
        targetHeading: 'Introduction',
        heading: 'Background',
        content: 'Background context goes here.',
      };

      const result = safeValidate(AgentGatewayEditRequestSchema, valid);
      expect(result.success).toBe(true);
    });

    it('successfully parses valid suggest_edit_section payload', () => {
      const valid = {
        operation: 'suggest_edit_section',
        documentId: 'post-101',
        targetHeading: 'Architecture Overview',
        content: 'Refined architecture prose with clearer diagrams.',
        instruction: 'Fix technical inaccuracies in paragraph 2',
      };

      const result = safeValidate(AgentGatewayEditRequestSchema, valid);
      expect(result.success).toBe(true);
    });

    it('rejects suggest_edit_section when targetHeading is missing', () => {
      const invalid = {
        operation: 'suggest_edit_section',
        documentId: 'post-101',
        content: 'Missing target heading',
      };

      const result = safeValidate(AgentGatewayEditRequestSchema, invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.formattedError).toContain('targetHeading');
      }
    });

    it('rejects payloads with empty content string', () => {
      const invalid = {
        operation: 'append_section',
        documentId: 'post-101',
        content: '',
      };

      const result = safeValidate(AgentGatewayEditRequestSchema, invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.formattedError).toContain('content');
      }
    });

    it('rejects unsupported operation types', () => {
      const invalid = {
        operation: 'delete_entire_document',
        documentId: 'post-101',
        content: 'destructive',
      };

      const result = safeValidate(AgentGatewayEditRequestSchema, invalid as any);
      expect(result.success).toBe(false);
    });
  });

  describe('Agent Gateway Edit Response Schemas', () => {
    it('validates a successful edit response payload', () => {
      const response = {
        success: true as const,
        operation: 'suggest_edit_section' as const,
        documentId: 'post-101',
        appliedAt: 1729612800000,
        documentVersion: 4,
        changesSummary: {
          insertions: 5,
          deletions: 2,
          hunksApplied: 7,
        },
        suggestionIds: ['sug-1', 'sug-2'],
      };

      expect(() => validateOrThrow(AgentGatewayEditResponseSchema, response)).not.toThrow();
    });

    it('rejects response with negative change counts', () => {
      const invalid = {
        success: true as const,
        operation: 'suggest_edit_section' as const,
        documentId: 'post-101',
        appliedAt: 1729612800000,
        changesSummary: {
          insertions: -1,
          deletions: 0,
        },
      };

      expect(() => validateOrThrow(AgentGatewayEditResponseSchema, invalid as any)).toThrow();
    });

    it('validates structured error response', () => {
      const errorResp = {
        success: false as const,
        code: 'SECTION_NOT_FOUND' as const,
        message: 'Could not anchor section heading "Unknown"',
      };

      expect(() => validateOrThrow(AgentGatewayErrorResponseSchema, errorResp)).not.toThrow();
    });
  });

  describe('MCP Tool Contracts', () => {
    it('validates McpSuggestEditSectionInputSchema', () => {
      const input = {
        postId: 'post-888',
        targetHeading: 'Benchmark Results',
        newContent: 'Updated throughput numbers.',
      };

      expect(() => validateOrThrow(McpSuggestEditSectionInputSchema, input)).not.toThrow();
    });

    it('enforces limit boundary on search_posts (max 50)', () => {
      const overLimit = {
        query: 'CRDT',
        limit: 100, // max is 50
      };

      const result = safeValidate(McpSearchPostsInputSchema, overLimit);
      expect(result.success).toBe(false);
    });
  });

  describe('Suggestion Attributes Schema', () => {
    it('defaults status to pending', () => {
      const attrs = {
        agentId: 'agent-x',
        tokenId: 'tok-y',
        ownerUserId: 'user-z',
        timestamp: 1729600000000,
      };

      const parsed = validateOrThrow(SuggestionInsertAttrsSchema, attrs);
      expect(parsed.status).toBe('pending');
    });

    it('rejects invalid status', () => {
      const attrs = {
        agentId: 'agent-x',
        tokenId: 'tok-y',
        ownerUserId: 'user-z',
        timestamp: 1729600000000,
        status: 'draft', // not in enum
      };

      expect(() => validateOrThrow(SuggestionInsertAttrsSchema, attrs as any)).toThrow();
    });
  });
});
