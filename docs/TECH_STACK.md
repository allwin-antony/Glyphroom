# Enterprise Blogger 2.0 — Technology Stack

> **Rev 3** | See [README.md](README.md) for the full document index.

---

## Core Principle

Every choice below is justified by one of three criteria:
1. **Correctness** — it solves the actual problem (e.g., Yjs for CRDTs, not a patched OT library).
2. **Air-gap safety** — it installs from standard npm/pnpm with no binary GitHub dependencies or mandatory external services.
3. **Maintainability** — the team can understand, debug, and fork it within the corporate boundary.

---

## Project Layout (pnpm Monorepo)

```
Enterprise_Blogger/
├── apps/
│   ├── web/          # Vite + React 19 SPA (TipTap editor, catalog UI)
│   ├── api/          # Fastify REST API (auth, search, reviews, admin)
│   ├── collab/       # Hocuspocus collaboration server + Agent Gateway
│   └── mcp-server/   # Model Context Protocol server
├── packages/
│   └── shared/       # Zod schemas, TypeScript types, constants shared across apps
├── docs/             # This documentation
├── legacy_docs/      # Scrapped v1 Django implementation reference
├── docker/
│   ├── docker-compose.yml
│   ├── Dockerfile.web
│   ├── Dockerfile.api
│   ├── Dockerfile.collab
│   ├── Dockerfile.mcp
│   └── nginx.conf
└── pnpm-lock.yaml    # Pinned at Phase 0 spike; do not upgrade without running fixtures
```

---

## Stack Choices by Layer

### Frontend — `apps/web/`

| Technology | Choice | Justification |
|---|---|---|
| Build tool | **Vite 6** | Sub-second HMR in development; optimized chunked static output served directly by Nginx — no Node.js server in the production critical path |
| UI framework | **React 19** | Server Actions available but not required; concurrent rendering for smooth real-time update batching |
| Styling | **Tailwind CSS v4 + Shadcn UI** | Zero-runtime utility CSS; accessible, unstyled primitives that match the corporate design language |
| Routing | **React Router v7** | Nested layouts; file-based convention available if desired |
| Rich text editor | **TipTap v3** *(or v2, decided in Phase 0 spike)* | Headless ProseMirror wrapper with first-class Yjs collaboration extension; strongest Markdown round-trip story in its class |
| Real-time sync | **`yjs` + `@hocuspocus/provider`** | CRDT-correct; `@hocuspocus/provider` manages WebSocket reconnection, awareness, and sync protocol |
| Server state | **TanStack Query v5** | Stale-while-revalidate for catalog, search, and metadata; pairs cleanly with optimistic updates |
| Client state | **Zustand** | Minimal, no boilerplate; replaces the Redux Toolkit + Redux Persist setup from v1 |
| XSS sanitization | **DOMPurify** | Applied to every Markdown → DOM path, KaTeX output, and Mermaid SVG output |
| Diagrams | **Mermaid.js** (strict security level) | Initialized with `securityLevel: 'strict'`; sandboxed in an isolated div |
| Math | **KaTeX** | Server-side rendering option available; `trust: false` |
| API client | **ky** | Tiny, Fetch-based; handles CSRF headers and 401 retry with fresh cookie session |

**Why a static SPA over Next.js SSR?**
A Next.js server would consume an additional ~200 MB of runtime memory and add a Node.js process to the critical path for every page load. The catalog, editor, and admin pages are all authenticated-only views with no SEO requirement, so server-side rendering provides no benefit. Static assets served by Nginx (with Brotli compression and aggressive `Cache-Control` headers) load faster with less infrastructure.

---

### API Server — `apps/api/`

