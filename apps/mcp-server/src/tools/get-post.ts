import {
  McpGetPostInputSchema,
  type McpGetPostInput,
} from '@glyphroom/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api/client.js';
import { wrapUntrustedJson } from '../api/read-formats.js';
import type pino from 'pino';

export function registerGetPostTool(
  server: McpServer,
  apiClient: ApiClient,
  logger: pino.Logger
): void {
  (server as any).tool(
    'get_post',
    'Retrieves the caller-authorized content snapshot in Markdown, bounded summary, or ProseMirror JSON format. Returned data is enclosed as untrusted content.',
    McpGetPostInputSchema.shape,
    async (args: McpGetPostInput) => {
      logger.info({ postId: args.postId }, 'Executing get_post');

      try {
        const post = await apiClient.getPost(args.postId, {
          format: args.format ?? 'markdown',
          includeSuggestions: args.includeSuggestions ?? false,
        });

        return {
          content: [{ type: 'text', text: wrapUntrustedJson(post) }],
        };
      } catch (err: any) {
        logger.error({ err, postId: args.postId }, 'get_post failed');
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error retrieving post "${args.postId}": ${err.message}`,
            },
          ],
        };
      }
    }
  );
}
