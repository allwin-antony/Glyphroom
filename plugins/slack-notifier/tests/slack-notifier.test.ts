import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlackNotifierPlugin } from '../src/plugin.js';
import type { PluginEventEnvelope } from '@enterprise-blogger/shared';

describe('Slack Notifier Reference Backend Plugin', () => {
  let plugin: SlackNotifierPlugin;
  let mockStorage: Map<string, any>;
  let mockStorageContext: any;

  beforeEach(() => {
    plugin = new SlackNotifierPlugin();
    mockStorage = new Map();
    mockStorageContext = {
      storage: {
        get: vi.fn(async (_scope: string, key: string) => mockStorage.get(key) || null),
        set: vi.fn(async (_scope: string, key: string, value: any) => {
          mockStorage.set(key, value);
        }),
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes default settings on startup', async () => {
    await plugin.onStartup(mockStorageContext);
    expect(mockStorageContext.storage.set).toHaveBeenCalledWith(
      'global',
      'settings',
      expect.objectContaining({ enabled: true })
    );
  });

  it('sends Slack Block Kit message on post:published event', async () => {
    await plugin.onStartup(mockStorageContext);
    mockStorage.set('settings', {
      enabled: true,
      webhookUrl: 'https://hooks.slack.com/services/test-webhook',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    vi.stubGlobal('fetch', mockFetch);

    const event: PluginEventEnvelope<'post:published'> = {
      id: 'evt-123',
      type: 'post:published',
      occurredAt: '2026-10-27T12:00:00Z',
      payload: {
        postId: 'post-abc',
        publishedVersionId: 'ver-1',
        authorId: 'usr-author',
        spaceId: 'spc-eng',
        title: 'Microkernel Architecture In Production',
      },
    };

    await plugin.handlePostPublished(event);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe('https://hooks.slack.com/services/test-webhook');
    expect(calledInit.method).toBe('POST');

    const body = JSON.parse(calledInit.body);
    expect(body.text).toContain('Microkernel Architecture In Production');
    expect(body.blocks[1].text.text).toContain('Microkernel Architecture In Production');
    expect(body.blocks[1].text.text).toContain('spc-eng');
  });

  it('throws an error when Slack webhook returns HTTP 500 so outbox retries', async () => {
    await plugin.onStartup(mockStorageContext);
    mockStorage.set('settings', {
      enabled: true,
      webhookUrl: 'https://hooks.slack.com/services/failing-webhook',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    vi.stubGlobal('fetch', mockFetch);

    const event: PluginEventEnvelope<'post:published'> = {
      id: 'evt-456',
      type: 'post:published',
      occurredAt: '2026-10-27T12:00:00Z',
      payload: {
        postId: 'post-xyz',
        publishedVersionId: 'ver-2',
        authorId: 'usr-1',
        spaceId: null,
        title: 'Failing Delivery Test',
      },
    };

    await expect(plugin.handlePostPublished(event)).rejects.toThrow(
      /Slack webhook call failed with HTTP status 500/
    );
  });

  it('skips webhook invocation cleanly when plugin is disabled in settings', async () => {
    await plugin.onStartup(mockStorageContext);
    mockStorage.set('settings', {
      enabled: false,
      webhookUrl: 'https://hooks.slack.com/services/disabled-webhook',
    });

    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const event: PluginEventEnvelope<'post:published'> = {
      id: 'evt-789',
      type: 'post:published',
      occurredAt: '2026-10-27T12:00:00Z',
      payload: {
        postId: 'post-disabled',
        publishedVersionId: 'ver-3',
        authorId: 'usr-1',
        spaceId: null,
        title: 'Disabled Test',
      },
    };

    await plugin.handlePostPublished(event);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
