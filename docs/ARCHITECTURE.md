# Enterprise Blogger 2.0 — Architecture

> **Rev 3** | See [README.md](README.md) for the full document index.

---

## 1. High-Level Topology

```
Browser (TipTap + Yjs)  ──WSS──►  Nginx  ──►  Collab service (Hocuspocus)
AI Agent (MCP client)   ──HTTP──► Nginx  ──►  MCP server ──internal HTTP──► Agent Gateway (inside Collab)
Browser / API client    ──HTTPS─► Nginx  ──►  API service (Fastify)

Collab service: in-memory Y.Doc authority → snapshots → PostgreSQL
API service:    REST, SSO/sessions, RBAC, search, reviews, admin, audit
PostgreSQL 16:  all durable state (Redis and object storage are optional add-ons)
```

### Service Responsibilities

| Service | Role |
|---|---|
| **Nginx** | TLS termination, Brotli-compressed static hosting for the Vite SPA, WebSocket upgrade (`Upgrade: websocket`), per-route rate limits, security headers (CSP, HSTS, X-Frame-Options) |
| **API (Fastify + Drizzle)** | REST endpoints, SSO + session management, RBAC middleware, full-text search, review workflow, audit log writer, PAT management |
| **Collab (Hocuspocus + `ws`)** | Single authoritative write path for all document content; `onAuthenticate`, `onLoadDocument`, `onChange` (debounced flush), `onStoreDocument` hooks; **Agent Gateway** HTTP endpoint |
| **MCP Server** | Validates Personal Access Tokens, enforces tool scopes, translates MCP tool calls into authenticated Agent Gateway requests |
| **PostgreSQL 16** | All relational and document data: Yjs snapshots, version milestones, full-text and trigram search vectors, reviews, audit chain |
| **Redis** *(optional)* | Pub/sub adapter for Hocuspocus only when horizontal clustering is enabled via `REDIS_URL`; disabled by default |
| **Object Storage** *(optional)* | Attachments behind an S3-style interface; defaults to a local bind-mount volume |

---

## 2. Key Design Decisions

### D1 — Single Source of Truth: Yjs ProseMirror Document Tree
The Yjs document is the **canonical state** of a post. Markdown and HTML are **derived exports only** — they are never used as inputs to the persistence layer. This is the lesson from the legacy system's lossy Quill Delta ↔ JSON ↔ string chain.

### D2 — Single Write Path via Agent Gateway (Process Boundary Resolved)
`hocuspocus.openDirectConnection()` only works inside the Hocuspocus process. The MCP server is a **separate process/container**, so it cannot call `openDirectConnection` directly.

**Solution**: The Collab service exposes a private **Agent Gateway** — an HTTP endpoint bound only on the Docker/K8s internal network, protected by a mutual service credential plus the forwarded PAT identity. The gateway receives an agent edit request, then calls `openDirectConnection` in-process against the live Hocuspocus instance.

**Effect**: There is exactly one write path for document content whether the room is idle or has 30 active human editors. The MCP server can restart, crash, or be scaled independently without any risk of split-brain state.

**Fallback during Phase 0 spike**: If the internal HTTP gateway proves awkward for presence awareness, the fallback is a headless `HocuspocusProvider` WebSocket client connecting from the MCP server. The spike **must** verify that agent awareness (cursor/name) is visible in the browser with whichever approach is chosen before Phase 1 begins.

### D3 — WebSocket Library: Standard `ws`
`uWebSockets.js` is excluded. It installs from GitHub (not npm), requires a C++ toolchain, and breaks deterministic air-gapped builds. The standard `ws` package is more than sufficient at enterprise-internal concurrency levels. Swap only if Phase 6 load tests show `ws` as the actual bottleneck — which is unlikely.

### D4 — Redis: Off by Default
Single-node deployments use Hocuspocus's in-memory adapter. Redis pub/sub is enabled only when `REDIS_URL` is set and a second Collab instance starts.

### D5 — Object Storage: Local Volume First
The default attachment target is a local bind-mount directory with an S3-compatible abstraction layer. **MinIO is AGPL-3.0 (community edition)** — legal must review before it is listed as a default. Alternatives to evaluate: **Garage** (MIT) and **SeaweedFS** (Apache 2.0). The storage interface is decoupled so the backing implementation is swappable.

