import {
  McpPublishPostInputSchema,
  type McpPublishPostInput,
  type McpPublishPostOutput,
} from '@enterprise-blogger/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiClient } from '../api/client.js';
import type pino from 'pino';

export interface PublishPostToolOptions {
  agentScopes?: string[];
}

export function registerPublishPostTool(
  server: McpServer,
  apiClient: ApiClient,
  logger: pino.Logger,
  options: PublishPostToolOptions = {}
): void {
  (server as any).tool(
    'publish_post',
    'Publishes a post or submits it to the editorial review pipeline. Enforces strict enterprise governance: agents with draft-only scopes cannot publish.',
    McpPublishPostInputSchema.shape,
    async (args: McpPublishPostInput) => {
      logger.info({ postId: args.postId }, 'Executing publish_post');

      // Security check: prompt injection & privilege escalation guardrail (Task 3.6)
      const allowedScopes = options.agentScopes || ['posts:draft', 'posts:suggest'];
      if (!allowedScopes.includes('posts:publish') && !allowedScopes.includes('admin')) {
        logger.warn(
          { postId: args.postId, scopes: allowedScopes },
          'Security violation: Agent attempted unauthorized post publication without posts:publish scope'
        );
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Security policy violation: Agent Personal Access Token lacks "posts:publish" scope. Agents are restricted to draft-only editing and suggestions mode.`,
            },
          ],
        };
      }

      try {
        const result = await apiClient.publishPost(args.postId);

        const output: McpPublishPostOutput = {
          success: true,
          postId: args.postId,
          status: 'published',
          message: 'Post successfully published according to governance workflow.',
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        };
      } catch (err: any) {
        logger.error({ err, postId: args.postId }, 'publish_post failed');
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error publishing post "${args.postId}": ${err.message}`,
            },
          ],
        };
      }
    }
  );
}
