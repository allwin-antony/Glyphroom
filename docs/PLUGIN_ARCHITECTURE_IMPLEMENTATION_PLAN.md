# Glyphroom Plugin Architecture — Implementation Plan

> **Status:** Ready for implementation review  
> **Scope:** Build-time web extensions, explicitly registered backend plugins, durable domain events, scoped plugin storage, and MCP tool contributions  
> **Primary goal:** Add extension points without allowing plugins to alter core CRDT, permission, review, or publication invariants

## 1. Decision Summary

The proposed plugin direction is useful, but the first implementation should be narrower than the original design.

### Approved for v1

- Plugins are TypeScript packages in `plugins/` or workspace packages.
- Web plugins are registered at build time and bundled by Vite.
- Backend plugins are explicitly imported and registered at API boot.
- Plugin manifests are validated before registration.
- Backend routes are namespaced under `/api/v1/plugins/:pluginId`.
- Plugins receive typed domain events after core transactions succeed.
- External side effects use a durable outbox, not an in-memory event handler alone.
- Plugin state uses a shared `plugin_storage` table with plugin/scope/key isolation.
- MCP tools are explicitly registered and namespaced by plugin ID.
- Plugin failures are isolated, logged, and do not fail core post or review operations.

### Deferred from v1

- Dynamic npm or filesystem loading at runtime.
- Browser loading of remote JavaScript modules.
- Plugin database migrations.
- Plugin code inside the Collab service.
- Plugins modifying core ProseMirror/Yjs invariants.
- Arbitrary replacement of core storage or attachment behavior.
- Per-Space plugin activation before global activation and health reporting are stable.

## 2. Why This Version Is Safer

The original plan combines several different extension problems: UI composition, API routes, asynchronous integrations, editor schema changes, MCP tools, storage drivers, and collaboration mutations. They should not all have the same trust boundary.

Use four explicit classes:

| Class | Runs in | Registration | Initial examples |
|---|---|---|---|
| UI plugin | Browser bundle | Build-time | Sidebar item, reader action, toolbar widget |
| API plugin | API process | Explicit boot registry | Plugin settings route, read-only integration route |
| Event consumer | API worker/process | Explicit boot registry | Slack webhook, Teams notification |
| MCP contribution | MCP process | Explicit boot registry | `compliance.audit` |

The core owns document storage, permissions, review state, publication, and routing. Plugins observe or extend these capabilities through contracts; they do not bypass them.

## 3. Fixed Repository Layout

Create this structure:

```text
plugins/
  README.md
  slack-notifier/
    package.json
    src/index.ts
    src/plugin.ts
  jira-embed/
    package.json
    src/index.ts
    src/extension.ts
    src/slash-command.ts

packages/shared/src/plugins/
  manifest.ts
  events.ts
  slots.ts
  editor.ts
  storage.ts
  index.ts

apps/api/src/plugins/
  types.ts
  registry.ts
  event-bus.ts
  outbox.ts
  storage.ts
  index.ts

apps/web/src/plugins/
  types.ts
  registry.ts
  PluginProvider.tsx
  usePluginSlots.ts
  index.ts

apps/web/src/components/plugins/
  SlotRenderer.tsx

apps/mcp-server/src/plugins/
  types.ts
  registry.ts
  index.ts
```

Do not create a generic `plugins.config.ts` that uses arbitrary runtime paths in the first version. Use explicit imports in registry files so typechecking and bundling are deterministic.

## 4. Shared Contracts

### 4.1 Manifest

Create `packages/shared/src/plugins/manifest.ts`.

Use this exact initial shape:

```ts
import { z } from 'zod';

export const PluginCapabilitySchema = z.enum([
  'ui:slots',
  'ui:editor',
  'api:routes',
  'api:events',
  'api:storage',
  'mcp:tools',
]);

export const PluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().max(500).optional(),
  author: z.string().max(200).optional(),
  capabilities: z.array(PluginCapabilitySchema).default([]),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type PluginCapability = z.infer<typeof PluginCapabilitySchema>;
```

