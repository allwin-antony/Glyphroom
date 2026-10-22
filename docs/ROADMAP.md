# Enterprise Blogger 2.0 — Roadmap & Implementation Plan

> **Rev 3** | See [README.md](README.md) for the full document index.  
> Estimates assume **3–4 engineers**. Re-baseline at the Phase 0 gate.

---

## Build vs. Buy Decision

| Option | License | Assessment |
|---|---|---|
| **Docmost** | AGPL-3.0 | Uses TipTap + Yjs + NestJS, modern UI. **AGPL-3.0 copyleft**: many enterprise legal teams reject this outright. No native MCP support, no agent suggestion-mode. |
| **Outline** | BSL 1.1 (source-available) | Polished, strong permissions. BSL restricts **offering the software as a hosted service to third parties**. Internal employee use is typically permitted, but **legal must read the exact grant** before any fork. Forking its collaboration layer for agent co-editing means carrying and maintaining the fork indefinitely. |
| **Enterprise Blogger 2.0 (custom)** | Internal / MIT | Exact workflow fit, native agent co-editing, no license friction. Higher initial build cost. |

**Decision: Build custom** on TipTap + Hocuspocus + Fastify + PostgreSQL.

**Rationale**: Agent co-editing in suggestion mode, with live presence and lossless CRDT convergence, is the core differentiator. Neither Docmost nor Outline expose a stable internal hook for routing agent edits through a single in-process `openDirectConnection` write path, and modifying either would mean forking the collaboration core — at which point you are maintaining a fork *and* paying license compliance costs.

**Fallback trigger**: If the Phase 0 spike shows the bridge is materially harder than estimated, run a **2-day fork evaluation** of Outline (BSL) before committing to full custom. Do not skip the legal review regardless of which path is chosen.

---

## Phase 0 — Spike (De-Risk First) · 2 weeks

> [!IMPORTANT]
> This phase produces a **Go / No-Go gate**. No production code is written until the criteria below are all met (or the fallback path is activated).

### Objectives

1. **Agent Gateway approach**: Decide between the internal HTTP gateway pattern (MCP server calls Collab service Agent Gateway, which calls `openDirectConnection` in-process) and the headless `HocuspocusProvider` WebSocket client fallback. Verify that **agent cursor/name appears in the browser** with the chosen approach — awareness state is not automatic for all connection types.

2. **Concurrent convergence test**: Randomized test: 5 headless human Yjs clients + 1 headless agent client; 10,000 random operations including disconnects and reconnects; assert identical final state on every client with zero lost operations.

3. **Suggestion-mode correctness**: `suggest_edit_section` on 20 representative post sections (short paragraph, long paragraph, nested list, table, code block). Verify:
   - Suggestion marks applied correctly.
   - A human typing concurrently inside the same block loses no keystrokes.
   - `Ctrl+Z` does **not** revert agent edits (UndoManager origin filter confirmed).

4. **ProseMirror round-trip fixtures**: Tables, GitHub-style alerts, KaTeX math, Mermaid diagrams, and fenced code blocks round-trip losslessly through the ProseMirror JSON schema. Lossy Markdown edges are documented explicitly.

5. **Export rule validation**: Pending agent `suggestion-insert` marks are absent from `working_markdown` derived output; `suggestion-delete` marks preserve original text.

6. **Version pinning**: Produce a locked `pnpm-lock.yaml` with exact versions of `yjs`, `y-prosemirror`, `@hocuspocus/server`, `@hocuspocus/provider`, and `tiptap`. TipTap version (v2 vs v3) decided here based on collaboration extension compatibility.

7. **TipTap paid extensions assessment**: Evaluate whether TipTap's paid `Comments` and `Track Changes` extensions would cover the suggestion-mode requirement. If adopting them, verify pricing, license terms, and air-gap compatibility before Phase 1.

### Go / No-Go Criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Agent Gateway or headless provider chosen; agent presence visible in browser | ⬜ |
| 2 | 10,000-op convergence test passes with zero divergence | ⬜ |
| 3 | `suggest_edit_section` correct on 20 samples; human loses no keystrokes | ⬜ |
| 4 | `Ctrl+Z` demonstrably never reverts agent edits | ⬜ |
| 5 | ProseMirror round-trip: tables, alerts, KaTeX, Mermaid, code pass; lossy edges documented | ⬜ |
| 6 | Pending agent insertions absent from derived export; deletions retain original text | ⬜ |
| 7 | `pnpm-lock.yaml` produced; TipTap version locked | ⬜ |

**If gate fails on criterion 1–3**: Run the 2-day Outline fork evaluation before committing to full custom build. Ship v1 with agents restricted to draft creation and section append only (no suggestion mode) while the bridge is reworked.

---

## Phase 1 — Foundation · 3 weeks

