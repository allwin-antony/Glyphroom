import {
  McpGetPostInputSchema,
  type McpGetPostInput,
} from '@enterprise-blogger/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api/client.js';
import type pino from 'pino';

export function registerGetPostTool(
  server: McpServer,
  apiClient: ApiClient,
  logger: pino.Logger
): void {
  (server as any).tool(
    'get_post',
    'Retrieves post metadata and working content. All returned content is tagged as untrusted content to guard against prompt injection.',
    McpGetPostInputSchema.shape,
    async (args: McpGetPostInput) => {
      logger.info({ postId: args.postId }, 'Executing get_post');

      try {
        const post = await apiClient.getPost(args.postId);

        // Security requirement: prompt injection protection
        const payload = {
          ...post,
          content: `<UNTRUSTED_CONTENT>\n${post.content}\n</UNTRUSTED_CONTENT>`,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
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
