# Glyphroom

> **Self-hosted collaborative enterprise knowledge, technical documentation & status updates platform with real-time CRDT co-editing, team Spaces, and Model Context Protocol (MCP) AI co-authorship.**

[![Tests](https://img.shields.io/badge/tests-171%20passing-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)]()
[![CRDT](https://img.shields.io/badge/CRDT-Yjs%20%2B%20Hocuspocus-blueviolet.svg)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

---

## 1. What is Glyphroom?

**Glyphroom** is an open-source, self-hosted platform where engineering and product teams write, review, and organize project documentation and weekly status updates together.

It pairs **real-time conflict-free co-editing (Yjs CRDTs)** with an enterprise **Spaces and Access Model**, ensuring that internal team drafts stay strictly private within a project space until explicitly promoted to the company-wide knowledge library.

```
Company
  ├── Space: Payments Revamp       (Team members only)
  │    ├── Page: Project Architecture
  │    ├── Page: Weekly Status
  │    └── Page: Settlement Test Plan
  ├── Space: Platform Security     (Separate team, isolated)
  │    └── Page: Zero-Trust Threat Model
  └── Company Library              (Official, visible to all employees)
       └── Promoted pages from any space
```

---

## 2. Core Pillars

### 🔒 Spaces & Access Model
- **Spaces**: One space per team or initiative (like a project in GitLab). Space members can read, review, or write based on their role.
- **5 Deliberately Simple Roles**:
  - `Viewer`: Read pages in the space.
  - `Reviewer`: Read, comment, and suggest changes.
  - `Author`: Create and edit draft pages.
  - `Maintainer`: Manage pages, invite/remove members, and promote pages to the company library.
  - `Owner`: Maintainer permissions plus delete, archive, or transfer the space.
- **Page Guest Access**: Invite a colleague to a single page (View, Comment, or Edit) without exposing the rest of the space.
- **Invited Only Pages**: Lock sensitive documents (e.g. security vulnerabilities) to maintainers and explicitly named guests.

### 🚀 Three-Stage Content Promotion & Separation of Duties
Content progresses through three distinct stages:
1. **Working Draft** *(Team Only)*: Live collaborative drafting on Yjs CRDTs.
2. **Published to Space** *(Team Only)*: Approved version visible to all members of the space.
3. **Promoted to Company** *(All Employees)*: Verified official document visible in the global catalog and company search.

> **Separation of Duty**: Authors cannot promote their own pages to the company library; promotion requires review and action by a Space Maintainer or System Admin. After promotion, teams can continue editing drafts privately—the company sees the promoted snapshot until republishing.

### ⚡ Live Collaborative Editing (Yjs CRDT)
- **Zero Base64 in Yjs**: Canonical CRDT binary states stored directly in PostgreSQL `bytea` columns.
- **Real-Time WebSocket Sync**: Powered by Hocuspocus with sub-20ms broadcast latency.
- **Presence & Awareness**: Real-time multi-cursor tracking, collaborator name tags, and activity status.
- **Dual View Modes**:
  - **Document View**: Distraction-free, fluid reading and long-form prose.
  - **Block View**: Interactive section cards with quick cell additions, reordering (Move Up / Down), code cells, tables, and Mermaid architecture diagrams.

### 🤖 Model Context Protocol (MCP) AI Co-Editing
- Seamless integration with AI agents via Model Context Protocol (MCP).
- **Suggestion Mode**: AI edits are introduced as non-destructive suggestions (`suggestion_insert`, `suggestion_delete`) requiring human review and approval.
- **Personal Access Tokens (PATs)**: Individual users can issue hashed, scoped PATs (`read:posts`, `write:posts`, `suggest:posts`) to connect their local MCP servers or CLI agents safely.

### 🛡️ Enterprise Security & Governance
- **Break-Glass Local Auth & Corporate SSO**: Out-of-the-box local credentials with bcrypt and turnkey SSO integration.
- **Turnkey Auto-Migrations**: The API server inspects and upgrades schema tables (`ensureDatabaseSchema`) automatically upon startup—no manual migration scripts required on updates.
- **Tamper-Evident SHA-256 Audit Trail**: Every invite, promotion, role adjustment, and PAT generation is permanently recorded in a cryptographically verifiable audit chain.

---

## 3. Architecture & Monorepo Topology

```
glyphroom/
├── apps/
│   ├── web/               # React 18, Vite, Tailwind CSS, TipTap/ProseMirror UI
│   ├── api/               # Fastify, Drizzle ORM, PostgreSQL REST API, RBAC, Auto-Migrations
│   └── collab/            # Hocuspocus WebSocket CRDT server, PostgreSQL binary persistence
├── packages/
│   ├── shared/            # Shared types, CRDT validation, Markdown converters
│   └── mcp-server/        # Model Context Protocol server for AI agent integrations
└── docker/
    └── postgres/          # PostgreSQL database container with init.sql
```

---

## 4. Quickstart Guide

### Prerequisites
- **Node.js**: `v20.x` or higher
- **pnpm**: `v9.x` or `v10.x` (`corepack enable pnpm`)
- **PostgreSQL**: `v15` or higher (or Docker)

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/allwin-antony/Glyphroom.git
cd Glyphroom
pnpm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` in the root and in `apps/api` and `apps/collab`:
```bash
cp .env.example .env
```
Default connection string:
```env
DATABASE_URL=postgres://blogger:REPLACE_WITH_STRONG_PASSWORD_IN_PROD@localhost:5432/enterprise_blogger
PORT=4001
COLLAB_PORT=4000
WEB_PORT=3000
```

### 3. Start Database (Docker)
```bash
docker compose -f docker-compose.prod.yml up -d postgres
```

### 4. Seed Test Accounts & Spaces
```bash
pnpm --filter @enterprise-blogger/api tsx src/scripts/seed-test-users.ts
```

### 5. Start Development Servers
```bash
# Starts Web (3000), API (4001), and Collab (4000)
pnpm --filter @enterprise-blogger/api run dev
pnpm --filter @enterprise-blogger/collab run dev
pnpm --filter @enterprise-blogger/web run dev
```

Navigate to `http://localhost:3000` in your browser.

---

## 5. Seeded Test Accounts

The database includes pre-configured testing accounts with 1-click login buttons on the sign-in page:

> **Universal Test Password**: `admin2026!`

| Account | Email | System Role | Space Memberships | Capabilities |
| :--- | :--- | :--- | :--- | :--- |
| **Maya (Admin)** | `admin@enterprise-blogger.local` | System Admin | Global Access | Full system control, audit logs, spaces approval |
| **Arjun** | `arjun.maintainer@enterprise.internal` | Member | *Payments Revamp* (Owner) | Manage space members, promote team pages |
| **Priya** | `priya.sharma@enterprise.internal` | Member | *Payments Revamp* (Author) | Author drafts, cannot self-promote team pages |
| **Rahul** | `rahul.viewer@enterprise.internal` | Member | *Payments Revamp* (Viewer) | Read-only access to space pages |
| **Marcus** | `marcus.chen@enterprise.internal` | Moderator | *Platform Security* (Maintainer) | Review queue moderation, manage space |
| **Elena** | `elena.rostova@enterprise.internal` | Member | Standalone Author | Write independent pages, request spaces |

---

## 6. Testing

Glyphroom has comprehensive test suites covering CRDT convergence, RBAC security, API integration, and user interface workflows:

```bash
# Run all workspace test suites
pnpm test:all

# Or test individual services
pnpm test:web     # 111 tests passing
pnpm test:api     # 60 tests passing
pnpm test:collab  # Hocuspocus convergence tests
```

---

## 7. Open Source Licensing

Glyphroom is open-source software licensed under the **[MIT License](./LICENSE)**.

### Licensing Comparison & Options for Enterprise Deployments

| License | Best For | Commercial SaaS Protection | Enterprise Adoption Friction | Patent Grant |
| :--- | :--- | :---: | :---: | :---: |
| **MIT** *(Current)* | Maximum community adoption, developer freedom | None | Lowest (Instant IT Approval) | Implicit |
| **Apache 2.0** | Enterprise governance, trademark & patent defense | None | Low (Standard Corporate Pick) | **Explicit** |
| **AGPLv3** | Preventing cloud hyperscalers from offering closed SaaS | **Strong** (Network copyleft) | Medium (Some enterprise legal blocks) | Explicit |
| **BSL 1.1** *(Source Available)* | Building a commercial venture while keeping self-hosting free | **Full** (Restricts commercial SaaS) | Medium (Not strictly OSI-open) | Custom |

For corporate self-hosting and internal deployment, **MIT** and **Apache 2.0** provide the highest developer velocity and zero legal friction. If the goal is to build a commercial hosted cloud while keeping the on-premise version open, dual-licensing or **BSL 1.1 / AGPLv3** can be applied.

---

## 8. Contributing

Contributions, issues, and feature requests are welcome!
Feel free to check [issues page](https://github.com/allwin-antony/Glyphroom/issues).

---

© 2026 Allwin. Built with passion for open enterprise engineering.