| # | Task | Exit criteria |
|---|---|---|
| 1.1 | Initialize pnpm monorepo: `apps/web`, `apps/api`, `apps/collab`, `apps/mcp-server`, `packages/shared` | `pnpm build` passes all workspaces |
| 1.2 | Docker Compose: PostgreSQL 16 (with `pg_trgm`), Nginx, local object storage volume | `docker compose up` produces a healthy stack |
| 1.3 | Drizzle ORM schema: all tables from `DATA_MODEL.md`; migrations and seed scripts | Schema applied; `CHECK` constraints verified |
| 1.4 | Day-1 SSO: OIDC adapter (Entra ID, Okta, Keycloak); JIT provisioning; break-glass local admin | Login via test IdP; JIT user created in DB |
| 1.5 | RBAC middleware: `admin`, `moderator`, `author`, `reader`; per-post collaborator permission resolver | RBAC unit test matrix passes |
| 1.6 | Audit log chain: `INSERT`-only DB role; SHA-256 hash chain; export cron | Tamper test: modifying a row breaks the chain |
| 1.7 | Session security: HTTP-only SameSite=Strict cookies; CSRF protection on all mutations | Automated CSRF test passes |

---

## Phase 2 — Editor & Collaboration · 4 weeks

| # | Task | Exit criteria |
|---|---|---|
| 2.1 | Hocuspocus server with `ws`; `onAuthenticate` (Origin allow-list, JWT/PAT, per-document permission) | Unauthenticated and wrong-Origin connections rejected |
| 2.2 | PostgreSQL persistence hooks (`onLoadDocument`, `onStoreDocument`); debounced 3 s flush; graceful-shutdown flush | Kill collab mid-edit; restart; document fully recovered |
| 2.3 | Yjs relative position anchoring for comments; derive and cache `working_markdown` on each flush | Comment anchor resolves correctly after concurrent edits |
| 2.4 | TipTap editor: GFM Markdown shortcuts, Excel-style tables, syntax-highlighted code blocks, KaTeX, Mermaid (strict security level), GitHub-style alerts, slash command menu | All Phase 0 round-trip fixtures pass against the live editor |
| 2.5 | Live multi-user presence: colored carets, avatars in toolbar, awareness status (Viewing / Editing / Idle) | 30-editor convergence test passes with zero divergence |
| 2.6 | Live revocation: role change / deactivation / PAT revoke → `4403` close on matching sockets | Admin deactivates user; socket closes within 5 s |
| 2.7 | Suggestion mark rendering: `suggestion-insert` (green), `suggestion-delete` (red strikethrough), Accept/Reject bubble menu | Agent suggestion visible; human Accept produces clean text |

---

## Phase 3 — MCP Server & Agent Governance · 4 weeks

| # | Task | Exit criteria |
|---|---|---|
| 3.1 | Agent Gateway HTTP endpoint inside Collab service; mutual service credential; PAT identity forwarding | Agent edit reaches `openDirectConnection`; in-process write confirmed |
| 3.2 | MCP server (`@modelcontextprotocol/sdk`): SSE + HTTP and stdio transports | Claude Desktop and a headless test script can connect |
| 3.3 | Personal Access Token (PAT) UI: create, name, set scopes, set expiry, revoke | PAT created; raw secret shown once; hash stored |
| 3.4 | MCP tools: `search_posts`, `get_post`, `create_post`, `append_section`, `insert_after_section`, `suggest_edit_section`, `add_comment`, `publish_post` | Each tool tested against SDK mock client with valid and invalid scopes |
| 3.5 | Undo isolation: `UndoManager` configured with human-only origin filter | `Ctrl+Z` never reverts agent edits (automated + manual test) |
| 3.6 | Prompt injection guardrails: content returned to agents labeled untrusted; draft-only default enforced | Agent with `posts:draft` scope cannot publish; attempt audited |
| 3.7 | Agent attribution marks: `agentId`, `tokenId`, `ownerUserId`, `timestamp` embedded in suggestion marks; accepted text retains `attribution` attribute | Attribution data visible in post diff view after accept |
| 3.8 | Staleness flag: suggestion marks older than 30 days flagged in editor UI | Stale mark has distinct visual indicator |

---

## Phase 4 — Catalog, Search, Reviews & Comments · 3 weeks

| # | Task | Exit criteria |
|---|---|---|
| 4.1 | Catalog UI: grid and list views, COE/tag/author/date/status filters, infinite scroll | Filter combinations return correct results |
| 4.2 | Search: PostgreSQL `tsvector` + `pg_trgm`; visibility rules enforced; `working_search_vector` draft search | Draft post not visible in public search; visible to author |
| 4.3 | Published snapshot workflow: `approve` → `published` creates `post_versions` row; readers see `published_markdown`; `search_vector` rebuilt | Editing a published post does not change reader view until republished |
| 4.4 | Anchored review comments: Yjs relative positions resolved at read time; `open` / `resolved` status flow | Comment stays anchored to correct text after concurrent edits |
| 4.5 | Detached view counter: buffered increment, 30 s flush | View count updates without locking the `posts` row |
| 4.6 | Notifications: in-app (WebSocket push); optional SMTP for review requests, mentions, suggestion activity, publish events | Reviewer receives notification on post submission |

---

## Phase 5 — Admin Panel & Security Hardening · 3 weeks

