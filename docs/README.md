# Enterprise Blogger 2.0 — Documentation Index

> **Status**: Engineering Draft — pending security and legal review  
> **Revision**: Rev 3 (supersedes all previous artifact versions)  
> **Last updated**: October 2026

A self-hosted collaborative blogging and knowledge platform for private corporate networks, with live human and AI agent co-editing over MCP.

---

## Documents

| File | Audience | Contents |
|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Engineering | System design, service topology, key decisions, document state model |
| [DATA_MODEL.md](DATA_MODEL.md) | Engineering / DBA | Full PostgreSQL schema, indexes, search visibility rules, versioning |
| [TECH_STACK.md](TECH_STACK.md) | Engineering / DevOps | All technology choices with justifications and locked version targets |
| [ROADMAP.md](ROADMAP.md) | Engineering / PM | Phased delivery plan, estimates, Phase 0 spike go/no-go criteria, risks |
| [FEATURE_IMPROVEMENT_PLAN.md](FEATURE_IMPROVEMENT_PLAN.md) | Product / Engineering | Core feature gaps, improvement workstreams, priorities, and acceptance criteria |
| [MCP_AND_BLOGGING_RELIABILITY_PLAN.md](MCP_AND_BLOGGING_RELIABILITY_PLAN.md) | Product / Engineering | Current implementation audit, caller-local PAT support, blogging defects, phased fixes, and end-to-end acceptance criteria |
| [IMPLEMENTATION_HANDOVER.md](IMPLEMENTATION_HANDOVER.md) | Engineering / Next Agent | Implemented first-batch fixes, verification, deployment notes, and prioritized remaining work |
| [TRACK1_MCP_VERIFICATION.md](TRACK1_MCP_VERIFICATION.md) | Engineering / Product | Track 1 verification results, live MCP showcase posts, and remaining transport/rendering/workflow defects |
| [PLUGIN_ARCHITECTURE_IMPLEMENTATION_PLAN.md](PLUGIN_ARCHITECTURE_IMPLEMENTATION_PLAN.md) | Engineering | Implementation-ready plugin contracts, registries, durable events, storage, and phased delivery |

---

## Goals

- Real-time multi-user editing on a **Yjs CRDT** with live presence (avatars, colored cursors, awareness status).
- AI agents (via **Model Context Protocol**) co-edit in **suggestion mode only**; humans explicitly accept or reject. Agents never silently overwrite human text.
- Enterprise governance: **SSO from day one**, granular RBAC plus per-post collaborator permissions, editorial review workflow, and a tamper-evident audit log.
- **Self-hosted and air-gap friendly**: Docker Compose first, Kubernetes manifest later. Zero mandatory SaaS dependencies.

## Non-Goals for v1

- Load-tested horizontal scaling (supported by design via optional Redis, not promised for v1).
- Offline-first editing.
- Public internet exposure or native mobile applications.

---

## Operational Targets (SLOs)

| Metric | Target | Verified by |
|---|---|---|
| API p95 latency (catalog, search, metadata) | < 50 ms | k6 load test, Phase 6 |
| WebSocket p95 broadcast latency (LAN) | < 20 ms | Headless Yjs client load test |
| Concurrent editors per document | 30 active cursors, zero divergence | Randomized convergence test |
| Time to first edit (hydrate + join room) | < 400 ms | Browser trace on a 50-page document |
| Baseline memory, whole stack | ~400–600 MB | Measured under load, reported as a range |
| Recovery point objective on collab crash | ≤ one debounce interval (3 s) | Chaos test: kill collab mid-edit |

> [!NOTE]
> These are engineering hypotheses until Phase 0 spike and Phase 6 load tests confirm them. Any miss is reported openly, not hidden.

---

## Legacy Reference

The scrapped v1 implementation lives in [`legacy_docs/`](../legacy_docs/README.md). Read the post-mortem there before touching anything related to collaboration or persistence.
