# Glyphroom

> **Self-hosted technical documentation, engineering blogs, and team knowledge base with real-time CRDT co-editing, team-scoped Spaces, microkernel plugin extensions, and Model Context Protocol (MCP) AI co-authoring.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![Verification](https://img.shields.io/badge/Verification-build%20%2B%20typecheck%20passing-brightgreen.svg)](#testing--quality-assurance)
[![CRDT](https://img.shields.io/badge/CRDT-Yjs%20(Canonical%20Binary)-purple.svg)](#key-capabilities)
[![Architecture](https://img.shields.io/badge/Plugins-Microkernel%20Outbox-teal.svg)](#microkernel-plugin-architecture)
[![MCP](https://img.shields.io/badge/AI%20Protocol-Model%20Context%20Protocol-orange.svg)](#model-context-protocol-mcp-integration)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](#monorepo-architecture)

---

> [!NOTE]
> **Glyphroom is an open developer preview.** Current work focuses on reliable authoring, publication workflows, and MCP integration. Local authentication and Personal Access Tokens support evaluation and internal use; enterprise SSO and deeper security hardening are planned for a later phase. See [Current Limits](#current-limits) for verified product gaps.

---

## What is Glyphroom?

Engineering knowledge usually fails in one of two ways:
1. **The Single Monolithic Wiki:** Everyone has access to everything, so teams avoid writing candid incident reviews, unpatched vulnerability post-mortems, or in-flight design proposals.
2. **Scattered Team Silos:** Docs fragment across Notion, Google Docs, Slack threads, and local Markdown files. Nobody can discover canonical architecture decisions or production runbooks.

**Glyphroom bridges this with a structured Spaces & Promotion workflow:**

```text
Team Network (Spaces)                     Company Knowledge Base (Library)
┌─────────────────────────────────┐
│ Space: Payments Infrastructure  │
│  ├── Gateway Architecture       │ ──(Promoted by Maintainer)──► ┌──────────────────────────────┐
│  │   [Private Working Draft]    │                               │ Company Library              │
│  ├── Settlement Runbook         │                               │  • Searchable company-wide   │
│  └── Weekly Status              │                               │  • Pinned approved versions  │
└─────────────────────────────────┘                               │  • Substring & tag discovery │
┌─────────────────────────────────┐                               └──────────────────────────────┘
│ Space: Platform Security        │                                              ▲
│  └── Vulnerability Audit        │ ──(Promoted after review)───────────────────┘
│      [Invited-Only Access]      │
└─────────────────────────────────┘
```

- **Draft privately:** Collaborate with your team inside a team-scoped Space.
- **Publish to your Space:** Release stable milestones visible only to Space members.
- **Promote to Company Library:** When a document is ready for enterprise-wide discovery, a Space Maintainer promotes it to the global catalog. Working edits remain private until the next publication.

---

## Key Capabilities

| Capability | Description |
| :--- | :--- |
| **Real-Time CRDT Co-editing** | [Yjs](https://github.com/yjs/yjs) and [Hocuspocus](https://tiptap.dev/hocuspocus) synchronize working documents, with binary state stored in PostgreSQL `bytea` columns. |
| **Document and Block Views** | Continuous authoring and notebook-style editor cards, including tables, code, alerts, diagrams, formulas, status cards, and attachments. Reader rendering currently supports a smaller Markdown subset. |
| **Editorial Review** | `draft` ➔ `in_review` ➔ `approved` ➔ `published`, with submitted-version references and immutable checkpoint previews. The standard publish route uses the approved checkpoint; direct republishing still needs workflow parity. |
| **Microkernel Plugin Host** | Declarative UI slots, editor extensions, scoped key-value storage, and a durable event outbox. |
| **AI Co-Authoring (MCP)** | Stateless HTTP and local stdio transports. A caller-local PAT identifies each user; text-section edits use tracked `suggestion_insert` / `suggestion_delete` marks. |
| **In-App Notifications** | A polling notification bell surfaces review, publication, and collaboration events. Reply/mention delivery and push streaming remain follow-up work. |
| **Saved Reading (Bookmarks)** | Reader bookmark controls and a personal **Saved Reading** dashboard. |
| **Operational Admin Console** | Self-hosted management UI: search user directories, update roles, toggle active/inactive status, audit/revoke Personal Access Tokens, and monitor plugin health/outbox replays. |
| **Tamper-Evident Audit Chain** | SHA-256 hash-chained cryptographic audit logs for sensitive operations (promotions, membership alterations, PAT revocations, plugin replays). |

---

## Latest Update: Track 1

Commit `f3177f3` introduces live-document workflow integration, followed by MCP startup/configuration changes in `de2cda8`:

- Collaboration endpoints for flushing a live document, restoring content, and tombstoning a room.
- `posts.submitted_version_id` and a unique `(post_id, version_number)` index.
- Transactions around key post/version/review updates, draft reversion, and friendly slug-conflict responses.
- Review queue previews that load the submitted snapshot and identify later working changes.
- An explicit HTTP development command for MCP, plus package-local `.env` loading.

| Internal endpoint | Purpose | Request body |
|---|---|---|
| `POST /internal/documents/:documentName/flush` | Persist and return an active room's Yjs state and derived Markdown | `{}` when sending JSON Content-Type |
| `POST /internal/documents/:documentName/restore` | Restore snapshot content into an active room or storage | `{ "yjsState": "<base64 snapshot>" }` |
| `POST /internal/documents/:documentName/tombstone` | Evict a room and mark it deleted in the adapter | `{}` when sending JSON Content-Type |

These internal calls use the shared gateway credential. The API needs `COLLAB_URL` pointing to the collaboration service and a matching `GATEWAY_SECRET`/`COLLAB_GATEWAY_SECRET`.

**Verification found a transport defect:** the current `CollabService` flush/tombstone methods send JSON Content-Type with no body, which Fastify rejects with `400 FST_ERR_CTP_EMPTY_JSON_BODY`. The service then falls back instead of reporting a successful live capture. A direct flush request with `{}` returned `200` and the live document text. Track 1's unit/integration checks use a mocked collab service and do not cover this mismatch yet.

Full results and created demonstration posts: [Track 1 and MCP verification](./docs/TRACK1_MCP_VERIFICATION.md).

---

## Microkernel Plugin Architecture

Glyphroom is built on a **microkernel plugin architecture** designed to preserve core stability while enabling deep enterprise integrations. Plugins run inside host-enforced boundaries with zero arbitrary remote script injection.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                           GLYPHROOM HOST CORE                               │
│                                                                             │
│  ┌───────────────────────┐   ┌───────────────────┐   ┌───────────────────┐  │
│  │   UI Slot Renderer    │   │ Fastify API Host  │   │  MCP Tool Server  │  │
│  │  (Error Boundaries)   │   │  (Protected Core) │   │  (Namespaced PAT) │  │
│  └──────────┬────────────┘   └─────────┬─────────┘   └─────────┬─────────┘  │
│             │                          │                       │            │
│  ┌──────────▼──────────────────────────▼───────────────────────▼──────────┐  │
│  │                        PLUGIN REGISTRY HOST                            │  │
│  │   • Strict Manifest Validation       • Declared Capability Enforcement │  │
│  │   • Core Route Conflict Prevention   • Scope-Isolated Token Checks     │  │
│  └──────────────────┬──────────────────────────────────┬──────────────────┘  │
│                     │                                  │                     │
│  ┌──────────────────▼────────────┐   ┌─────────────────▼──────────────────┐  │
│  │     Scoped Storage Engine     │   │     Durable Event Outbox Worker    │  │
│  │   • post:<id>  • space:<id>   │   │   • Transactional Event Logging    │  │
│  │   • global     • 256KB Quota  │   │   • Exponential Backoff & Replay   │  │
│  └───────────────────────────────┘   └────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1. Declarative Manifests & Security Boundaries

Every plugin defines a strictly validated `manifest.json`. Plugins must declare only the capabilities they require:
- `ui:slots`: Render custom actions, sidebars, banners, or tabs into pre-defined UI slots.
- `ui:editor`: Inject custom TipTap extensions, node views, or slash commands.
- `api:routes`: Register custom backend HTTP endpoints.
- `api:events`: Subscribe to asynchronous domain lifecycle events.
- `api:storage`: Read and persist scoped key-value data.
- `mcp:tools`: Expose namespaced tools to Model Context Protocol AI agents.

> [!IMPORTANT]
> **Core Route Hijacking Prevention:** Plugins cannot register endpoints shadowing core routes (`/auth`, `/posts`, `/spaces`, `/admin`, or `/internal`). Attempting to register overlapping routes throws a fatal registration error at startup.

### 2. Scoped Plugin Storage

Plugins receive isolated persistent storage backed by PostgreSQL JSONB with an enforced 256 KB maximum payload size:
- **`post:<id>` scope**: Document-specific metadata (e.g. Jira issue link, translation cache).
- **`space:<id>` scope**: Team-level plugin configuration (e.g. designated Slack channel webhook).
- **`global` scope**: System-wide configuration accessible across the tenant.

```typescript
// Plugin backend accessing isolated storage
const config = await context.storage.get('global', 'webhook_url');
await context.storage.set('space:space-123', 'channel', { channelId: 'C01234567' });
```

### 3. Durable Domain Event Outbox

Domain lifecycle events, including `post:created`, `post:submitted_for_review`, `post:reviewed`, `post:published`, and `comment:created`, are written to a durable `plugin_event_outbox` table and dispatched by a background worker. Consistent atomic mutation-plus-event transactions remain a follow-up across routes.

- **Asynchronous delivery:** API requests do not wait for external webhook delivery.
- **Reliable background worker:** Outbox entries are processed asynchronously with bounded exponential backoff ($2^{\text{attempts}} \times 1\text{s}$, max 60s).
- **Dead-letter threshold:** Failing event dispatches are capped at 5 attempts and transitioned to `dead_letter` status.
- **Admin replay:** Operators can inspect dead-letter payloads and trigger one-click replays from the Admin Console.

### 4. Web UI Slots & Isolated Slash Commands

The Web client renders plugins declaratively through predefined insertion points:

| Slot Name | Target Location | Typical Use Cases |
| :--- | :--- | :--- |
| `topbar:actions` | Application navigation bar | Quick-action modals, status indicators |
| `sidebar:navigation` | Global sidebar menu | External tool navigation links |
| `editor:toolbar:actions` | TipTap formatting toolbar | Custom node insert triggers |
| `editor:drawer:tabs` | Editor properties sidebar | Document metadata, linked external tickets |
| `editor:slash:commands` | TipTap autocomplete menu | Custom block insertion (e.g. `/jira`) |
| `reader:header:actions` | Document reader header | Export options, external sharing |
| `reader:content:banner` | Top of published document | Compliance notices, synchronization warnings |
| `admin:console:tabs` | Admin management console | Custom plugin telemetry and dashboards |

Every slot item is guarded by a `PluginErrorBoundary`. A crash in a plugin component renders a clean inline warning without breaking the rest of the application.

### 5. Reference Plugins

Glyphroom ships with two reference plugins illustrating full-stack extension patterns:

- **`@enterprise-blogger/plugin-slack-notifier` (`plugins/slack-notifier`):**
  - Subscribes to durable `post:created` and `post:published` outbox events.
  - Formats rich Slack Block Kit payloads and dispatches them to configured incoming webhooks with automatic retry resilience.
- **`@enterprise-blogger/plugin-jira-embed` (`plugins/jira-embed`):**
  - Registers a custom TipTap node view rendering styled Jira issue status cards.
  - Adds a `/jira` slash command to the document editor with collision protection against core slash commands.

---

## Quick Start

Run the services with Docker Compose or use the pnpm workspace for local development.

### Option A: Turnkey Docker Compose (Fastest)

Requires only [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/).

```bash
# 1. Clone the repository
git clone https://github.com/allwin-antony/Glyphroom.git
cd Glyphroom

# 2. Copy the environment configuration
cp .env.example .env

# 3. Spin up all services (PostgreSQL, Collab Server, API, Web UI, MCP Server)
docker compose -f docker-compose.prod.yml up -d --build
```

Open **[http://localhost](http://localhost)** in your browser!

For Track 1, add the API-to-collab settings to the existing `api.environment` mapping in Compose:

```yaml
COLLAB_URL: http://collab:4000
GATEWAY_SECRET: ${GATEWAY_SECRET}
```

Use the same gateway credential as the collab service. The current Compose file already gives MCP its API/gateway URLs and mounts the API attachment volume at `/app/uploads`. Preserve existing API upload files when introducing that volume into an older deployment.

---

### Option B: Local Development (pnpm)

Recommended: **Node.js 22+**, the repository-pinned **pnpm 12.15.0**, and **PostgreSQL 16**. The latest verification used Node.js 24.9.0.

```bash
# 1. Clone and install dependencies
git clone https://github.com/allwin-antony/Glyphroom.git
cd Glyphroom
pnpm install --frozen-lockfile

# 2. Configure environment
cp .env.example .env

# 3. Start PostgreSQL (via Docker or local daemon)
docker compose -f docker-compose.prod.yml up -d postgres

# 4. Build workspace exports and check types
pnpm build
pnpm typecheck

# 5. Seed demo users and initial spaces
pnpm --filter @enterprise-blogger/api tsx src/scripts/seed-test-users.ts

# 6. Start development servers
# Terminal 1: Fastify REST API (Port 4001)
pnpm --filter @enterprise-blogger/api run dev

# Terminal 2: Collaborative CRDT Server (Port 4000)
pnpm --filter @enterprise-blogger/collab run dev

# Terminal 3: Vite React Web UI (Port 3000)
pnpm --filter @enterprise-blogger/web run dev

# Terminal 4: HTTP MCP server (example port 5001)
MCP_PORT=5001 pnpm --filter @enterprise-blogger/mcp-server run dev
```

Visit **[http://localhost:3000](http://localhost:3000)**.

Set `COLLAB_URL=http://127.0.0.1:4000` in the API process environment and configure the same gateway secret for API, collab, and MCP. The browser uses the same-origin `/ws` proxy by default; `VITE_COLLAB_WS_URL` can override it.

MCP defaults to port 5000; `PORT` takes precedence over `MCP_PORT`. An existing `apps/mcp-server/.env` overrides inherited environment values, so check that file when changing ports or service URLs. `0.0.0.0` is a server bind address; clients use localhost or a reachable host address.

---

## Pre-Seeded Demo Accounts

All seeded test accounts use the password: `admin2026!`

The sign-in page at `/signin` includes **one-click autofill buttons** for rapid testing:

| User | Email | System Role | Default Context |
| :--- | :--- | :--- | :--- |
| **Maya (Admin)** | `admin@enterprise-blogger.local` | System Admin | Global admin access, user/PAT directory, plugin diagnostics |
| **Arjun** | `arjun.maintainer@enterprise.internal` | Member | Owner / Maintainer of *Payments Revamp* |
| **Priya** | `priya.sharma@enterprise.internal` | Member | Author in *Payments Revamp* |
| **Rahul** | `rahul.viewer@enterprise.internal` | Member | Viewer in *Payments Revamp* |
| **Marcus** | `marcus.chen@enterprise.internal` | Moderator | Maintainer in *Platform Security* |
| **Elena** | `elena.rostova@enterprise.internal` | Member | Staff SRE (independent author) |

---

## Model Context Protocol (MCP) Integration

Glyphroom includes a built-in MCP server that enables coding assistants (e.g. **Antigravity IDE**, **Claude Desktop**, **Cursor**) to read documents, participate in review cycles, propose edits directly via Yjs suggestions, and invoke namespaced plugin tools.

### Remote HTTP: Caller-Local PAT

Create a PAT in **Settings → Personal Access Tokens**, then keep it in the environment or a local file accessible to your assistant. Each HTTP request sends the caller's Bearer token; a shared HTTP MCP server does not use a server-wide user PAT.

OpenCode V2 example (`~/.config/opencode/opencode.json(c)`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "glyphroom": {
        "type": "remote",
        "url": "http://127.0.0.1:5001/mcp",
        "oauth": false,
        "headers": {
          "Authorization": "Bearer {file:~/.secrets/glyphroom-pat}"
        }
      }
    }
  }
}
```

The token file contains only the PAT. `{env:GLYPHROOM_PAT}` can be used instead of the file reference when that variable is available to the OpenCode service. Save configuration and use `/reload` to refresh the connection. For WSL-to-Windows connections, use the host address reachable from WSL rather than the client's localhost.

| Capability | PAT scope |
|---|---|
| Read/search | `posts:read` |
| Create drafts | `posts:draft`, or legacy `posts:write` |
| Append/insert/suggest | `posts:suggest`, or legacy `posts:write` |
| Comments/replies | `comments:write` |
| Publish an approved checkpoint | `posts:publish`, plus the user's existing publication rights |

Deploy API and MCP together: MCP validates the token through the API's PAT context response.

### Local Stdio

Add this to your IDE or assistant's MCP configuration (`mcp_config.json` or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "glyphroom": {
      "command": "node",
      "args": [
        "<PATH_TO_REPO>/apps/mcp-server/dist/index.js",
        "--stdio"
      ],
      "env": {
        "GLYPHROOM_API_URL": "http://127.0.0.1:4001",
        "GLYPHROOM_PAT": "<YOUR_PERSONAL_ACCESS_TOKEN>",
        "COLLAB_GATEWAY_URL": "http://127.0.0.1:4000/internal/agent-gateway/edit",
        "GATEWAY_SECRET": "REPLACE_WITH_STRONG_GATEWAY_SECRET"
      }
    }
  }
}
```

The stdio process resolves its local PAT to the same actor model used by HTTP. The API URL accepts either the origin or a URL ending in `/api/v1`.

### Built-in MCP Tools

| Tool | Capability | Description |
| :--- | :--- | :--- |
| `search_posts` | Discovery | Authenticated keyword discovery; pagination and filter parity are incomplete. |
| `get_post` | Content Retrieval | Returns content and metadata. Requested summary/JSON formats and suggestion inclusion are not implemented yet. |
| `create_post` | Drafting | Preserves the required body, excerpt, tags, and COE, attributed to the caller. Initial Markdown is retained as text rather than imported as native rich nodes. |
| `add_comment` | Discussion | Creates comments and one-level replies. Heading-anchor persistence remains incomplete. |
| `append_section` | Collaborative Edit | Appends a heading and pending text suggestions through the live gateway. |
| `insert_after_section` | Collaborative Edit | Inserts after a native heading's section subtree through the live gateway. |
| `suggest_edit_section` | Collaborative Edit | Produces granular text suggestions. Unsupported structured sections are rejected before mutation. |
| `publish_post` | Publication | Calls the approved-checkpoint publish route; it does not currently submit drafts for review. |
| *`${pluginId}.${toolName}`* | Plugin Extension | Dynamically exposed tools from active plugins requiring validated caller PAT scopes. |

The server also provides three resources: `glyphroom://documentation/editor-blocks`, `glyphroom://templates/architecture-rfc`, and `glyphroom://templates/weekly-pulse`, plus architecture-RFC and weekly-pulse prompts.

The rich-block specification covers five alert types, Mermaid, math, status cards, tables, and checklists. Native MCP import and complete reader rendering are still being completed; preserving the Markdown syntax does not mean every block renders natively in the reader.

---

## Monorepo Architecture

```text
Glyphroom/
├── apps/
│   ├── web/               # React 18, Vite, TipTap/ProseMirror, Tailwind CSS, Plugin Host
│   ├── api/               # Fastify 5, Drizzle ORM, PostgreSQL REST API, Plugin Outbox Worker
│   ├── collab/            # Hocuspocus CRDT WebSocket collaboration server
│   └── mcp-server/        # Stateless HTTP / stdio MCP server with per-request actors
├── packages/
│   └── shared/            # TypeScript schemas, CRDT diffing, Plugin Contracts & Manifests
├── plugins/
│   ├── slack-notifier/    # Event-driven Slack notifications via durable outbox
│   └── jira-embed/        # Rich TipTap node extension & /jira slash command
├── tests/                 # End-to-end convergence and adversarial stress tests
├── docker/                # Production Dockerfiles and PostgreSQL initialization SQL
└── docs/                  # Architecture specifications and improvement roadmap
```

---

## Testing & Quality Assurance

### Latest Verification — 2026-10-30

Verified against `de2cda8`, including Track 1 (`f3177f3`):

| Check | Result |
|---|---|
| `pnpm build` | Passed, including the production web bundle |
| `pnpm typecheck` | Passed across eight workspaces |
| API workflow/catalog regressions | 19 passed, including six Track 1 cases |
| MCP HTTP/PAT regressions | 4 passed |
| Web review/editor regressions | 24 passed |
| Live authenticated MCP | Existing posts read; three drafts created; showcase body/tags and a comment/reply verified |
| Live collab editing through MCP | Append blocked by gateway connection failure in the tested deployment |
| Real collab HTTP flush probe | JSON header with no body: 400; explicit `{}` body: 200 with live text |

The targeted regression total is **47 passing tests**. See [verification details](./docs/TRACK1_MCP_VERIFICATION.md) for the tested boundaries and residual defects. An earlier full-workspace Node 24 run also found an oversized-header test expecting a socket error instead of HTTP 431, and a load-sensitive latency assertion.

```bash
# Run all workspace test suites
pnpm test:all

# Run individual package test suites
pnpm test:shared  # Schema, exports, CRDT operations, plugin contracts
pnpm test:api     # API workflows, metadata, permissions, notifications
pnpm test:web     # Editor, reader, review, and application components
pnpm test:collab  # Hocuspocus synchronization, persistence, gateway
pnpm test:mcp     # MCP tools, transport, PAT isolation, plugins
pnpm test:tests   # Cross-package integration and convergence
pnpm --filter @enterprise-blogger/plugin-slack-notifier test
pnpm --filter @enterprise-blogger/plugin-jira-embed test

# Typecheck all packages
pnpm typecheck
```

Build shared/collab/MCP exports before running the cross-package integration workspace from a fresh checkout.

---

## Current Limits

- **Checkpoint transport:** API flush/tombstone requests currently omit a JSON body and are rejected by Fastify. Failure fallback, empty checkpoints, and restore persistence ordering need follow-up.
- **Publication parity:** the direct `/republish` route still publishes working content without another review. Version allocation, event transactions, and previously published visibility during re-review need further validation.
- **Rich reading/import:** table rows, Mermaid code, formulas, and status-card syntax are not all rendered natively by Reader View. Initial MCP Markdown is text-preserving rather than a complete native-node import.
- **MCP contracts:** search ignores requested pagination/tag filters; summary/JSON read formats and suggestion inclusion are incomplete; heading anchors and explicit review submission need implementation.
- **Live editing configuration:** MCP requires a reachable collab gateway. The latest live append check returned a connection error even though reads and draft creation worked.
- **Concurrent tags:** simultaneous draft creation with shared tags produced `tags_name_key` conflict; sequential creation succeeded.
- **Discovery and attachments:** dashboard pagination/counts, ranked full-text search, relative attachment keys, and orphan cleanup remain active work.

## Roadmap

Start with [latest verification](./docs/TRACK1_MCP_VERIFICATION.md), the [reliability plan](./docs/MCP_AND_BLOGGING_RELIABILITY_PLAN.md), and the [implementation handover](./docs/IMPLEMENTATION_HANDOVER.md). Additional background: [feature plan](./docs/FEATURE_IMPROVEMENT_PLAN.md) and [plugin architecture](./docs/PLUGIN_ARCHITECTURE_IMPLEMENTATION_PLAN.md).

- [x] Submitted-version references and immutable review previews
- [x] Collab flush/restore/tombstone endpoint implementations
- [x] Per-user HTTP MCP authentication and text-preserving draft creation
- [x] Browser rich-node Markdown export compatibility
- [x] Space administration, archiving, and owner removal safeguards
- [x] Server-side SQL catalog pagination and search filtering
- [x] Reader bookmarks and Saved Reading dashboard
- [x] Persistent post tags and taxonomy sync
- [x] In-app notifications with polling fallback
- [x] Operational Admin Console (User directory & PAT revocation)
- [x] Microkernel Plugin Architecture, Scoped Storage & Durable Event Outbox
- [x] Reference Plugins (Slack Notifier & Jira Embed)
- [x] Admin Console Plugin Inventory & Outbox Retry Diagnostics
- [ ] Complete Track 1 transport, empty-snapshot, restore, and republish edge cases
- [ ] Native rich-Markdown MCP import and full reader rendering
- [ ] Complete MCP pagination, read formats, heading anchors, and review submission
- [ ] Markdown review diff viewer (visual unified / side-by-side)
- [ ] Server-Sent Events (SSE) stream for real-time notification pushes
- [ ] Full-text PostgreSQL `tsvector` ranked search projections
- [ ] Durable attachment lifecycle, relative storage, and orphan cleanup
- [ ] Enterprise SSO integration (SAML 2.0 / OIDC) *(Planned)*

---

## Contributing & License

Contributions, bug reports, and feedback are welcome! Please feel free to open an issue or submit a pull request.

Licensed under the **[Apache License, Version 2.0](./LICENSE)**.
