import {
  McpSearchPostsInputSchema,
  type McpSearchPostsInput,
} from '@enterprise-blogger/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api/client.js';
import type pino from 'pino';

export function registerSearchPostsTool(
  server: McpServer,
  apiClient: ApiClient,
  logger: pino.Logger
): void {
  (server as any).tool(
    'search_posts',
    'Searches internal posts with full-text search and visibility isolation.',
    McpSearchPostsInputSchema.shape,
    async (args: McpSearchPostsInput) => {
      logger.info({ query: args.query }, 'Executing search_posts');

      try {
        const result = await apiClient.searchPosts(args);

        // Security requirement: prompt injection protection
        const sanitized = `<UNTRUSTED_CONTENT>\n${JSON.stringify(result, null, 2)}\n</UNTRUSTED_CONTENT>`;

        return {
          content: [{ type: 'text', text: sanitized }],
        };
      } catch (err: any) {
        logger.error({ err, query: args.query }, 'search_posts failed');
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error searching posts: ${err.message}`,
            },
          ],
        };
      }
    }
  );
}