| # | Task | Exit criteria |
|---|---|---|
| 5.1 | Admin console: user management (role, SSO sync, activate/deactivate), COE and tag taxonomy, PAT management | Admin deactivates user; user's sockets close within 5 s |
| 5.2 | Moderation queue: post review workflow, version diff viewer (working vs. last published) | Moderator approves post; `published_markdown` updated |
| 5.3 | Audit log viewer: filterable by date, action, actor, entity | Chain integrity verifiable from the UI |
| 5.4 | Content Security Policy headers on Nginx; HSTS; X-Frame-Options | Browser security header scan passes |
| 5.5 | XSS: DOMPurify on client; `rehype-sanitize` on server; Mermaid strict mode; KaTeX `trust: false` | Stored-XSS test payloads neutralized in Markdown, KaTeX, and Mermaid |
| 5.6 | Attachment pipeline: MIME type allow-list (file signature check), size limits, ClamAV quarantine status | Malicious file upload rejected or quarantined |
| 5.7 | Supply chain: pinned lockfile CI check; internal npm mirror configuration documented; image scan in CI | CI fails on lockfile drift |

---

## Phase 6 — Migration, Load Testing & Pilot · 2 weeks

| # | Task | Exit criteria |
|---|---|---|
| 6.1 | Legacy migration tool: Quill Delta → ProseMirror JSON → Yjs state; idempotent; dry-run mode; validation report (headings, tables, links, images counted before/after) | Validation report shows ≤ 1% content loss on production data copy |
| 6.2 | k6 load test: 30 concurrent editors across N documents; p95 API latency; p95 WebSocket broadcast latency; memory per open room | All targets from `README.md` SLO table met, or miss documented with root cause |
| 6.3 | Chaos test: kill Collab service mid-edit; measure recovery | Document fully recovered within one debounce interval (3 s) |
| 6.4 | Backup restore drill: full PostgreSQL PITR restore from WAL; attachment restore | Recovery time documented; RTO meets operations requirement |
| 6.5 | Indirect prompt injection red-team: adversarial content in posts and comments fed to a connected test agent | Agent does not publish, exfiltrate, or escalate permissions |
| 6.6 | Pilot with internal user group | Feedback collected; P0 bugs resolved before general availability |

---

## Total Estimate

| Phase | Weeks |
|---|---|
| 0. Spike | 2 |
| 1. Foundation | 3 |
| 2. Editor & Collaboration | 4 |
| 3. MCP & Governance | 4 |
| 4. Catalog, Search, Reviews | 3 |
| 5. Admin & Hardening | 3 |
| 6. Migration, Load, Pilot | 2 |
| **Total** | **~21 weeks** |

A fork of Outline or Docmost might save 6–8 weeks of editor scaffolding but adds fork-maintenance overhead, a license review obligation, and a harder path to suggestion-mode agent edits. Re-evaluate only if Phase 0 fails.

---

## Risks and Open Decisions

| Risk / Decision | Owner | Mitigation |
|---|---|---|
| Suggestion-mode complexity (diffing, mark semantics across all node types) | Engineering lead | Core of the Phase 0 spike; budget extra sprint if gate is borderline |
| TipTap paid extensions vs. in-house suggestion mode | Engineering + Finance | Decide at Phase 0 gate with cost/complexity comparison |
| Object storage license (MinIO AGPL-3.0) | Legal | Legal review before any deployment with MinIO; local-volume default meanwhile; evaluate Garage (MIT) and SeaweedFS (Apache 2.0) |
| Outline BSL 1.1 license interpretation | Legal | Legal reads the exact grant before any fork decision is made |
| Markdown round-trip fidelity for tables, math, diagrams | Engineering | Yjs ProseMirror tree stays canonical; Markdown is documented as a lossy export |
| RPO of up to one debounce interval (3 s) on collab crash | Engineering + Product | Accepted; reduce debounce interval or add incremental update log if business requires lower RPO |
| SSO provider differences (Entra ID, Okta, Keycloak) | Engineering + IT | Phase 1 tests against all three; adapter pattern in place |
| Air-gap npm mirror setup | DevOps | Document internal mirror configuration in Phase 1; verify all dependencies resolve from it |

---

## Operations

### Backups
- PostgreSQL base backups + WAL archiving for point-in-time recovery.
- Attachments backed up with matching retention policy.
- Quarterly restore drill with documented recovery time objective.

### Observability
- Structured JSON logs (`pino`) with correlation IDs on all API responses.
- Prometheus metrics: API latency histograms, WebSocket connection gauge, open rooms, flush latency, snapshot size per post.
- OpenTelemetry distributed traces across API and Collab services.
- Alerts: flush failures, room memory growth above threshold, failed audit chain links.

### Notifications
- In-app (WebSocket server-push).
- Optional SMTP for review requests, mentions, suggestion activity, and publish events.

### Retention
- `post_versions`: configurable, default 1 year; hourly checkpoints older than 7 days may be pruned, milestone versions preserved.
- `audit_logs`: never deleted from DB; monthly export to external write-once archive.
- Yjs state size per post: alerts when `length(yjs_state) > 5 MB` (configurable).
- Stale suggestion marks: flagged in UI after 30 days; never auto-rejected.
