import {
  McpInsertAfterSectionInputSchema,
  type McpInsertAfterSectionInput,
  type McpInsertAfterSectionOutput,
} from '@enterprise-blogger/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CollabGatewayClient } from '../gateway/client.js';
import type pino from 'pino';

export function registerInsertAfterSectionTool(
  server: McpServer,
  client: CollabGatewayClient,
  logger: pino.Logger
): void {
  (server as any).tool(
    'insert_after_section',
    'Safely inserts a new section or content block immediately after a target section heading in the document working copy.',
    McpInsertAfterSectionInputSchema.shape,
    async (args: McpInsertAfterSectionInput) => {
      logger.info(
        { postId: args.postId, targetHeading: args.targetHeading },
        'Executing insert_after_section'
      );

      try {
        const result = await client.sendEdit({
          operation: 'insert_after_section',
          documentId: args.postId,
          targetHeading: args.targetHeading,
          heading: args.heading,
          content: args.content,
        });

        const output: McpInsertAfterSectionOutput = {
          success: true,
          postId: result.documentId,
          operation: 'insert_after_section',
          appliedAt: result.appliedAt,
          message: `Section successfully inserted after "${args.targetHeading}" in post ${result.documentId}.`,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        };
      } catch (err: any) {
        logger.error(
          { err, postId: args.postId, target: args.targetHeading },
          'insert_after_section failed'
        );
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error inserting section after "${args.targetHeading}" in post "${args.postId}": [${err.code || 'ERROR'}] ${err.message}`,
            },
          ],
        };
      }
    }
  );
}
