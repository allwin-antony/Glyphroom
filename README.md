# Glyphroom

Self-hosted technical documentation and engineering status updates with live Yjs co-editing, team-scoped Spaces, and Model Context Protocol (MCP) AI co-authoring.

Licensed under [Apache 2.0](./LICENSE).

---

## Why this exists

Most internal knowledge tools fail engineering teams in one of two ways:

1. **One shared wiki where everyone sees everything**: Teams avoid writing raw technical details, incident post-mortems, or in-flight design proposals because early drafts are visible company-wide.
2. **Siloed tools per team**: Knowledge ends up scattered across personal notes, Google Docs, Slack threads, and private repos. Nobody can find canonical architectural decisions or test plans.

Glyphroom uses a strict **Spaces & Promotion** model:

```
Company Network
  ├── Space: Payments Revamp           [Team members only]
  │    ├── Page: Gateway Architecture   (Working draft -> Published in Space)
  │    ├── Page: Weekly Status          (Published in Space)
  │    └── Page: Settlement Runbook     (Promoted to Company Library)
  │
  ├── Space: Platform Security         [Separate team, isolated]
  │    └── Page: Threat Model           (Invited-only: maintainers + security leads)
  │
  └── Company Library                  [Visible to all employees]
       └── Pages promoted from any Space by that space's maintainer
```

---

## Core Concepts

### 1. Spaces & Roles
Work lives inside a **Space** (owned by a team or initiative). A Space contains pages and members.

| Role | Permissions |
| :--- | :--- |
| **Viewer** | Read pages in the Space. |
| **Reviewer** | Read, comment, and submit reviews on pages in the Space. |
| **Author** | Create, edit, and maintain draft pages in the Space. |
| **Maintainer** | Edit all pages, invite/remove members, and **promote pages to Company Library**. |
| **Owner** | Maintainer rights plus space archive, rename, or deletion. |

### 2. Separation of Duties (Promotion Pipeline)
Content moves through three explicit stages:
1. **Working Draft**: Real-time collaborative drafting between team members.
2. **Published in Space**: Stable version accessible to everyone inside the Space.
3. **Promoted to Company**: Maintainer explicitly shares the document with the entire company. It appears in the global catalog and company search.

> **Rule**: An `Author` cannot self-promote their team space page to the company library. Promotion requires action from a `Maintainer` or system `Admin`. Once promoted, teams can continue editing their working draft privately without exposing work-in-progress edits to the rest of the company until republishing.

### 3. Page Guests & Invited-Only Documents
- **Page Guest**: A person can be invited to a single page (View, Comment, or Edit) without gaining visibility into the rest of the Space.
- **Invited-Only Page**: Sensitive documents (e.g. unpatched vulnerability reports or confidential post-mortems) can be flagged `invited_only`, restricting access exclusively to Space Maintainers and explicitly invited individuals.

### 4. Real-time Co-editing (CRDTs)
- **Zero Base64 in Yjs**: Canonical CRDT binary states are stored as raw binary in PostgreSQL `bytea` columns (`posts.yjs_state`), not JSON or base64 strings.
- **Hocuspocus WebSocket Engine**: Node-based WebSocket server (`apps/collab`) coordinates document awareness, cursor positions, and state vectors with sub-20ms broadcast latency.
- **Dual Presentation**:
  - **Document View**: Continuous reading and editing canvas.
  - **Block View**: Card-oriented notebook cells with reordering, code execution blocks, and Mermaid diagrams.

### 5. Model Context Protocol (MCP) AI Co-authoring
- Glyphroom exposes tools via MCP for local and autonomous AI agents.
- **Suggestion Mode**: AI edits cannot silently overwrite human text. Edits are recorded as non-destructive suggestions (`suggestion_insert` and `suggestion_delete` marks) that human authors accept or reject.
- **Personal Access Tokens (PATs)**: Scoped API tokens (`read:posts`, `write:posts`, `suggest:posts`) allow users to run local coding assistants against Glyphroom documents without sharing session cookies.

---

## Repository Structure

