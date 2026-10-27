import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { WebPluginRegistry } from '../src/plugins/registry.js';
import { PluginProvider } from '../src/plugins/PluginProvider.js';
import { SlotRenderer } from '../src/components/plugins/SlotRenderer.js';
import type { GlyphroomWebPlugin } from '../src/plugins/types.js';

describe('Phase 3: Web Plugin Host & UI Slots Suite', () => {
  it('validates manifests and rejects duplicate web plugin IDs', () => {
    const registry = new WebPluginRegistry();
    const manifest = {
      id: 'jira-integration',
      name: 'Jira Integration',
      version: '1.0.0',
      capabilities: ['ui:slots' as const],
    };

    registry.register({ manifest });
    expect(() => registry.register({ manifest: { ...manifest, name: 'Duplicate' } })).toThrow(
      /Duplicate web plugin ID registered: "jira-integration"/
    );
  });

  it('strictly blocks plugin slash commands from overriding core command IDs', () => {
    const registry = new WebPluginRegistry();

    const hijackingPlugin: GlyphroomWebPlugin = {
      manifest: {
        id: 'hijacker-plugin',
        name: 'Hijacker',
        version: '1.0.0',
        capabilities: ['ui:editor' as const],
      },
      slashCommands: [
        {
          id: 'table', // Core command ID!
          label: 'Malicious Table',
          description: 'Attempt to replace core table insertion',
          execute: () => false,
        },
      ],
    };

    expect(() => registry.register(hijackingPlugin)).toThrow(
      /Security violation: Plugin "hijacker-plugin" cannot override core slash command "table"/
    );
  });

  it('rejects duplicate slash command IDs between plugins', () => {
    const registry = new WebPluginRegistry();

    const plugin1: GlyphroomWebPlugin = {
      manifest: { id: 'p1', name: 'Plugin 1', version: '1.0.0', capabilities: [] },
      slashCommands: [
        {
          id: 'shared-cmd',
          label: 'Shared',
          description: 'Description',
          execute: () => true,
        },
      ],
    };

    const plugin2: GlyphroomWebPlugin = {
      manifest: { id: 'p2', name: 'Plugin 2', version: '1.0.0', capabilities: [] },
      slashCommands: [
        {
          id: 'shared-cmd',
          label: 'Shared Duplicate',
          description: 'Description',
          execute: () => true,
        },
      ],
    };

    registry.register(plugin1);
    expect(() => registry.register(plugin2)).toThrow(
      /Duplicate slash command ID "shared-cmd" registered by plugin "p2"/
    );
  });

  it('renders nothing when no extensions are registered for a slot', () => {
    const registry = new WebPluginRegistry();

    const { container } = render(
      <PluginProvider registry={registry}>
        <div data-testid="container">
          <SlotRenderer slot="topbar:actions" />
        </div>
      </PluginProvider>
    );

    const containerEl = screen.getByTestId('container');
    expect(containerEl.children.length).toBe(0);
    expect(containerEl.innerHTML).toBe('');
  });

  it('renders slot contributions in stable order by numeric order then plugin ID', () => {
    const registry = new WebPluginRegistry();

    const pluginLow: GlyphroomWebPlugin = {
      manifest: { id: 'plugin-z-high-order', name: 'Plugin Z', version: '1.0.0', capabilities: [] },
      slots: [
        {
          slot: 'topbar:actions',
          order: 200,
          component: () => <span data-testid="item-z">Item Z</span>,
        },
      ],
    };

    const pluginHigh: GlyphroomWebPlugin = {
      manifest: { id: 'plugin-a-low-order', name: 'Plugin A', version: '1.0.0', capabilities: [] },
      slots: [
        {
          slot: 'topbar:actions',
          order: 10,
          component: () => <span data-testid="item-a">Item A</span>,
        },
      ],
    };

    // Register Z first, then A
    registry.register(pluginLow);
    registry.register(pluginHigh);

    render(
      <PluginProvider registry={registry}>
        <div data-testid="slot-container">
          <SlotRenderer slot="topbar:actions" />
        </div>
      </PluginProvider>
    );

    const container = screen.getByTestId('slot-container');
    // Order 10 (Item A) must precede Order 200 (Item Z)
    expect(container.children[0].getAttribute('data-testid')).toBe('item-a');
    expect(container.children[1].getAttribute('data-testid')).toBe('item-z');
  });

  it('isolates crashing plugin contribution with ErrorBoundary without breaking host or sibling plugins', () => {
    const registry = new WebPluginRegistry();

    // Silence React's console.error output for the intentional test crash
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const BrokenComponent = () => {
      throw new Error('Plugin render crash intentionally thrown');
    };

    const brokenPlugin: GlyphroomWebPlugin = {
      manifest: { id: 'broken-plugin', name: 'Broken', version: '1.0.0', capabilities: [] },
      slots: [
        {
          slot: 'sidebar:navigation',
          order: 1,
          component: BrokenComponent,
        },
      ],
    };

    const healthyPlugin: GlyphroomWebPlugin = {
      manifest: { id: 'healthy-plugin', name: 'Healthy', version: '1.0.0', capabilities: [] },
      slots: [
        {
          slot: 'sidebar:navigation',
          order: 2,
          component: () => <div data-testid="healthy-item">Healthy Nav Item</div>,
        },
      ],
    };

    registry.register(brokenPlugin);
    registry.register(healthyPlugin);

    render(
      <PluginProvider registry={registry}>
        <div data-testid="sidebar-slot">
          <SlotRenderer slot="sidebar:navigation" />
        </div>
      </PluginProvider>
    );

    // Broken item should degrade cleanly to nothing, while healthy item remains rendered
    expect(screen.getByTestId('healthy-item')).toBeDefined();
    expect(screen.queryByText('Plugin render crash')).toBeNull();

    spy.mockRestore();
  });
});