### D6 — Dependency Versions: Pinned in Phase 0 Spike
Target **TipTap v3** if its collaboration extension and current Hocuspocus compatibility pass the round-trip fixtures (tables, alerts, KaTeX, Mermaid). Stay on v2 otherwise. All of `hocuspocus`, `yjs`, and `y-prosemirror` are pinned together to matching tested versions. The spike produces a locked `pnpm-lock.yaml` that becomes the canonical version set for all subsequent phases.

### D7 — Yjs Snapshot Storage
Store `Y.encodeStateAsUpdate(doc)` — the full state in a single compact binary. This is already compact for typical document sizes. `Y.mergeUpdates` is used only if an incremental update log is introduced later. Always flush on graceful service shutdown so no in-flight edits are lost.

### D8 — Roles
Four global roles everywhere: **`admin`**, **`moderator`**, **`author`**, **`reader`**. The name `super_admin` from previous drafts is retired and must not appear in schema, code, or UI strings.

---

## 3. Document State Model

A post has two orthogonal states: a **working copy** (always editable) and a **published snapshot** (immutable, reader-facing).

| Field on `posts` | Meaning |
|---|---|
| `yjs_state` | Canonical CRDT working state (binary) |
| `working_markdown` | Derived from working state; refreshed on each debounced flush; visible to editors only |
| `published_version_id` | FK to the `post_versions` row that readers currently see |
| `published_markdown` | Derived export of the published snapshot; stable until republished |
| `search_vector` | GIN tsvector built from the **published** snapshot — what public search indexes |
| `working_search_vector` | GIN tsvector built from the **working** state — what draft search indexes |

### Export Rules for Suggestion Marks

When generating any output intended for readers, search indexes, or version snapshots:
- **Pending insertions** (agent `suggestion-insert` marks not yet accepted) → **dropped entirely**
- **Pending deletions** (agent `suggestion-delete` marks not yet accepted) → **kept as original text**

Unreviewed AI-suggested text must **never** reach readers, the public search index, or published snapshots.

### Post Lifecycle

```
draft ──submit──► in_review ──changes_requested──► draft
                           └──approved──► published ──► archived
                                          (working copy continues; republish creates new version)
```

| Status | Meaning | Allowed transitions |
|---|---|---|
| `draft` | Being written; visible only to author and collaborators | `in_review` |
| `in_review` | Submitted; locked from structural edits during review | `draft` (changes requested), `approved` |
| `approved` | Review passed; not yet visible to all readers | `published` |
| `published` | Live; a snapshot version exists in `post_versions` | `archived`; edits continue in working copy and republish as new version |
| `archived` | Hidden from readers; retained for reference | `draft` |

> [!IMPORTANT]
> Editing a published post **never changes what readers see** until a human approves and explicitly republishes. Agent edits to any published post always land as pending **suggestions** in the working copy — never as direct live changes.

---

## 4. Permissions and Access Control

### Global Roles

| Role | Capabilities |
|---|---|
| `admin` | Everything: user management, role assignment, taxonomy, audit log, system config |
| `moderator` | Review, approve, archive, manage taxonomy (COE, tags), feature posts |
| `author` | Create and own posts, collaborate on invited posts, upload assets, comment |
| `reader` | Read published posts, comment, bookmark |

### Per-Post Collaborator Permissions (`post_collaborators`)

| Permission | Meaning |
|---|---|
| `edit` | Full editor access to the working copy (implicit for the post author) |
| `review` | Can read the working copy and write review comments; read-only WebSocket connection |
| `view` | Read-only access to the working copy |

### WebSocket Handshake Rules
The `onAuthenticate` hook enforces **all** of these before accepting a connection:

1. **Origin allow-list check**: Prevents cross-site WebSocket hijacking when using cookie-based sessions. Only connections from `https://blog.corp.internal` (or configured origin) are accepted.
2. **Credential check**: Valid session cookie **or** a valid unexpired/unrevoked PAT.
3. **Per-document permission check**: Resolves role + collaborator permission. `review` and `view` connections are opened as **read-only** Yjs providers.

