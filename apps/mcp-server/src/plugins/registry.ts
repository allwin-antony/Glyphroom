import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type pino from 'pino';
import type {
  McpToolContribution,
  McpToolContext,
  GlyphroomMcpPlugin,
} from './types.js';

export class McpPluginRegistry {
  private plugins = new Map<string, GlyphroomMcpPlugin>();
  private registeredToolNames = new Set<string>();

  /**
   * Registers a plugin's MCP contributions with validation.
   */
  register(plugin: GlyphroomMcpPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Duplicate MCP plugin ID registered: "${plugin.id}"`);
    }

    for (const tool of plugin.tools) {
      if (tool.pluginId && tool.pluginId !== plugin.id) {
        throw new Error(
          `Security violation: Tool declared pluginId "${tool.pluginId}" which does not match plugin "${plugin.id}"`
        );
      }
      const fqName = `${plugin.id}.${tool.name}`;
      if (this.registeredToolNames.has(fqName)) {
        throw new Error(
          `Duplicate fully qualified MCP tool name registered: "${fqName}"`
        );
      }
      this.registeredToolNames.add(fqName);
    }

    this.plugins.set(plugin.id, plugin);
  }

  /**
   * Returns list of all registered MCP plugins.
   */
  getPlugins(): GlyphroomMcpPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Mounts all registered plugin tools onto the McpServer instance.
   * Wraps each tool in security checks (PAT scope validation) and structured error handling.
   */
  mount(server: McpServer, context: McpToolContext): void {
    const { logger, agentScopes } = context;

    for (const plugin of this.plugins.values()) {
      for (const tool of plugin.tools) {
        const publicToolName = `${plugin.id}.${tool.name}`;

        (server as any).tool(
          publicToolName,
          `[Plugin: ${plugin.name}] ${tool.description}`,
          tool.inputSchema,
          async (args: any) => {
            logger.info(
              { tool: publicToolName, pluginId: plugin.id },
              `Executing plugin MCP tool "${publicToolName}"`
            );

            // 1. Enforce required PAT scopes
            if (tool.requiredScopes && tool.requiredScopes.length > 0) {
              const missingScopes = tool.requiredScopes.filter(
                (scope) => !agentScopes?.includes(scope)
              );

              if (missingScopes.length > 0) {
                logger.warn(
                  {
                    tool: publicToolName,
                    required: tool.requiredScopes,
                    actual: agentScopes,
                    missing: missingScopes,
                  },
                  `Access denied: missing required PAT scope(s) for "${publicToolName}"`
                );

                return {
                  isError: true,
                  content: [
                    {
                      type: 'text' as const,
                      text: `Forbidden: Personal Access Token lacks required scope(s): ${missingScopes.join(', ')}. Granted scopes: ${agentScopes?.join(', ') || 'none'}.`,
                    },
                  ],
                };
              }
            }

            // 2. Execute handler with isolation
            try {
              return await tool.handler(args, context);
            } catch (err: any) {
              const errorMessage = err?.message || String(err);
              logger.error(
                { tool: publicToolName, err: errorMessage },
                `Plugin tool "${publicToolName}" execution failed`
              );

              return {
                isError: true,
                content: [
                  {
                    type: 'text' as const,
                    text: `Error executing plugin tool ${publicToolName}: ${errorMessage}`,
                  },
                ],
              };
            }
          }
        );

        logger.info(
          { tool: publicToolName },
          `Mounted plugin MCP tool "${publicToolName}"`
        );
      }
    }
  }

  /**
   * Clears all registered tools (useful for tests).
   */
  clear(): void {
    this.plugins.clear();
    this.registeredToolNames.clear();
  }
}

/**
 * Global singleton MCP plugin registry.
 */
export const defaultMcpRegistry = new McpPluginRegistry();