| Technology | Choice | Justification |
|---|---|---|
| Runtime | **Node.js 22 LTS** | Stable, long-term support, consistent with the rest of the stack |
| Framework | **Fastify v5** | Schema-compiled JSON serialization via `fast-json-stringify`; ~3–5× faster than Express at equivalent middleware depth; first-class TypeScript support |
| ORM | **Drizzle ORM** | Generates type-safe SQL queries; no hidden N+1; schema-as-code with migrations; works directly with PostgreSQL's `tsvector`, `bytea`, and `jsonb` types |
| Validation | **Zod** | Shared schemas in `packages/shared`; used at API boundary, MCP tool inputs, and database read mapping |
| Auth | **`@hono/oidc-auth` patterns / custom OIDC handler** | JIT provisioning from claims; adapter pattern for Entra ID, Okta, Keycloak; break-glass local admin via bcrypt + HTTP-only cookie |
| Sessions | **HTTP-only, Secure, SameSite=Strict cookies** | CSRF token required on all mutations; no `localStorage` tokens (lesson from v1) |
| Search | **PostgreSQL `tsvector` + `pg_trgm`** | No separate search process; GIN-indexed full-text ranking plus trigram substring similarity native to PostgreSQL 16 |
| File uploads | **`@fastify/multipart`** | Streams to local volume or S3-compatible storage; MIME signature verification before writing |
| Rate limiting | **`@fastify/rate-limit`** | Per-route, per-IP; agent routes have tighter limits |

---

### Collaboration Server — `apps/collab/`

| Technology | Choice | Justification |
|---|---|---|
| CRDT engine | **Yjs** | Industry-standard; zero-conflict merge for ProseMirror document trees; binary compact state encoding |
| Collaboration server | **Hocuspocus** (latest stable, pinned in Phase 0) | Official Yjs server framework; lifecycle hooks (`onAuthenticate`, `onLoadDocument`, `onChange`, `onStoreDocument`); direct connection API |
| WebSocket transport | **`ws`** (standard npm package) | Installs from npm; no C++ toolchain; no GitHub binary dependency; air-gap safe. `uWebSockets.js` deferred unless Phase 6 shows `ws` is the measured bottleneck |
| Redis adapter | **`@hocuspocus/extension-redis`** | Disabled by default; enabled when `REDIS_URL` is set; required only for multi-node clustering |
| Postgres persistence | **`@hocuspocus/extension-database`** (custom handler) | `onLoadDocument`: reads `yjs_state` from `posts`; `onStoreDocument`: debounced write (3 s), compacted with `Y.encodeStateAsUpdate`, Markdown derived and cached |
| Snapshot compaction | **`Y.encodeStateAsUpdate`** | Stores the full state vector in one compact buffer; `Y.mergeUpdates` used only if an incremental update log is introduced later |
| Agent Gateway | **Fastify HTTP endpoint** (private network only, no external exposure) | Accepts agent edit requests from the MCP server; executes `openDirectConnection` in-process against the live Hocuspocus instance; protected by mutual service credential + forwarded PAT |

**Yjs version pinning**: All of `yjs`, `y-prosemirror`, `@hocuspocus/server`, and `@hocuspocus/provider` are pinned to the exact set validated by the Phase 0 spike fixtures. They must all be upgraded together after running the full convergence test suite.

---

### MCP Server — `apps/mcp-server/`

| Technology | Choice | Justification |
|---|---|---|
| SDK | **`@modelcontextprotocol/sdk`** | Official TypeScript MCP SDK; supports SSE, HTTP streaming, and stdio transports |
| Transport | **SSE + HTTP** (for Claude Desktop, Cursor, corporate LLMs) and **stdio** (for scripted agents) | Both modes supported from the same server |
| PAT validation | Verified against `personal_access_tokens` table via the API service; scope intersection with owner's RBAC enforced | An agent cannot exceed its owner's permissions |
| Agent Gateway client | Internal HTTP call to Collab service Agent Gateway | Never writes to the database directly; always routes through the single write authority |

### MCP Tools