Rules:

- Duplicate IDs fail API/web startup or build.
- Manifest capability must match the contribution actually supplied.
- Plugin IDs are never taken from a request path without validation.
- No `z.record(z.any())` settings schema in the shared manifest. Plugin settings are validated by each plugin’s backend contract.

### 4.2 Domain events

Create `packages/shared/src/plugins/events.ts`.

Use immutable event envelopes:

```ts
export interface PluginEventMap {
  'post:created': {
    postId: string;
    authorId: string;
    spaceId: string | null;
    title: string;
  };
  'post:submitted_for_review': {
    postId: string;
    authorId: string;
    versionId: string;
  };
  'post:reviewed': {
    postId: string;
    reviewerId: string;
    decision: 'approved' | 'changes_requested';
    submittedVersionId: string;
    notes: string | null;
  };
  'post:published': {
    postId: string;
    publishedVersionId: string;
    authorId: string;
    spaceId: string | null;
    title: string;
  };
  'space:created': {
    spaceId: string;
    name: string;
    ownerId: string;
  };
  'space:archived': { spaceId: string };
  'comment:created': {
    commentId: string;
    postId: string;
    authorId: string;
  };
}

export interface PluginEventEnvelope<K extends keyof PluginEventMap> {
  id: string;
  type: K;
  occurredAt: string;
  payload: PluginEventMap[K];
}
```

Do not include full comment content, draft body content, Yjs state, PAT secrets, or credentials in event payloads.

### 4.3 UI slots

Create `packages/shared/src/plugins/slots.ts` with the approved slot identifiers from the proposal, but keep the first implementation to:

```ts
export type UiSlotIdentifier =
  | 'topbar:actions'
  | 'sidebar:navigation'
  | 'editor:toolbar:actions'
  | 'editor:drawer:tabs'
  | 'editor:slash:commands'
  | 'reader:header:actions'
  | 'reader:content:banner'
  | 'admin:console:tabs';
```

Add a stable numeric `order` and plugin ID to each registration. Core UI renders plugin entries after core controls unless a slot explicitly documents another order.

## 5. Backend Plugin Registry

### 5.1 Types

Create `apps/api/src/plugins/types.ts`:

```ts
export interface GlyphroomBackendPlugin {
  manifest: PluginManifest;
  registerRoutes?: (context: BackendPluginContext) => Promise<void> | void;
  registerEvents?: (bus: PluginEventBus) => void;
  onStartup?: (context: BackendPluginContext) => Promise<void>;
  onShutdown?: () => Promise<void>;
}

export interface BackendPluginContext {
  db: Database;
  pluginId: string;
  storage: PluginStorage;
  logger: FastifyBaseLogger;
  apiBasePath: string;
}
```

Do not pass the raw Fastify instance, raw database pool, session secrets, or unrestricted filesystem access to plugins.

### 5.2 Explicit registry

Create `apps/api/src/plugins/registry.ts`:

- Export `getBackendPlugins()` with explicit imports.
- Validate every manifest with `PluginManifestSchema.parse`.
- Reject duplicate IDs.
- Reject a plugin whose declared capability is absent from its implementation.
- Register only plugins listed in `ENABLED_PLUGINS`, defaulting to no optional plugins in production.
- Always register core infrastructure, but never allow a plugin to replace core routes.

Initial registry:

```ts
import { slackNotifierPlugin } from '../../../plugins/slack-notifier/src/plugin.js';

const available = [slackNotifierPlugin];
```

The Jira web plugin is registered separately in the web registry because it has no backend requirement in v1.

### 5.3 Route namespace

Every plugin route must be registered under:

```text
/api/v1/plugins/:pluginId/...
```

The registry supplies the fixed `pluginId`; plugins must not choose arbitrary prefixes. Plugin routes must use the core auth and permission helpers supplied in the context. Plugin routes cannot register `/auth`, `/posts`, `/spaces`, `/admin`, or `/internal` paths.

## 6. Durable Event Delivery

