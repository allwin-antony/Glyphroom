import {
  McpSuggestEditSectionInputSchema,
  type McpSuggestEditSectionInput,
  type McpSuggestEditSectionOutput,
} from '@enterprise-blogger/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CollabGatewayClient } from '../gateway/client.js';
import type pino from 'pino';

export function registerSuggestEditSectionTool(
  server: McpServer,
  client: CollabGatewayClient,
  logger: pino.Logger
): void {
  (server as any).tool(
    'suggest_edit_section',
    'Applies section replacements as fine-grained suggestion marks (suggestion-insert and suggestion-delete) with durable agent attribution. Strictly prevents coarse block deletion and loss of human typing.',
    McpSuggestEditSectionInputSchema.shape,
    async (args: McpSuggestEditSectionInput) => {
      logger.info(
        { postId: args.postId, targetHeading: args.targetHeading },
        'Executing suggest_edit_section'
      );

      try {
        const result = await client.sendEdit({
          operation: 'suggest_edit_section',
          documentId: args.postId,
          targetHeading: args.targetHeading,
          content: args.newContent,
          instruction: args.instruction,
        });

        const output: McpSuggestEditSectionOutput = {
          success: true,
          postId: result.documentId,
          operation: 'suggest_edit_section',
          appliedAt: result.appliedAt,
          suggestionsCount:
            result.suggestionIds?.length ??
            (result.changesSummary.insertions + result.changesSummary.deletions > 0 ? 1 : 0),
          suggestionIds: result.suggestionIds ?? [],
          changesSummary: {
            insertions: result.changesSummary.insertions,
            deletions: result.changesSummary.deletions,
            hunksApplied:
              result.changesSummary.hunksApplied ??
              result.changesSummary.insertions + result.changesSummary.deletions,
          },
          message: `Suggestions successfully created for section "${args.targetHeading}" in post ${result.documentId}.`,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        };
      } catch (err: any) {
        logger.error(
          { err, postId: args.postId, target: args.targetHeading },
          'suggest_edit_section failed'
        );
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error suggesting edit for section "${args.targetHeading}" in post "${args.postId}": [${err.code || 'ERROR'}] ${err.message}`,
            },
          ],
        };
      }
    }
  );
}
