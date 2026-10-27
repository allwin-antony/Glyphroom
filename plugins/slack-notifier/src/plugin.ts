import type {
  PluginManifest,
  PluginEventEnvelope,
} from '@enterprise-blogger/shared';

export interface SlackNotifierSettings {
  enabled: boolean;
  webhookUrl?: string;
  channelName?: string;
}

export const slackNotifierManifest: PluginManifest = {
  id: 'slack-notifier',
  name: 'Slack Notifier',
  version: '1.0.0',
  description:
    'Durable domain event notifier dispatching published articles to corporate Slack channels.',
  author: 'Enterprise Blogger Engineering',
  capabilities: ['api:events', 'api:routes', 'api:storage'],
};

export class SlackNotifierPlugin {
  readonly manifest = slackNotifierManifest;
  private storage: any = null;

  async onStartup(context: any): Promise<void> {
    this.storage = context.storage;
    const existing = await context.storage.get('global', 'settings');
    if (!existing) {
      await context.storage.set('global', 'settings', {
        enabled: true,
        webhookUrl: process.env.SLACK_WEBHOOK_URL || '',
        channelName: '#engineering-blog',
      });
    }
  }

  registerEvents(bus: any): void {
    bus.on('post:published', async (event: PluginEventEnvelope<'post:published'>) => {
      await this.handlePostPublished(event);
    });
  }

  async handlePostPublished(event: PluginEventEnvelope<'post:published'>): Promise<void> {
    const settings: SlackNotifierSettings = (await this.storage?.get(
      'global',
      'settings'
    )) || {
      enabled: true,
      webhookUrl: process.env.SLACK_WEBHOOK_URL,
    };

    if (!settings.enabled) {
      return;
    }

    const webhookUrl = settings.webhookUrl || process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      // No webhook configured, skip silently
      return;
    }

    const payload = {
      text: `📢 *New Post Published:* "${event.payload.title}"`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '📢 Post Published to Glyphroom',
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Title:* ${event.payload.title}\n*Author ID:* \`${event.payload.authorId}\`\n*Space:* ${event.payload.spaceId || 'Company Library'}`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Published at ${event.occurredAt} • Event ID: \`${event.id}\``,
            },
          ],
        },
      ],
    };

    // 5-second timeout via AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Slack webhook call failed with HTTP status ${response.status} ${response.statusText}`
        );
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async registerRoutes(fastify: any, context: any): Promise<void> {
    // Health check endpoint
    fastify.get('/health', async () => {
      const settings = (await context.storage.get('global', 'settings')) || {};
      return {
        status: 'healthy',
        plugin: 'slack-notifier',
        enabled: Boolean(settings.enabled),
        hasWebhook: Boolean(settings.webhookUrl || process.env.SLACK_WEBHOOK_URL),
      };
    });

    // Masked settings endpoint
    fastify.get('/settings', async () => {
      const settings = (await context.storage.get('global', 'settings')) || {};
      const url = settings.webhookUrl || process.env.SLACK_WEBHOOK_URL || '';
      const maskedUrl = url.length > 10 ? `${url.slice(0, 15)}...****` : '';
      return {
        enabled: Boolean(settings.enabled),
        channelName: settings.channelName || '#engineering-blog',
        webhookUrlMasked: maskedUrl,
      };
    });

    // Update settings endpoint
    fastify.post('/settings', async (request: any, reply: any) => {
      const body = request.body || {};
      const current = (await context.storage.get('global', 'settings')) || {};
      const updated: SlackNotifierSettings = {
        enabled: body.enabled !== undefined ? Boolean(body.enabled) : current.enabled,
        webhookUrl: body.webhookUrl || current.webhookUrl,
        channelName: body.channelName || current.channelName,
      };
      await context.storage.set('global', 'settings', updated);
      return reply.send({ success: true, settings: updated });
    });
  }
}

export const slackNotifierPlugin = new SlackNotifierPlugin();