An in-memory event bus alone is insufficient for Slack, Teams, PagerDuty, or compliance workflows because process crashes can lose events.

### 6.1 Outbox table

Add a core-owned `plugin_event_outbox` table:

```text
id              uuid primary key
event_type      varchar(100) not null
payload         jsonb not null
status          pending | processing | delivered | failed
attempts        integer not null default 0
available_at    timestamptz not null default now()
last_error      text nullable
created_at      timestamptz not null default now()
processed_at    timestamptz nullable
```

This table is different from `plugin_storage`: it is core infrastructure, not arbitrary plugin data.

### 6.2 Transaction rule

For every core mutation that emits an event:

1. Complete the core state change and insert the outbox row in the same database transaction.
2. Return the core API response without waiting for plugin network calls.
3. A worker or scheduled process claims pending rows.
4. The worker dispatches the event to registered plugin handlers.
5. Successful handlers mark delivery complete.
6. Failed handlers retry with bounded exponential backoff.
7. After the retry limit, mark the row failed and expose it in admin diagnostics.

The in-process `PluginEventBus` remains the typed dispatch layer, but it is fed by the outbox worker for durable events.

### 6.3 Event emission locations

Add event creation only after the core operation has all required IDs:

- `posts.ts`: create, submit-review, publish, republish.
- `reviews.ts`: approved or changes requested, including submitted version ID.
- `spaces.ts`: create and archive.
- `comments.ts`: comment creation.

Do not emit events from UI code or from database triggers.

## 7. Scoped Plugin Storage

Add `plugin_storage` to the Drizzle schema, production initialization SQL, auto-migration, and in-memory test database.

Required constraints:

- Unique `(plugin_id, scope, key)`.
- Maximum key length 200.
- Maximum serialized value size enforced by the service, initially 256 KB.
- Scope must match `global`, `space:<uuid>`, or `post:<uuid>`.
- Plugin service methods automatically inject the calling plugin ID.
- A plugin cannot query another plugin’s rows.

Required service methods:

```ts
get<T>(scope: string, key: string): Promise<T | null>;
set<T>(scope: string, key: string, value: T): Promise<void>;
delete(scope: string, key: string): Promise<void>;
list(scope: string): Promise<Array<{ key: string; value: unknown }>>;
```

Do not add `plugin_metadata` columns to `posts` or `spaces` in v1. Use scoped storage for plugin-owned state. Add first-class metadata only when a plugin needs indexed, permission-aware core queries.

## 8. Web Plugin Host

### 8.1 Build-time registry

Create `apps/web/src/plugins/registry.ts` with explicit imports and a `getWebPlugins()` function.

Create `PluginProvider` and mount it once under the authenticated application shell. The provider receives static registrations, not backend-delivered executable code.

Web plugin interface:

```ts
export interface GlyphroomWebPlugin {
  manifest: PluginManifest;
  slots?: UiSlotRegistration[];
  editorExtensions?: AnyExtension[];
  slashCommands?: PluginSlashCommand[];
}
```

### 8.2 Slot renderer

Implement `SlotRenderer` with these rules:

- No DOM output when no extensions are registered.
- Stable ordering by `order`, then plugin ID.
- Catch rendering errors with an error boundary per plugin contribution.
- Pass only documented context fields.
- Do not allow plugin components to access auth internals or raw Yjs documents unless the slot contract explicitly provides a safe editor API.

### 8.3 Editor integration

Do not replace the existing core editor extensions. Add optional extensions after the core list:

```ts
extensions: [
  ...CORE_EDITOR_EXTENSIONS,
  ...(pluginRegistry.editorExtensions ?? []),
]
```

Slash commands must be declarative:

```ts
export interface PluginSlashCommand {
  id: string;
  label: string;
  description: string;
  keywords?: string[];
  order?: number;
  execute: (editor: Editor) => boolean;
}
```

Reject duplicate command IDs and prevent plugin commands from overriding core command IDs.

## 9. MCP Plugin Contributions