| Tool | Minimum Scope | Description |
|---|---|---|
| `search_posts` | `posts:read` | Full-text + trigram search within the token owner's visibility |
| `get_post` | `posts:read` | Returns post content and metadata in `markdown` or `summary` format |
| `create_post` | `posts:draft` | Always creates a `draft`; never directly publishes |
| `append_section` | `posts:draft` | Adds new sibling nodes after a target section; direct apply on drafts the owner can edit |
| `insert_after_section` | `posts:draft` | Same as append but with explicit anchor targeting |
| `suggest_edit_section` | `posts:suggest` | Applies replacement as suggestion marks (diff-based); **no coarse block replace exists** |
| `add_comment` | `comments:write` | Adds a comment or reply to a post |
| `publish_post` | `posts:publish` (admin-granted only) | Requires human-approved review workflow before taking effect |

---

### Database — PostgreSQL 16

| Feature | Usage |
|---|---|
| `bytea` | Yjs binary state storage (`yjs_state`, `yjs_state_snapshot`) |
| `tsvector` + GIN | Full-text search on published and working content (`search_vector`, `working_search_vector`) |
| `pg_trgm` + GIN | Trigram substring similarity on title and excerpt |
| `jsonb` | Comment Yjs relative position anchors (`yjs_anchor_start`, `yjs_anchor_end`), audit log `metadata`, PAT scopes |
| `INSERT` only on `audit_logs` | Application role has no `UPDATE` or `DELETE` on this table |
| `CHECK` constraint | `reviewer_id != author_id` on `post_reviews` |

---

### Infrastructure

| Component | Technology | Notes |
|---|---|---|
| Reverse proxy | **Nginx** | Static SPA hosting with Brotli, WebSocket upgrade, rate limits, CSP headers |
| Container orchestration (v1) | **Docker Compose** | Single-file `docker-compose.yml`; all images from standard registries |
| Container orchestration (future) | **Kubernetes** | Helm chart to be added post-v1 |
| Cache / pub-sub (optional) | **Redis 7 Alpine** | AOF persistence; enabled via `REDIS_URL` env var only |
| Object storage (optional) | **Local bind-mount → S3-compatible** | MinIO requires legal review (AGPL-3.0); evaluate Garage (MIT) or SeaweedFS (Apache 2.0) as alternatives |
| Virus scanning (optional) | **ClamAV** | Attachment quarantine until `clean` scan; sidecar container |
| Metrics | **Prometheus + Grafana** | Standard Fastify metrics plugin + custom Hocuspocus room gauges |
| Tracing | **OpenTelemetry** | Correlation IDs on all log lines and API responses |
| Structured logging | **`pino`** | JSON output; log levels and correlation IDs in every service |
| Testing | **Vitest** | Unit, integration, and headless Yjs CRDT convergence tests |
| Load testing | **k6** with headless Yjs clients | Measures p95 latency, broadcast time, and memory per open room |
| CI | Internal runner (air-gapped) | Pinned lockfile check, test suite, image scan |

---

## Explicit Exclusions

| Excluded | Reason |
|---|---|
| Next.js SSR | Unnecessary Node.js runtime in the critical path for authenticated-only views with no SEO requirement |
| `uWebSockets.js` | Installs from GitHub (not npm); requires C++ compiler; incompatible with air-gapped npm mirrors. Re-evaluate if Phase 6 shows `ws` is the measured bottleneck |
| MinIO (as default) | AGPL-3.0 community edition requires legal review before adoption; local volume is the default |
| Elasticsearch / MeiliSearch | Unnecessary memory overhead; PostgreSQL GIN + trigram search is sufficient at enterprise-internal scale |
| Redux Toolkit | Replaced by TanStack Query (server state) + Zustand (client state); no boilerplate, no persisted reducer sprawl |
| Quill Delta | Replaced by TipTap ProseMirror; proper CRDT tree structure instead of flat Delta ops |
| `localStorage` JWT tokens | Replaced by HTTP-only cookies (lesson from v1 security review) |
| Django / Python backend | Replaced in full; the Yjs/CRDT problem is native to JavaScript/TypeScript and requires in-process document access |