### Live Revocation
When any of the following events occur, an internal event bus message is published:
- Admin deactivates a user
- Admin changes a user's role
- A collaborator entry is removed from a post
- A PAT is revoked
- A session expires

The Collab service handles these events and sends a WebSocket close frame (`4403 Forbidden`) to all matching open connections. PAT expiry is also checked on a periodic heartbeat on open sockets (every 60 seconds).

### Agent Permission Boundaries
- A PAT's effective rights are the **intersection** of its declared scopes and its owner's current RBAC rights. An agent can never see or do more than its human owner.
- **Reviewer ≠ Author**: enforced at the database level via a `CHECK` constraint on `post_reviews`. An agent acting on behalf of an author cannot approve or review its owner's post.
- Draft visibility in search uses the **same permission function** as the WebSocket handshake so the two cannot drift independently.

---

## 5. Agent Co-Editing Architecture

### 5.1 The Problem with Coarse Block Replace
If an agent deletes and reinserts a block while a human is typing inside it, the human's concurrent characters are attached to nodes that are deleted by the replace operation — keystrokes are silently lost.

**Solution**: Agents never perform coarse replace operations. All agent edits are either:
1. **Appends / inserts** (new sibling nodes after a target section anchor) — safe, additive.
2. **Fine-grained suggestion diffs** — targeted inline mutations applied as ProseMirror marks.

### 5.2 Suggestion / Track-Changes Mode

Agent edits produce `suggestion-insert` and `suggestion-delete` marks carrying:
- `agentId`, `tokenId`, `ownerUserId` — for attribution display and audit
- `timestamp` — for staleness detection (> 30 days → flagged)

Visual behavior in the browser:
- `suggestion-insert`: green highlighted text with "AI Suggestion" badge
- `suggestion-delete`: red strikethrough with the original text visible
- Bubble menu: **Accept** / **Reject** per hunk; moderators can **Accept All** / **Reject All**

### 5.3 Conflict-Safe Concurrent Editing

- **Typing inside a pending insertion** edits the suggested text and keeps it pending — no conflict.
- **Typing inside a pending deletion** auto-rejects that deletion hunk, preserving the human's text — no silent overwrite.
- **Undo isolation**: `y-prosemirror UndoManager` tracks only transactions with a `human` origin tag. `Ctrl+Z` never reverts agent edits. Agents are rejected explicitly via the Accept/Reject UI.

### 5.4 Durable Attribution

Transaction origins (`{ type: 'agent', agentId, tokenId, ownerUserId }`) exist only in memory and are not stored in the Yjs binary state. Durable attribution comes from two sources:
1. **Suggestion marks** embedded in the ProseMirror document (agentId, tokenId, ownerUserId, timestamp)
2. **Audit log entry** for every agent action, recording the same identity

Accepted suggestion text retains an `attribution` attribute in the ProseMirror schema so that "who wrote this — human or agent?" can be answered after the fact.

### 5.5 Prompt Injection Defense (Structural)
The real defenses are structural — not just rate limits:

1. **Draft-only default**: PATs default to `posts:draft` + `posts:suggest`. Agents cannot publish without explicit admin-granted `posts:publish` scope.
2. **Suggestion mode**: Agent text is never live in the published view until a human accepts it.
3. **No direct publish without a human gate**: Even with `posts:publish` scope, a human moderator must approve the post through the review workflow before it goes live.
4. **Reviewer ≠ Author**: An agent cannot approve its own owner's post.
5. **Agent's vision is bounded by owner's permissions**: An agent cannot read posts its owner cannot see — so it cannot be tricked into exfiltrating restricted content.
6. **Treat all content returned to agents as untrusted**: Tool outputs are labeled as `content_from_user_post` in MCP tool schemas; agents must treat them as adversarial input.

Rate limits (e.g., 5 agent publishes per day) and MFA on token creation are **secondary** hardening, not the primary defense.

---

## 6. Security Hardening

### Authentication & Sessions
- OIDC and SAML 2.0 from day one (Microsoft Entra ID, Okta, Keycloak), with JIT account provisioning from claims.
- A break-glass local admin account (bcrypt-hashed password, MFA required).
- Sessions: HTTP-only, Secure, SameSite=Strict cookies; CSRF token required on all state-changing REST routes.

