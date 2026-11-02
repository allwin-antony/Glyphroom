# Glyphroom

> **Self-hosted technical documentation, engineering blogs, and team knowledge base with real-time CRDT co-editing, team-scoped Spaces, microkernel plugin extensions, and Model Context Protocol (MCP) AI co-authoring.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![Status: Beta Ready](https://img.shields.io/badge/Status-Beta%20Ready%20(16%2F16%20Matrix%20Passed)-brightgreen.svg)](#testing--quality-assurance)
[![CRDT](https://img.shields.io/badge/CRDT-Yjs%20(Canonical%20Binary)-purple.svg)](#key-capabilities)
[![Architecture](https://img.shields.io/badge/Plugins-Microkernel%20Outbox-teal.svg)](#microkernel-plugin-architecture)
[![MCP](https://img.shields.io/badge/AI%20Protocol-Model%20Context%20Protocol-orange.svg)](#model-context-protocol-mcp-integration)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](#monorepo-architecture)

---

> [!NOTE]
> **Glyphroom is in Beta Readiness (v1.0-beta).** The core reliability architecture has passed all 16 rows of the Section 6 Acceptance Test Matrix in [`docs/MCP_AND_BLOGGING_RELIABILITY_PLAN.md`](./docs/MCP_AND_BLOGGING_RELIABILITY_PLAN.md) across real PostgreSQL 16 persistence, Docker containerization, WebSocket CRDT synchronization, MCP agent co-authoring, and rich headless reader rendering. Local authentication, scoped collaborator permissions, and Personal Access Tokens provide robust identity boundaries for self-hosted evaluation and internal team deployments.

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
| **Real-Time CRDT Co-editing** | [Yjs](https://github.com/yjs/yjs) and [Hocuspocus](https://tiptap.dev/hocuspocus) synchronize working documents over WebSockets, with binary state stored in PostgreSQL `bytea` columns. Canonical room addresses resolve both UUIDs (`post-<UUID>`) and human-readable slugs. |
| **Unified Reader & Rich Markdown** | Full presenter engine in Reader View: responsive Table of Contents, H1–H6 hierarchical headings, GitHub alert callouts (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`), KaTeX display/inline math, Mermaid architecture diagrams, GFM tables, checklists, code blocks, and DOMPurify XSS sanitization. |
| **Immutable Editorial Review** | `draft` ➔ `in_review` ➔ `approved` ➔ `published`. Keystroke-level snapshots are frozen into PostgreSQL `post_versions` upon review submission. Reviewers inspect immutable snapshots; readers are pinned to approved checkpoints while author drafts proceed independently. |
| **Stale Decision Protection** | When an author submits a second review cycle, older in-flight moderator decisions are rejected with `409 Conflict`. Republishing pins the newly approved checkpoint (`pin2`) with uninterrupted reader continuity. |
| **Milestone Version Restore** | Restore earlier snapshots (`v1`) across live collaborative peers in real time without altering published post fields in PostgreSQL. |
| **AI Co-Authoring (MCP)** | Model Context Protocol server over HTTP and local stdio. Callers use scoped Personal Access Tokens (PAT). Text and block edits use tracked `suggestion_insert`, `suggestion_delete`, and `attribution` marks for human review. |
| **Catalog Search & Pagination** | Server-side SQL search with debounced user inputs, arbitrary offset support, 24-result pagination ("Load more"), multi-status array filtering, and Space visibility fencing. |
| **Container & Attachment Continuity** | Content-addressable disk storage for uploaded images and file attachments, preserved across API container restarts and recreation. Remote browsers in separate network namespaces connect via same-origin proxied WebSockets (`/ws`). |
| **Microkernel Plugin Host** | Declarative UI slots, editor extensions, scoped key-value storage, and a durable transactional event outbox. |
| **Operational Admin Console** | Self-hosted management UI: search user directories, update roles, audit/revoke Personal Access Tokens, and inspect plugin event delivery replays. |
| **Tamper-Evident Audit Chain** | SHA-256 hash-chained cryptographic audit logs for sensitive operations (promotions, membership alterations, PAT revocations, plugin replays). |

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

Domain lifecycle events (`post:created`, `post:submitted_for_review`, `post:reviewed`, `post:published`, `comment:created`) are written to the `plugin_event_outbox` table and dispatched asynchronously:

- **Asynchronous delivery:** API requests do not wait for external webhook delivery.
- **Reliable background worker:** Outbox entries are processed with bounded exponential backoff ($2^{\text{attempts}} \times 1\text{s}$, max 60s).
- **Dead-letter threshold:** Failing event dispatches transition to `dead_letter` status after 5 attempts.
- **Admin replay:** Operators can inspect dead-letter payloads and trigger one-click replays from the Admin Console.

### 4. Reference Plugins

Glyphroom ships with two reference plugins illustrating full-stack extension patterns:

- **`@glyphroom/plugin-slack-notifier` (`plugins/slack-notifier`):**
  - Subscribes to durable `post:created` and `post:published` outbox events.
  - Formats rich Slack Block Kit payloads and dispatches them to configured incoming webhooks with automatic retry resilience.
- **`@glyphroom/plugin-jira-embed` (`plugins/jira-embed`):**
  - Registers a custom TipTap node view rendering styled Jira issue status cards.
  - Adds a `/jira` slash command to the document editor with collision protection against core slash commands.

---

## Quick Start

Run the services with Docker Compose or use the pnpm workspace for local development.

### Option A: Turnkey Docker Compose (Production Setup)

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

The services will automatically initialize PostgreSQL schema migrations, bootstrap default admin credentials, and mount content-addressable attachment volumes.

---

### Option B: Local Development (pnpm)

Recommended: **Node.js 22+**, the repository-pinned **pnpm 12.15.0**, and **PostgreSQL 16**.

```bash
# 1. Clone and install dependencies
git clone https://github.com/allwin-antony/Glyphroom.git
cd Glyphroom
pnpm install --frozen-lockfile

# 2. Configure environment
cp .env.example .env

# 3. Start PostgreSQL
docker compose -f docker-compose.prod.yml up -d postgres

# 4. Build workspace exports and check types
pnpm build
pnpm typecheck

# 5. Seed demo users and initial spaces
pnpm --filter @glyphroom/api tsx src/scripts/seed-test-users.ts

# 6. Start development servers
# Terminal 1: Fastify REST API (Port 4001)
pnpm --filter @glyphroom/api run dev

# Terminal 2: Collaborative CRDT Server (Port 4000)
pnpm --filter @glyphroom/collab run dev

# Terminal 3: Vite React Web UI (Port 3000)
pnpm --filter @glyphroom/web run dev

# Terminal 4: HTTP MCP server (Port 5000)
pnpm --filter @glyphroom/mcp-server run dev
```

Visit **[http://localhost:3000](http://localhost:3000)**.

---

## Pre-Seeded Demo Accounts

All seeded test accounts use the password: `admin2026!`

The sign-in page at `/signin` includes **one-click autofill buttons** for rapid testing:

| User | Email | System Role | Default Context |
| :--- | :--- | :--- | :--- |
| **Maya (Admin)** | `admin@glyphroom.local` | System Admin | Global admin access, user/PAT directory, plugin diagnostics |
| **Arjun** | `arjun.maintainer@glyphroom.internal` | Member | Owner / Maintainer of *Payments Revamp* |
| **Priya** | `priya.sharma@glyphroom.internal` | Member | Author in *Payments Revamp* |
| **Rahul** | `rahul.viewer@glyphroom.internal` | Member | Viewer in *Payments Revamp* |
| **Marcus** | `marcus.chen@glyphroom.internal` | Moderator | Maintainer in *Platform Security* |
| **Elena** | `elena.rostova@glyphroom.internal` | Member | Staff SRE (independent author) |

---

## Model Context Protocol (MCP) Integration

Glyphroom includes a built-in MCP server that enables coding assistants (e.g. **Antigravity IDE**, **Claude Desktop**, **Cursor**) to read documents, participate in review cycles, propose edits directly via Yjs suggestions, and invoke namespaced plugin tools.

### Remote HTTP: Caller-Local PAT

Create a PAT in **Settings → Personal Access Tokens**, then configure your assistant:

OpenCode / Assistant configuration example:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "glyphroom": {
        "type": "remote",
        "url": "http://127.0.0.1:5000/mcp",
        "oauth": false,
        "headers": {
          "Authorization": "Bearer <YOUR_PERSONAL_ACCESS_TOKEN>"
        }
      }
    }
  }
}
```

| Capability | PAT Scope |
|---|---|
| Read/search | `posts:read` |
| Create drafts | `posts:draft`, `posts:write` |
| Append/insert/suggest | `posts:suggest`, `posts:write` |
| Comments/replies | `comments:write` |
| Publish an approved checkpoint | `posts:publish` (requires publication permission on post) |

### Local Stdio

Add this to your IDE's MCP configuration (`claude_desktop_config.json`):

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

### Built-in MCP Tools

| Tool | Capability | Description |
| :--- | :--- | :--- |
| `search_posts` | Discovery | Authenticated keyword search with offset/limit pagination, tag filters, and Space scoping. |
| `get_post` | Retrieval | Returns full document content and metadata in `markdown` or `prosemirror_json` formats. |
| `create_post` | Drafting | Creates drafts with title, Markdown content, excerpt, tags, and COE assignment. Initial headings and blocks are parsed into canonical Yjs nodes. |
| `add_comment` | Discussion | Creates root comments and one-level threaded replies, with optional heading anchors (`anchorHeading`). |
| `append_section` | Collaborative Edit | Appends a new section with a heading and content suggestions through the collaboration gateway. |
| `insert_after_section` | Collaborative Edit | Inserts content immediately following a specified target heading subtree. |
| `suggest_edit_section` | Collaborative Edit | Replaces target section text with tracked suggestion marks and instructions. |
| `publish_post` | Publication | Publishes an independently approved checkpoint with custom publication notes. |
| *`${pluginId}.${toolName}`* | Plugin Extension | Dynamically exposed tools from active plugins. |

The server also provides three resources: `glyphroom://documentation/editor-blocks`, `glyphroom://templates/architecture-rfc`, and `glyphroom://templates/weekly-pulse`, plus architecture-RFC and weekly-pulse prompts.

---

## Monorepo Architecture

```text
Glyphroom/
├── apps/
│   ├── web/               # React 18, Vite, TipTap/ProseMirror, Tailwind CSS, Plugin Host, Reader View
│   ├── api/               # Fastify 5, Drizzle ORM, PostgreSQL REST API, Plugin Outbox Worker
│   ├── collab/            # Hocuspocus CRDT WebSocket collaboration server & Document Lifecycle
│   └── mcp-server/        # Stateless HTTP / stdio MCP server with per-request actor attribution
├── packages/
│   └── shared/            # TypeScript schemas, CRDT diffing, Plugin Contracts & Manifests
├── plugins/
│   ├── slack-notifier/    # Event-driven Slack notifications via durable outbox
│   └── jira-embed/        # Rich TipTap node extension & /jira slash command
├── tests/                 # End-to-end convergence and adversarial stress suites
├── docker/                # Production Dockerfiles and PostgreSQL initialization SQL
└── docs/                  # Architecture specifications and reliability plans
```

---

## Testing & Quality Assurance

Glyphroom enforces a rigorous multi-tier testing pipeline. All suites are green:

### Automated Test Suites (1,105 Passed, 0 Failed)

| Package | Test Files | Passed | Status |
|---|---|---|---|
| [`@glyphroom/shared`](./packages/shared) | 17 | 332 | **PASS** |
| [`@glyphroom/collab`](./apps/collab) | 9 | 156 | **PASS** |
| [`@glyphroom/mcp-server`](./apps/mcp-server) | 9 | 72 | **PASS** |
| [`@glyphroom/web`](./apps/web) | 30 | 210 | **PASS** |
| [`@glyphroom/plugin-jira-embed`](./plugins/jira-embed) | 1 | 4 | **PASS** |
| [`@glyphroom/plugin-slack-notifier`](./plugins/slack-notifier) | 1 | 4 | **PASS** |
| [`@glyphroom/api`](./apps/api) | 28 | 215 (+42 PG) | **PASS** |
| [`@glyphroom/tests`](./tests) | 12 | 112 | **PASS** |

### Section 6 Acceptance Test Matrix (16 / 16 Rows Passed)

The end-to-end acceptance runner (`run.mjs`) validates the entire live stack against Section 6 of [`docs/MCP_AND_BLOGGING_RELIABILITY_PLAN.md`](./docs/MCP_AND_BLOGGING_RELIABILITY_PLAN.md):

- ✅ **Rows [1, 3]:** Interleaved HTTP MCP identities, draft creation, role visibility, token scopes, and 403 authorization fences.
- ✅ **Rows [2, 4]:** Real stdio PAT transport, NDJSON framing, 8 tools, 3 RFC resources, and 2 prompts.
- ✅ **Row [13]:** Real empty dashboard (`Drafts (0)`) and review queue clear state.
- ✅ **Row [14]:** Space New Post context, automatic role inheritance, and author edit grants without invitations.
- ✅ **Rows [5, 7, 16]:** Real browser rich paste, KaTeX math, Mermaid diagrams, file/image uploads, and collaborative TipTap editing across UUID and slug rooms.
- ✅ **Rows [3, 6]:** Text and atom suggestions (`insert_after_section`, `suggest_edit_section`, `append_section`), attribution marks, and clean reject/accept cycles.
- ✅ **Rows [15, 3]:** Unanchored and selection-anchored comments, threaded replies, reply notifications, MCP heading anchors, and resolve/reload.
- ✅ **Rows [5, 7]:** Collaborative recovery across restarts with legacy default-root vs ProseMirror fragments.
- ✅ **Rows [8, 9, 12, 14, 3]:** Immediate keystroke submit, Postgres checkpoint snapshot, moving target, independent moderator review, MCP publication, and reader unapproved edit isolation.
- ✅ **Rows [5, 6]:** 8-step reader harness (fixture marker, H1–H6 tags, TOC scroll bridge, Mermaid SVG, KaTeX math, DOMPurify XSS sanitization, 0 console errors), image rendering, file attachment download, and Markdown export.
- ✅ **Rows [10, 12, 14]:** Second-cycle edit, submit, independent review, republish pinning `pin2`, and reader publication continuity.
- ✅ **Rows [11, 12]:** Milestone restore to v1 across two live editors without modifying published version fields in PostgreSQL.
- ✅ **Rows [3, 13, 12]:** 30-result catalog search, pagination ("Load more 24 of 30"), review queue pagination, and debounced queries without stale appends.
- ✅ **Rows [16, 13]:** API Docker container stop and recreation, "Upstream unavailable" UI handling, and disk attachment download continuity.
- ✅ **Rows [16, 7]:** Real separate-network-namespace browser reaching same-origin proxied collaboration with live peer convergence.
- ✅ **Row [11]:** Document deletion with two live editors, late input, reconnect, and durable non-resurrection (`Post not found.`).
- ✅ **Row [12]:** Coordinator-approved scoped PG proof reuse with $\ge 3$ active database connections.
- ✅ **Row [3]:** Verification of discovered tool input coverage across all 8 tools and properties.

```bash
# Run all workspace test suites
pnpm test

# Typecheck all packages
pnpm typecheck

# Build all packages
pnpm build
```

---

## Roadmap

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
- [x] Unified Reader View with KaTeX, Mermaid, Alerts, Tables, and TOC
- [x] Live peer milestone version restore without published field mutation
- [x] Stale review decision rejection (HTTP 409) and republish version pinning
- [x] Live editor document deletion with durable non-resurrection
- [x] Separate-network-namespace browser proxy convergence
- [x] Complete Section 6 Acceptance Test Matrix verification (16/16 rows)
- [ ] Server-Sent Events (SSE) stream for real-time notification pushes
- [ ] Enterprise SSO integration (SAML 2.0 / OIDC) *(Planned)*

---

## Contributing & License

Contributions, bug reports, and feedback are welcome! Please feel free to open an issue or submit a pull request.

Licensed under the **[Apache License, Version 2.0](./LICENSE)**.
