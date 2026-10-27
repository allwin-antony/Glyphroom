# Slack Notifier Plugin for Glyphroom

A durable reference backend plugin for Glyphroom that listens to `post:published` domain events and sends formatted notifications to Slack incoming webhooks.

## Capabilities

- `api:events`: Subscribes to `post:published` domain event dispatched by the durable outbox worker.
- `api:routes`: Exposes `/api/v1/plugins/slack-notifier/health` and `/api/v1/plugins/slack-notifier/settings`.
- `api:storage`: Persists webhook URL and enabled state in scoped key-value JSONB storage.

## Security & Reliability Invariants

1. **At-Least-Once Delivery**: Events are dispatched transactionally through the core `plugin_event_outbox`.
2. **Failure Isolation**: A 500/503 from Slack or network timeout triggers exponential backoff retry in the outbox worker and never aborts article publication.
3. **No Secret Leaks**: Webhook URLs are masked when retrieved over administrative API routes.
4. **Content Protection**: Only title, author, space, and reader URL are sent. Draft body and Yjs state are never sent to external webhooks.

## Configuration

Settings can be managed via API:
- `POST /api/v1/plugins/slack-notifier/settings`
```json
{
  "enabled": true,
  "webhookUrl": "https://hooks.slack.com/services/...",
  "channelName": "#engineering-blog"
}
```
Or set via environment variable:
- `SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."`