### Content Security Policy
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  connect-src 'self' wss://blog.corp.internal;
  font-src 'self' data:;
  frame-ancestors 'none'
```
> [!NOTE]
> `'unsafe-inline'` for `style-src` is a documented tradeoff required by ProseMirror and KaTeX inline style injection. Do **not** add `'unsafe-eval'` or a wildcard `https:` / `wss:` to `connect-src` — a wildcard `connect-src` would permit exfiltration of post content to any HTTPS endpoint.

### XSS Sanitization
- All rendered Markdown, KaTeX, and Mermaid output is sanitized on the client with **DOMPurify** before insertion into the DOM.
- Server-side: **rehype-sanitize** on any Markdown-to-HTML pipeline (search previews, PDF export, email notifications).
- Mermaid: initialized in **strict security level** (`securityLevel: 'strict'`).
- KaTeX: rendered with `trust: false`.
- Attachments: served from a separate origin or always with `Content-Disposition: attachment` to prevent inline script execution.

### Attachment Security
- MIME type allow-list enforced server-side (not just Content-Type header — actual file signature check).
- File size limits per upload and per post.
- Optional ClamAV integration: uploaded files land in a `scan_status: 'pending'` quarantine and are only downloadable after a `clean` scan result.

### Supply Chain
- Pinned lockfiles (`pnpm-lock.yaml`).
- Internal npm mirror for air-gapped environments.
- Container image scanning in CI (e.g., Trivy).

### Audit Immutability
- The application database role has `INSERT` only on `audit_logs` — no `UPDATE` or `DELETE`.
- Each row stores a SHA-256 hash chained to the previous row's hash (hash chain).
- The latest chain hash is exported periodically to an external write-once store for tamper evidence.

---

## 7. Turnkey Production Server Deployment

To ensure effortless deployment on an internal company Linux VM / server (Ubuntu, RHEL, Debian, Rocky Linux):

### 1. Zero Host Toolchain Dependencies
The target server **only needs Docker and Docker Compose installed**. It does not require Node.js, pnpm, Python, PostgreSQL, or compiler toolchains on the host operating system. All build artifacts, runtimes, and dependencies are encapsulated inside multi-stage Docker containers.

### 2. Single-Command Launch
```bash
# 1. Clone repository or extract release tarball on the server
git clone <internal-repo-url> /opt/enterprise-blogger
cd /opt/enterprise-blogger

# 2. Configure environment (copy template with sensible defaults)
cp .env.production.example .env.production
nano .env.production  # Set APP_URL, JWT_SECRET, and optional SSO credentials

# 3. Launch the complete platform
./scripts/deploy.sh
```
`./scripts/deploy.sh` executes:
- Environment variable validation
- `docker compose -f docker-compose.prod.yml up -d --build`
- Waits for health checks (`/healthz`) on PostgreSQL, Fastify API, and Collab services
- Outputs operational URLs, default break-glass admin credentials (if first boot), and log streaming commands

### 3. Self-Bootstrapping Database Migrations
On startup, the API container's entrypoint runs:
```bash
pnpm drizzle-kit migrate
```
Database schema migrations apply automatically in-order before traffic is routed, completely eliminating manual SQL scripting during initial deployment or subsequent version upgrades.

### 4. Production Service Topology
```yaml
services:
  nginx:       # Port 80/443: TLS, Brotli static frontend, WebSocket upgrade, security headers
  api:         # Internal port 3000: Fastify REST API, SSO, search, auto-migrating DB runner
  collab:      # Internal port 4000: Hocuspocus real-time engine & Agent Gateway
  mcp-server:  # Internal port 5000: Model Context Protocol SSE/HTTP service
  postgres:    # PostgreSQL 16 with pg_trgm (persisted to ./data/postgres)
  # Optional: redis (for multi-node scaling), clamav (attachment virus scanning)
```

### 5. Automated Host Restart Recovery (systemd)
A single helper command installs a standard `systemd` service:
```bash
./scripts/install-systemd.sh
```
Ensures Enterprise Blogger restarts automatically if the physical server reboots or crashes (`Restart=always`).