Create an explicit MCP registry. Do not dynamically mutate the server from arbitrary HTTP requests.

```ts
export interface McpToolContribution {
  pluginId: string;
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  requiredScopes: string[];
  handler: (args: unknown, context: McpToolContext) => Promise<CallToolResult>;
}
```

Rules:

- Public tool name is `${pluginId}.${name}`.
- Plugin tools must declare required PAT scopes.
- The MCP server passes the authenticated owner identity and effective scopes to the handler.
- Plugin tools cannot call the database directly; use API clients or approved plugin services.
- Plugin tool failures return a structured MCP error and do not stop core tools from loading.
- Duplicate fully qualified names fail startup.

## 10. Reference Plugins

### 10.1 Slack notifier — implement first

Implement `plugins/slack-notifier` as the first backend plugin.

Behavior:

- Listens to `post:published`.
- Reads webhook URL and enabled state from plugin storage/environment-backed settings.
- Sends title, author, Space, and reader URL.
- Uses a timeout of 5 seconds.
- Never includes draft body content or secrets in logs.
- Retries through the outbox worker.
- Exposes a health/status route to admins.

Tests:

- Receives a published event.
- Sends the expected payload to a mocked webhook.
- Retries a failed webhook.
- Does not fail publication when Slack is unavailable.
- Does not send drafts or review submissions.

### 10.2 Jira embed — implement second

Start with a local/static embed block, not live Jira API access.

- Add a `jiraIssue` TipTap node with `issueKey`, `summary`, `status`, and `url` attributes.
- Add `/jira` slash command that opens a small input/action flow.
- Render a safe card without fetching external content.
- Keep the node schema in the plugin package.
- Add Markdown export behavior that emits a normal link and summary.
- Add round-trip, collaboration, export, and editor rendering tests.

Defer Jira API authentication, remote previews, and live refresh until the plugin lifecycle and settings model are proven.

## 11. Admin Operations

Add an Admin Console plugin section only after backend registration works.

Display:

- Installed plugin ID, name, version, capabilities.
- Enabled/disabled state.
- Startup status.
- Last error.
- Failed outbox event count.
- Plugin health endpoint status.

Admin actions:

- Enable/disable an installed plugin.
- Retry failed outbox events.
- View plugin logs/events at a high level.

The admin UI must not expose secrets such as webhook URLs or PAT values. Settings forms should write through plugin-specific routes with validation.

## 12. Implementation Phases

### Phase 0 — Contracts and constraints

Files:

- `packages/shared/src/plugins/manifest.ts`
- `packages/shared/src/plugins/events.ts`
- `packages/shared/src/plugins/slots.ts`
- `packages/shared/src/plugins/editor.ts`
- `packages/shared/src/plugins/index.ts`

Tasks:

1. Add schemas and types.
2. Export them from the shared package.
3. Add manifest, event payload, slot, and command validation tests.
4. Document the no-runtime-loading rule.

Exit criteria:

- Shared typecheck passes.
- Plugin contract tests pass.
- Invalid IDs, duplicate capabilities, and malformed versions are rejected.

### Phase 1 — Backend registry and storage

Files:

- `apps/api/src/plugins/*`
- `apps/api/src/db/schema.ts`
- `apps/api/src/db/auto-migrate.ts`
- `docker/postgres/init.sql`
- `apps/api/src/app.ts`

Tasks:

1. Add `plugin_storage`.
2. Add `PluginStorage` service.
3. Add explicit backend registry.
4. Validate and boot enabled plugins.
5. Add namespaced plugin route registration.
6. Add plugin lifecycle logging.

Exit criteria:

- A test plugin boots and registers one route.
- Unknown or duplicate plugin IDs fail clearly.
- Plugin storage cannot cross-read another plugin’s values.
- Existing API tests still pass.

### Phase 2 — Durable events and outbox

Tasks:

1. Add the outbox table and service.
2. Add transaction helpers for state change plus outbox insert.
3. Add the event dispatcher worker with retry/backoff.
4. Emit the approved core events.
5. Add failed-event admin diagnostics.

