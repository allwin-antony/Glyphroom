import {
  McpAddCommentInputSchema,
  type McpAddCommentInput,
  type McpAddCommentOutput,
} from '@enterprise-blogger/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api/client.js';
import type pino from 'pino';

export function registerAddCommentTool(
  server: McpServer,
  apiClient: ApiClient,
  logger: pino.Logger
): void {
  (server as any).tool(
    'add_comment',
    'Adds a review comment or anchored question to a specific post.',
    McpAddCommentInputSchema.shape,
    async (args: McpAddCommentInput) => {
      logger.info({ postId: args.postId }, 'Executing add_comment');

      try {
        const result = await apiClient.addComment(args.postId, {
          content: args.content,
          parentId: args.parentId,
        });

        const output: McpAddCommentOutput = {
          commentId: result.comment.id,
          postId: args.postId,
          authorId: result.comment.authorId,
          createdAt: result.comment.createdAt || new Date().toISOString(),
          status: 'open',
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        };
      } catch (err: any) {
        logger.error({ err, postId: args.postId }, 'add_comment failed');
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error adding comment to post "${args.postId}": ${err.message}`,
            },
          ],
        };
      }
    }
  );
}
