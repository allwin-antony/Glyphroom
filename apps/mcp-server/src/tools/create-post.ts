import {
  McpCreatePostInputSchema,
  type McpCreatePostInput,
  type McpCreatePostOutput,
} from '@enterprise-blogger/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api/client.js';
import type pino from 'pino';

export function registerCreatePostTool(
  server: McpServer,
  apiClient: ApiClient,
  logger: pino.Logger
): void {
  (server as any).tool(
    'create_post',
    'Creates a new draft post on behalf of the agent owner. Defaults strictly to draft status.',
    McpCreatePostInputSchema.shape,
    async (args: McpCreatePostInput) => {
      logger.info({ title: args.title }, 'Executing create_post');

      try {
        const slug = args.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)+/g, '') || `agent-draft-${Date.now()}`;

        const created = await apiClient.createPost({
          title: args.title,
          slug,
          excerpt: args.excerpt,
        });

        const output: McpCreatePostOutput = {
          id: created.post.id,
          slug: created.post.slug,
          status: 'draft',
          title: created.post.title,
          createdAt: created.post.createdAt || new Date().toISOString(),
          message: 'Draft post successfully created in isolated draft state.',
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        };
      } catch (err: any) {
        logger.error({ err, title: args.title }, 'create_post failed');
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error creating post: ${err.message}`,
            },
          ],
        };
      }
    }
  );
}