Exit criteria:

- A plugin failure cannot roll back publication.
- A process restart leaves pending events available for retry.
- Duplicate delivery is handled by an event ID or plugin idempotency key.
- Existing review/publication tests remain green.

### Phase 3 — Web host and slots

Tasks:

1. Add `PluginProvider` and static web registry.
2. Add `SlotRenderer` and per-plugin error boundaries.
3. Mount slots in TopBar, Sidebar, Editor, Reader, and AdminView.
4. Add plugin editor extensions after core extensions.
5. Merge plugin slash commands without overriding core commands.

Exit criteria:

- No plugin produces DOM output when disabled.
- A failing plugin component does not break the shell.
- Core editor and slash commands behave exactly as before.
- Web tests cover empty slots and registered slots.

### Phase 4 — MCP registry

Tasks:

1. Add explicit MCP contribution registry.
2. Namespace tool names.
3. Enforce declared scopes.
4. Add plugin tool error isolation.
5. Add tool-listing and invocation tests.

Exit criteria:

- Core tools are unchanged.
- Plugin tools appear only when enabled.
- A plugin tool cannot be invoked without its required scope.

### Phase 5 — Reference plugins

1. Implement Slack notifier.
2. Implement static Jira embed.
3. Add plugin-specific tests and manual verification.
4. Add plugin package READMEs with configuration examples.

### Phase 6 — Admin operations

1. Add plugin inventory to AdminView.
2. Add enable/disable state.
3. Add outbox retry UI.
4. Add plugin health/status UI.
5. Add audit events for enable, disable, and retry actions.

## 13. Required Test Matrix

### Shared

- Manifest validation.
- Event payload typing/validation.
- Slot and slash-command duplicate detection.

### API

- Registry boot and duplicate ID rejection.
- Route namespace enforcement.
- Plugin storage isolation, size limits, and scopes.
- Outbox transaction behavior.
- Retry and failure isolation.
- Plugin enable/disable behavior.

### Web

- Empty slot renders no output.
- Registered slot renders in deterministic order.
- Plugin error boundary preserves the shell.
- Additional editor extensions are appended after core extensions.
- Plugin slash commands are available and cannot override core commands.

### MCP

- Namespaced tool listing.
- Scope rejection.
- Handler failure isolation.
- Core tool regression tests.

### Reference plugins

- Slack payload, timeout, retry, and idempotency.
- Jira node creation, Yjs round trip, Markdown export, and UI rendering.

### Full suite

```bash
pnpm typecheck
pnpm test:shared
pnpm test:api
pnpm test:web
pnpm test:mcp
pnpm test:collab
pnpm test:tests
pnpm test:all
```

Do not modify existing core tests to accommodate plugins. Add new tests and preserve all core invariants.

## 14. Agent Execution Instructions

An implementation agent should execute the phases in order and should not skip ahead to reference plugins.

For every phase:

1. Read the current files and existing test patterns.
2. Implement only that phase.
3. Add focused tests before moving to the next phase.
4. Run the phase exit checks.
5. Report files changed, tests run, and any explicit blocker.

The agent must not:

- Introduce runtime remote JavaScript loading.
- Allow plugin code to write directly to Yjs/Postgres core tables.
- Add arbitrary plugin migrations.
- Allow plugin routes to replace core routes.
- Allow plugin event failures to fail core publication or review transactions.
- Add plugin code to the Collab service in this first implementation.
- Weaken existing tests or change core invariants to make plugin tests pass.

## 15. Final Acceptance Criteria

The plugin foundation is complete when:

- A statically registered backend plugin can boot, store scoped state, register a namespaced route, and consume a durable domain event.
- A statically registered web plugin can render a slot contribution and add a safe slash command without changing core behavior.
- A namespaced MCP plugin tool is listed and scope-checked.
- Slack notification failure does not affect publication and is retryable.
- Jira static content round-trips through the editor and Markdown export.
- Admins can see plugin status and retry failed events.
- All existing tests remain passing.
