import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pino } from 'pino';
import { createMcpServer } from '../src/server.js';
import { CollabGatewayClient } from '../src/gateway/client.js';
import { CollabGatewayError } from '../src/gateway/types.js';

describe('MCP Tools Suite (append_section, insert_after_section, suggest_edit_section)', () => {
  const logger = pino({ level: 'silent' });
  let gatewayClient: CollabGatewayClient;

  beforeEach(() => {
    gatewayClient = new CollabGatewayClient({
      gatewayUrl: 'http://127.0.0.1:4000/internal/agent-gateway/edit',
      gatewaySecret: 'test-secret',
      defaultUserId: 'user-1',
      defaultAgentId: 'agent-1',
    });
  });

  it('registers all 3 tools on the McpServer instance', () => {
    const server = createMcpServer({
      gatewayClient,
      logger,
    });

    const registeredTools = (server as any)._registeredTools;
    expect(registeredTools).toBeDefined();
    expect(registeredTools['append_section']).toBeDefined();
    expect(registeredTools['insert_after_section']).toBeDefined();
    expect(registeredTools['suggest_edit_section']).toBeDefined();
  });

  describe('append_section tool', () => {
    it('executes successfully and returns structured text JSON', async () => {
      const server = createMcpServer({ gatewayClient, logger });
      const tool = (server as any)._registeredTools['append_section'];

      vi.spyOn(gatewayClient, 'sendEdit').mockResolvedValueOnce({
        success: true,
        operation: 'append_section',
        documentId: 'post-test-1',
        appliedAt: 1729680000000,
        changesSummary: { insertions: 20, deletions: 0, hunksApplied: 1 },
        suggestionIds: ['sug-1'],
      });

      const res = await tool.handler({
        postId: 'post-test-1',
        heading: 'Appended Section',
        content: 'Appended body content.',
      });

      expect(res.isError).toBeUndefined();
      expect(res.content).toHaveLength(1);
      expect(res.content[0].type).toBe('text');

      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.postId).toBe('post-test-1');
      expect(parsed.operation).toBe('append_section');
      expect(parsed.message).toContain('successfully appended');
    });

    it('returns error result gracefully when gateway rejects', async () => {
      const server = createMcpServer({ gatewayClient, logger });
      const tool = (server as any)._registeredTools['append_section'];

      vi.spyOn(gatewayClient, 'sendEdit').mockRejectedValueOnce(
        new CollabGatewayError('Unauthorized edit', 'UNAUTHORIZED', 401)
      );

      const res = await tool.handler({
        postId: 'post-test-2',
        content: 'Content that fails auth',
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('[UNAUTHORIZED]');
      expect(res.content[0].text).toContain('Unauthorized edit');
    });
  });

  describe('insert_after_section tool', () => {
    it('executes successfully and returns structured text JSON', async () => {
      const server = createMcpServer({ gatewayClient, logger });
      const tool = (server as any)._registeredTools['insert_after_section'];

      vi.spyOn(gatewayClient, 'sendEdit').mockResolvedValueOnce({
        success: true,
        operation: 'insert_after_section',
        documentId: 'post-test-3',
        appliedAt: 1729680000000,
        changesSummary: { insertions: 25, deletions: 0, hunksApplied: 1 },
      });

      const res = await tool.handler({
        postId: 'post-test-3',
        targetHeading: 'Target Section',
        heading: 'New Inserted Section',
        content: 'Inserted content block.',
      });

      expect(res.isError).toBeUndefined();
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.postId).toBe('post-test-3');
      expect(parsed.operation).toBe('insert_after_section');
      expect(parsed.message).toContain('successfully inserted after "Target Section"');
    });

    it('returns error result when target heading does not exist', async () => {
      const server = createMcpServer({ gatewayClient, logger });
      const tool = (server as any)._registeredTools['insert_after_section'];

      vi.spyOn(gatewayClient, 'sendEdit').mockRejectedValueOnce(
        new CollabGatewayError('Target heading "Missing Heading" not found', 'SECTION_NOT_FOUND', 404)
      );

      const res = await tool.handler({
        postId: 'post-test-4',
        targetHeading: 'Missing Heading',
        content: 'Content block',
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('[SECTION_NOT_FOUND]');
    });
  });

  describe('suggest_edit_section tool', () => {
    it('executes successfully and returns changesSummary and suggestionIds', async () => {
      const server = createMcpServer({ gatewayClient, logger });
      const tool = (server as any)._registeredTools['suggest_edit_section'];

      vi.spyOn(gatewayClient, 'sendEdit').mockResolvedValueOnce({
        success: true,
        operation: 'suggest_edit_section',
        documentId: 'post-test-5',
        appliedAt: 1729680000000,
        changesSummary: { insertions: 12, deletions: 8, hunksApplied: 2 },
        suggestionIds: ['sug-101', 'sug-102'],
      });

      const res = await tool.handler({
        postId: 'post-test-5',
        targetHeading: 'Existing Heading',
        newContent: 'Updated replacement content.',
        instruction: 'Improve conciseness',
      });

      expect(res.isError).toBeUndefined();
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.postId).toBe('post-test-5');
      expect(parsed.operation).toBe('suggest_edit_section');
      expect(parsed.suggestionsCount).toBe(2);
      expect(parsed.suggestionIds).toEqual(['sug-101', 'sug-102']);
      expect(parsed.changesSummary.insertions).toBe(12);
      expect(parsed.changesSummary.deletions).toBe(8);
      expect(parsed.changesSummary.hunksApplied).toBe(2);
    });

    it('returns error result gracefully when diff fails or heading is missing', async () => {
      const server = createMcpServer({ gatewayClient, logger });
      const tool = (server as any)._registeredTools['suggest_edit_section'];

      vi.spyOn(gatewayClient, 'sendEdit').mockRejectedValueOnce(
        new CollabGatewayError('Target section not found', 'SECTION_NOT_FOUND', 404)
      );

      const res = await tool.handler({
        postId: 'post-test-6',
        targetHeading: 'Ghost Section',
        newContent: 'Content',
      });

      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('[SECTION_NOT_FOUND]');
    });
  });
});
