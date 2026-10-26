# Glyphroom

> **Self-hosted technical documentation, engineering blogs, and team knowledge base with real-time CRDT co-editing, team-scoped Spaces, and Model Context Protocol (MCP) AI co-authoring.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/Tests-630%20passing-brightgreen.svg)](#testing)
[![CRDT](https://img.shields.io/badge/CRDT-Yjs%20(Canonical%20Binary)-purple.svg)](#real-time-co-editing-crdts)
[![MCP](https://img.shields.io/badge/AI%20Protocol-Model%20Context%20Protocol-orange.svg)](#model-context-protocol-mcp-ai-co-authoring)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](#tech-stack)

---

> [!WARNING]
> ### ⚠️ Security & Production Status Notice
> **Glyphroom is currently an open developer preview.**
>> While core RBAC, session management, CSRF mitigation, and cryptographic audit hash-chaining are implemented and tested, **enterprise Single Sign-On (SSO via SAML 2.0 / OIDC / Okta / Azure AD) and deep production security hardening (e.g., hardened file sandboxing, antivirus integration, untrusted network rate-limiting, and independent third-party penetration audits) are actively in progress.**
>
> We strongly recommend running Glyphroom within **private networks, VPNs, or trusted developer environments** during this phase. Local break-glass authentication and scoped Personal Access Tokens (PATs) are provided for evaluation and internal team use.

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
| **Real-Time CRDT Co-editing** | Powered by [Yjs](https://github.com/yjs/yjs) and [Hocuspocus](https://tiptap.dev/hocuspocus). Raw binary storage in PostgreSQL `bytea` columns with sub-20ms broadcast latency. Zero Base64 overhead. |
| **Dual Canvas View** | Toggle effortlessly between **Document View** (continuous reading & authoring) and **Block View** (notebook cards, reordering, code execution, Mermaid diagrams). |
| **Peer Review Machine** | Formal lifecycle transitions: `draft` ➔ `in_review` ➔ `approved` ➔ `published`. Every review submission pins an **immutable version checkpoint** so ongoing edits never leak into unreviewed approvals. |
| **AI Co-Authoring (MCP)** | Native [Model Context Protocol](https://modelcontextprotocol.io/) server (`apps/mcp-server`). AI agents suggest edits non-destructively using visual diff marks (`suggestion_insert` / `suggestion_delete`) that humans accept or reject. |
| **In-App Notifications** | Top-bar notification bell with real-time alerts for review requests, editorial decisions, publications, space invites, and collaborator mentions. |
| **Saved Reading (Bookmarks)** | One-click bookmarking from reader or catalog views, backed by a personal **Saved Reading** dashboard. |
| **Operational Admin Console** | Self-hosted management UI: search user directories, update roles, toggle active/inactive status, and audit/revoke Personal Access Tokens. |
| **Tamper-Evident Audit Chain** | SHA-256 hash-chained cryptographic audit logs for sensitive operations (promotions, membership alterations, PAT revocations). |

---

## Quick Start

You can get Glyphroom running locally in under **2 minutes**.

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

---

### Option B: Local Development (pnpm)

Requires **Node.js 20+**, **pnpm 9+** (`corepack enable pnpm`), and **PostgreSQL 15+**.

```bash
# 1. Clone and install dependencies
git clone https://github.com/allwin-antony/Glyphroom.git
cd Glyphroom
pnpm install

# 2. Configure environment
cp .env.example .env

# 3. Start PostgreSQL (via Docker or local daemon)
docker compose -f docker-compose.prod.yml up -d postgres

# 4. Seed demo users and initial spaces
pnpm --filter @enterprise-blogger/api tsx src/scripts/seed-test-users.ts

# 5. Start development servers
# Terminal 1: Fastify REST API (Port 4001)
pnpm --filter @enterprise-blogger/api run dev

# Terminal 2: Collaborative CRDT Server (Port 4000)
pnpm --filter @enterprise-blogger/collab run dev

# Terminal 3: Vite React Web UI (Port 3000)
pnpm --filter @enterprise-blogger/web run dev
```

Visit **[http://localhost:3000](http://localhost:3000)**.

---

## Pre-Seeded Demo Accounts

All seeded test accounts use the password: `admin2026!`

The sign-in page at `/signin` includes **one-click autofill buttons** for rapid testing:

| User | Email | System Role | Default Context |
| :--- | :--- | :--- | :--- |
| **Maya (Admin)** | `admin@enterprise-blogger.local` | System Admin | Global admin access, user/PAT directory |
| **Arjun** | `arjun.maintainer@enterprise.internal` | Member | Owner / Maintainer of *Payments Revamp* |
| **Priya** | `priya.sharma@enterprise.internal` | Member | Author in *Payments Revamp* |
| **Rahul** | `rahul.viewer@enterprise.internal` | Member | Viewer in *Payments Revamp* |
| **Marcus** | `marcus.chen@enterprise.internal` | Moderator | Maintainer in *Platform Security* |
| **Elena** | `elena.rostova@enterprise.internal` | Member | Staff SRE (independent author) |

---

## Model Context Protocol (MCP) Integration

Glyphroom includes a built-in MCP server that enables coding assistants (e.g. **Antigravity IDE**, **Claude Desktop**, **Cursor**) to read documents, participate in review cycles, and propose edits directly via Yjs suggestions.

### Connect Your Assistant

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
        "GLYPHROOM_API_URL": "http://127.0.0.1:4001/api/v1",
        "GLYPHROOM_PAT": "<YOUR_PERSONAL_ACCESS_TOKEN>",
        "COLLAB_GATEWAY_URL": "http://127.0.0.1:4000/internal/agent-gateway/edit",
        "GATEWAY_SECRET": "REPLACE_WITH_STRONG_GATEWAY_SECRET"
      }
    }
  }
}
```

> **Tip:** Generate your Personal Access Token (PAT) directly in the web UI under **Settings ➔ Personal Access Tokens**.

### Built-in MCP Tools

| Tool | Capability | Description |
| :--- | :--- | :--- |
| `search_posts` | Discovery | Searches published and draft posts by keyword with boundary injection guards. |
| `get_post` | Content Retrieval | Returns document outline, sections, metadata, and working Markdown. |
| `create_post` | Drafting | Creates a new draft post attributed to the authenticated token owner. |
| `add_comment` | Peer Review | Attaches review comments or inline feedback to target document sections. |
| `append_section` | Collaborative Edit | Appends a structured section via Yjs sync without overwriting concurrent human edits. |
| `insert_after_section` | Collaborative Edit | Inserts headings and content immediately following a targeted section heading. |
| `suggest_edit_section` | Collaborative Edit | Produces granular `suggestion_insert` and `suggestion_delete` marks for human acceptance. |
| `publish_post` | Governance | Triggers document publication (strictly requires `posts:publish` token scope). |

---

## Monorepo Architecture

```text
Glyphroom/
├── apps/
│   ├── web/               # React 18, Vite, TipTap/ProseMirror, Tailwind CSS
│   ├── api/               # Fastify 4, Drizzle ORM, PostgreSQL REST API & RBAC
│   ├── collab/            # Hocuspocus CRDT WebSocket collaboration server
│   └── mcp-server/        # Model Context Protocol stdio server for AI agents
├── packages/
│   └── shared/            # Shared TypeScript types, CRDT diffing, & Markdown rules
├── tests/                 # End-to-end convergence and adversarial stress tests
├── docker/                # Production Dockerfiles and PostgreSQL initialization SQL
└── docs/                  # Architecture specifications and improvement roadmap
```

---

## Testing & Quality Assurance

Glyphroom maintains an exhaustive automated test suite with **630+ passing tests** covering multi-user convergence, security invariants, API contracts, and web interactions:

```bash
# Run all workspace test suites
pnpm test:all

# Run individual test suites
pnpm test:api     # 70 tests passing (Fastify integration, RBAC, tamper audit)
pnpm test:web     # 113 tests passing (React components, tags, bookmarks, views)
pnpm test:tests   # 112 tests passing (10k-op convergence & turnkey deploy hardening)
pnpm test:shared  # 320 tests passing (CRDT diffing, schema validation, undo isolation)

# Typecheck all packages
pnpm typecheck    # 0 errors across all 6 packages
```

---

## Roadmap & Current Gaps

For the detailed engineering progress, refer to [FEATURE_IMPROVEMENT_PLAN.md](./docs/FEATURE_IMPROVEMENT_PLAN.md).

- [x] Immutable review submission checkpoints & state machine
- [x] Space administration, archiving, and owner removal safeguards
- [x] Server-side SQL catalog pagination and search filtering
- [x] Reader bookmarks and Saved Reading dashboard
- [x] Persistent post tags and taxonomy sync
- [x] In-app notifications with polling fallback
- [x] Operational Admin Console (User directory & PAT revocation)
- [ ] Markdown review diff viewer (visual unified / side-by-side)
- [ ] Server-Sent Events (SSE) stream for real-time notification pushes
- [ ] Full-text PostgreSQL `tsvector` ranked search projections
- [ ] Durable attachment lifecycle, relative storage, and orphan cleanup
- [ ] Enterprise SSO integration (SAML 2.0 / OIDC) *(Planned)*

---

## Contributing & License

Contributions, bug reports, and feedback are welcome! Please feel free to open an issue or submit a pull request.

Licensed under the **[Apache License, Version 2.0](./LICENSE)**.
