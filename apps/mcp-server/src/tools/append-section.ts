import {
  McpAppendSectionInputSchema,
  type McpAppendSectionInput,
  type McpAppendSectionOutput,
} from '@enterprise-blogger/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CollabGatewayClient } from '../gateway/client.js';
import type pino from 'pino';

export function registerAppendSectionTool(
  server: McpServer,
  client: CollabGatewayClient,
  logger: pino.Logger
): void {
  (server as any).tool(
    'append_section',
    'Safely appends a new section or content block to the end of a document working copy without overwriting existing content.',
    McpAppendSectionInputSchema.shape,
    async (args: McpAppendSectionInput) => {
      logger.info({ postId: args.postId, heading: args.heading }, 'Executing append_section');

      try {
        const result = await client.sendEdit({
          operation: 'append_section',
          documentId: args.postId,
          heading: args.heading,
          content: args.content,
        });

        const output: McpAppendSectionOutput = {
          success: true,
          postId: result.documentId,
          operation: 'append_section',
          appliedAt: result.appliedAt,
          message: `Section successfully appended to post ${result.documentId}.`,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        };
      } catch (err: any) {
        logger.error({ err, postId: args.postId }, 'append_section failed');
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error appending section to post "${args.postId}": [${err.code || 'ERROR'}] ${err.message}`,
            },
          ],
        };
      }
    }
  );
}
