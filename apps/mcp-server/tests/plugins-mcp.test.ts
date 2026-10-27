import { describe, it, expect, vi } from 'vitest';
import { pino } from 'pino';
import { z } from 'zod';
import { createMcpServer } from '../src/server.js';
import { CollabGatewayClient } from '../src/gateway/client.js';
import { McpPluginRegistry } from '../src/plugins/registry.js';
import type { GlyphroomMcpPlugin } from '../src/plugins/types.js';

describe('Phase 4: MCP Plugin Registry & Namespaced Tools Suite', () => {
  const logger = pino({ level: 'silent' });
  const gatewayClient = new CollabGatewayClient({
    gatewayUrl: 'http://127.0.0.1:4000/internal/agent-gateway/edit',
    gatewaySecret: 'test-secret',
  });

  it('rejects duplicate MCP plugin IDs and duplicate fully qualified tool names', () => {
    const registry = new McpPluginRegistry();

    const samplePlugin: GlyphroomMcpPlugin = {
      id: 'jira-sync',
      name: 'Jira Sync',
      version: '1.0.0',
      tools: [
        {
          pluginId: 'jira-sync',
          name: 'get_issue',
          description: 'Fetches Jira issue',
          inputSchema: { issueKey: z.string() },
          requiredScopes: ['posts:read'],
          handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
        },
      ],
    };

    registry.register(samplePlugin);

    // Duplicate plugin ID
    expect(() => registry.register(samplePlugin)).toThrow(
      /Duplicate MCP plugin ID registered: "jira-sync"/
    );

    // Spoofed tool pluginId
    const spoofingPlugin: GlyphroomMcpPlugin = {
      id: 'other-plugin',
      name: 'Other',
      version: '1.0.0',
      tools: [
        {
          pluginId: 'jira-sync',
          name: 'get_issue',
          description: 'Conflict',
          inputSchema: {},
          requiredScopes: [],
          handler: async () => ({ content: [] }),
        },
      ],
    };

    expect(() => registry.register(spoofingPlugin)).toThrow(
      /Security violation: Tool declared pluginId "jira-sync" which does not match plugin "other-plugin"/
    );

    // Duplicate tool name within a plugin
    const dupPlugin: GlyphroomMcpPlugin = {
      id: 'dup-plugin',
      name: 'Duplicate Tools',
      version: '1.0.0',
      tools: [
        {
          pluginId: 'dup-plugin',
          name: 'same_tool',
          description: 'First',
          inputSchema: {},
          requiredScopes: [],
          handler: async () => ({ content: [] }),
        },
        {
          pluginId: 'dup-plugin',
          name: 'same_tool',
          description: 'Second',
          inputSchema: {},
          requiredScopes: [],
          handler: async () => ({ content: [] }),
        },
      ],
    };

    expect(() => registry.register(dupPlugin)).toThrow(
      /Duplicate fully qualified MCP tool name registered: "dup-plugin.same_tool"/
    );
  });

  it('mounts tools with namespaced name ${pluginId}.${toolName} and executes successfully with valid scopes', async () => {
    const registry = new McpPluginRegistry();

    const testPlugin: GlyphroomMcpPlugin = {
      id: 'github-issues',
      name: 'GitHub Issues',
      version: '1.0.0',
      tools: [
        {
          pluginId: 'github-issues',
          name: 'fetch_issue',
          description: 'Fetches GitHub issue status',
          inputSchema: { issueNumber: z.number() },
          requiredScopes: ['posts:read'],
          handler: async (args: { issueNumber: number }) => ({
            content: [{ type: 'text', text: `Issue #${args.issueNumber} is OPEN` }],
          }),
        },
      ],
    };

    registry.register(testPlugin);

    const server = createMcpServer({
      gatewayClient,
      logger,
      pluginRegistry: registry,
      agentScopes: ['posts:read', 'posts:write'],
    });

    const registeredTools = (server as any)._registeredTools;
    expect(registeredTools['github-issues.fetch_issue']).toBeDefined();

    const tool = registeredTools['github-issues.fetch_issue'];
    const result = await tool.handler({ issueNumber: 42 });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe('Issue #42 is OPEN');
  });

  it('strictly enforces declared requiredScopes against caller effective scopes', async () => {
    const registry = new McpPluginRegistry();

    const privilegedPlugin: GlyphroomMcpPlugin = {
      id: 'sec-scanner',
      name: 'Security Scanner',
      version: '1.0.0',
      tools: [
        {
          pluginId: 'sec-scanner',
          name: 'run_audit',
          description: 'Triggers security compliance audit scan',
          inputSchema: { target: z.string() },
          requiredScopes: ['admin:audit', 'system:write'],
          handler: async () => ({ content: [{ type: 'text', text: 'Scan clean' }] }),
        },
      ],
    };

    registry.register(privilegedPlugin);

    // Mount with insufficient scopes (caller only has 'posts:read')
    const server = createMcpServer({
      gatewayClient,
      logger,
      pluginRegistry: registry,
      agentScopes: ['posts:read'],
    });

    const tool = (server as any)._registeredTools['sec-scanner.run_audit'];
    const result = await tool.handler({ target: 'prod-cluster' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Forbidden: Personal Access Token lacks required scope(s)');
    expect(result.content[0].text).toContain('admin:audit, system:write');
  });

  it('safely catches and structures plugin execution errors without crashing server', async () => {
    const registry = new McpPluginRegistry();

    const failingPlugin: GlyphroomMcpPlugin = {
      id: 'failing-plugin',
      name: 'Failing',
      version: '1.0.0',
      tools: [
        {
          pluginId: 'failing-plugin',
          name: 'crash',
          description: 'Always throws',
          inputSchema: {},
          requiredScopes: [],
          handler: async () => {
            throw new Error('Downstream API connection reset by peer');
          },
        },
      ],
    };

    registry.register(failingPlugin);

    const server = createMcpServer({
      gatewayClient,
      logger,
      pluginRegistry: registry,
    });

    const tool = (server as any)._registeredTools['failing-plugin.crash'];
    const result = await tool.handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error executing plugin tool failing-plugin.crash');
    expect(result.content[0].text).toContain('Downstream API connection reset by peer');
  });
});
