import {
  McpPublishPostInputSchema,
  type McpPublishPostInput,
  type McpPublishPostOutput,
} from '@glyphroom/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hasScope, type ApiClient } from '../api/client.js';
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
    'Publishes the exact current submitted checkpoint only after independent approval. This tool never submits a draft or bypasses review.',
    McpPublishPostInputSchema.shape,
    async (args: McpPublishPostInput) => {
      logger.info({ postId: args.postId }, 'Executing publish_post');

      // Security check: prompt injection & privilege escalation guardrail (Task 3.6)
      const allowedScopes = options.agentScopes || ['posts:draft', 'posts:suggest'];
      if (!hasScope(allowedScopes, 'posts:publish') && !allowedScopes.includes('admin')) {
        logger.warn(
          { postId: args.postId, scopes: allowedScopes },
          'Security violation: Agent attempted unauthorized post publication without posts:publish scope'
        );
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Security policy violation: Caller Personal Access Token lacks "posts:publish" scope. Publication never submits a draft or bypasses approved-checkpoint review.',
            },
          ],
        };
      }

      try {
        const receipt = await apiClient.publishPost(args.postId, args.notes);

        const output: McpPublishPostOutput = {
          success: true,
          postId: receipt.post.id,
          status: receipt.post.status,
          message: 'The independently approved current submitted checkpoint was published.',
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
              text: `Error publishing approved checkpoint for post "${args.postId}": ${err.message}`,
            },
          ],
        };
      }
    }
  );
}