```
.
├── apps/
│   ├── web/               # React 18, Vite, TipTap/ProseMirror, Tailwind CSS
│   ├── api/               # Fastify, Drizzle ORM, PostgreSQL REST API, RBAC
│   └── collab/            # Hocuspocus CRDT WebSocket server with Postgres adapter
├── packages/
│   ├── shared/            # Common TypeScript types, CRDT diffing, markdown export
│   └── mcp-server/        # Model Context Protocol server for AI assistant integration
└── docker/
    └── postgres/          # PostgreSQL 15 schema initialization
```

---

## Getting Started

### Prerequisites
- Node.js 20+
- pnpm 9+ (`corepack enable pnpm`)
- PostgreSQL 15+ (local or via Docker)

### 1. Install dependencies
```bash
git clone https://github.com/allwin-antony/Glyphroom.git
cd Glyphroom
pnpm install
```

### 2. Configure environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Ensure `DATABASE_URL` points to your PostgreSQL instance:
```env
DATABASE_URL=postgres://blogger:REPLACE_WITH_STRONG_PASSWORD_IN_PROD@localhost:5432/enterprise_blogger
PORT=4001
COLLAB_PORT=4000
WEB_PORT=3000
```

### 3. Start database (Docker)
```bash
docker compose -f docker-compose.prod.yml up -d postgres
```

The database initializes automatically. The API server runs schema verification (`ensureDatabaseSchema`) on startup.

### 4. Seed demo users and spaces
```bash
pnpm --filter @enterprise-blogger/api tsx src/scripts/seed-test-users.ts
```

### 5. Start dev services
```bash
# Terminal 1: REST API (Port 4001)
pnpm --filter @enterprise-blogger/api run dev

# Terminal 2: Collaborative CRDT Server (Port 4000)
pnpm --filter @enterprise-blogger/collab run dev

# Terminal 3: Web UI (Port 3000)
pnpm --filter @enterprise-blogger/web run dev
```

Open `http://localhost:3000` in your browser.

---

## Seeded Test Accounts

All seeded accounts use password: `admin2026!`

The sign-in screen at `http://localhost:3000/signin` includes one-click buttons to autofill any of these test profiles:

| Name | Email | System Role | Space Role |
| :--- | :--- | :--- | :--- |
| **Maya (Admin)** | `admin@enterprise-blogger.local` | System Admin | System-wide admin access |
| **Arjun** | `arjun.maintainer@enterprise.internal` | Member | Owner / Maintainer of *Payments Revamp* |
| **Priya** | `priya.sharma@enterprise.internal` | Member | Author in *Payments Revamp* |
| **Rahul** | `rahul.viewer@enterprise.internal` | Member | Viewer in *Payments Revamp* |
| **Marcus** | `marcus.chen@enterprise.internal` | Moderator | Maintainer in *Platform Security* |
| **Elena** | `elena.rostova@enterprise.internal` | Member | Staff SRE (independent standalone drafts) |

---

## Testing

Glyphroom maintains automated test coverage across RBAC security, REST endpoints, UI interactions, and collaborative synchronization:

```bash
# Run all test suites
pnpm test:all

# Individual packages
pnpm test:web     # 111 tests passing (Vitest + React Testing Library)
pnpm test:api     # 60 tests passing (Fastify integration + RBAC + Audit chain)
pnpm test:collab  # Hocuspocus CRDT sync and document lifecycle tests
```

---

## Architectural Decisions & Constraints

- **Yjs as Source of Truth**: Document content is stored as Yjs binary updates in `posts.yjs_state`. Derived Markdown (`published_markdown`, `working_markdown`) is generated on document save to support full-text search indexing (`tsvector`) without decoding binary CRDTs during search queries.
- **View Counter Decoupling**: View counts are tracked in an in-memory ring buffer (`BufferedViewCounter`) and periodically flushed to PostgreSQL in batches to prevent write-lock contention on popular posts.
- **Audit Logging**: Sensitive governance events (space member additions, promotions to company library, role updates, PAT creations) write to an immutable audit table with SHA-256 integrity hashes.
- **Air-gap Capability**: Glyphroom relies solely on Node.js and PostgreSQL. It has zero mandatory SaaS dependencies, external font calls, or third-party tracking scripts.

---

## License

Licensed under the [Apache License, Version 2.0](./LICENSE).
You may obtain a copy of the License at:

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
