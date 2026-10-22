# Project: Enterprise Blogger 2.0 Phase 0 Spike

## Architecture
Enterprise Blogger 2.0 is a self-hosted, collaborative enterprise blogging and knowledge platform.
The Phase 0 Spike proves the foundational real-time collaboration engine, CRDT convergence, Yjs suggestion mode, and in-process Agent Gateway before full application scaffolding.

### Monorepo Layout
```
Enterprise_Blogger/
├── apps/
│   ├── collab/                     # Hocuspocus collaboration server + in-process Agent Gateway
│   └── mcp-server/                 # MCP agent server interface
├── packages/
│   └── shared/                     # ProseMirror schemas, Zod definitions, types, suggestion engine
├── tests/                          # E2E & convergence testing harness (Tiers 1-4)
├── package.json                    # Pnpm root manifest (pinned exact versions)
├── pnpm-workspace.yaml             # Monorepo workspace configuration
├── tsconfig.base.json              # Shared TypeScript base configuration
└── PROJECT.md                      # Project architecture & status
```

### Module Boundaries & Data Flow
1. **`packages/shared`**: Defines data models, ProseMirror schemas (nodes, marks), Zod validators, suggestion mark algorithms, diff-based operations, collision logic, UndoManager filter, and Markdown export serializer. Zero runtime network dependencies.
2. **`apps/collab`**: Hosts the Hocuspocus collaboration server using standard `ws` (excluding `uWebSockets.js`). Implements the `@hocuspocus/extension-database` persistence hook with PostgreSQL `bytea` snapshot encoding (`Y.encodeStateAsUpdate`). Implements internal authenticated HTTP Agent Gateway (`/internal/agent-gateway/edit`) invoking `hocuspocus.openDirectConnection()` in-process with live awareness injection, and a headless `HocuspocusProvider` client fallback with awareness verification.
3. **`apps/mcp-server`**: Implements MCP tools for agent edits (`append_section`, `insert_after_section`, `suggest_edit_section`), communicating securely with the collab Agent Gateway.
4. **`tests/`**: Comprehensive E2E test bed containing the 10,000-op randomized convergence suite (5 human clients + 1 agent client), lossless schema round-trip fixtures, export rule tests, concurrent typing collision tests, and undo isolation tests.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Pnpm Monorepo Workspace | Root pnpm-workspace.yaml, package.json, tsconfig.base.json | M1 | R1, docs/TECH_STACK.md |
| 2 | Permissive License Compliance | 100% MIT, Apache-2.0, BSD dependencies; zero copyleft | M1 | R1, docs/TECH_STACK.md |
| 3 | Pinned Dependency Manifest | Exact tested versions of yjs, y-prosemirror, @hocuspocus/server, @hocuspocus/provider, tiptap | M1 | AC, ORIGINAL_REQUEST.md:48 |
| 4 | ProseMirror Core Schema | Document, paragraph, headings, bullet/ordered lists, blockquotes | M1 | docs/DATA_MODEL.md |
| 5 | GFM Table Schema | Rectangular grid table schema, rows, cells, header cells | M1 | R4, docs/ARCHITECTURE.md |
| 6 | GitHub-style Alerts Schema | `> [!NOTE]`, `> [!WARNING]`, `> [!IMPORTANT]`, `> [!TIP]`, `> [!CAUTION]` | M1 | R4, docs/DATA_MODEL.md |
| 7 | KaTeX Math Schema | Math display block and math inline schema with LaTeX strings | M1 | R4, docs/DATA_MODEL.md |
| 8 | Mermaid Diagram Schema | Mermaid code block schema enforcing `securityLevel: 'strict'` | M1 | R4, docs/DATA_MODEL.md |
| 9 | Fenced Code Block Schema | Code block with language tag, line numbers, and escaping | M1 | R4, docs/DATA_MODEL.md |
| 10 | Suggestion-Insert Mark | Mark with agentId, tokenId, ownerUserId, timestamp | M1 | R3, docs/ARCHITECTURE.md |
| 11 | Suggestion-Delete Mark | Mark with agentId, tokenId, ownerUserId, timestamp | M1 | R3, docs/ARCHITECTURE.md |
| 12 | Zod API Payloads | Validation schemas for Agent Gateway & MCP tool calls | M1 | docs/ARCHITECTURE.md |
| 13 | Append Section Operation | Additive block insertion at document end | M2 | R3, docs/ARCHITECTURE.md |
| 14 | Insert After Section Operation | Additive block insertion after target heading | M2 | R3, docs/ARCHITECTURE.md |
| 15 | Suggest Edit Section (Diff) | Diff-based token/char replacement using suggestion marks | M2 | R3, docs/ARCHITECTURE.md |
| 16 | Accept Suggestion Logic | Transition suggestion marks to standard accepted content | M2 | R3, docs/ARCHITECTURE.md |
| 17 | Reject Suggestion Logic | Revert suggestion marks without modifying surrounding text | M2 | R3, docs/ARCHITECTURE.md |
| 18 | Typing Collision: Insertion | Typing inside pending insertion retains suggestion | M2 | R3, ORIGINAL_REQUEST.md:28 |
| 19 | Typing Collision: Deletion | Typing inside pending deletion auto-rejects suggestion | M2 | R3, ORIGINAL_REQUEST.md:29 |
| 20 | UndoManager Human Origin Filter | y-prosemirror UndoManager filtering human origins only; Ctrl+Z ignores agent | M2 | R3, ORIGINAL_REQUEST.md:29 |
| 21 | Derived Markdown Exporter | Serializer stripping pending insertions and retaining deleted text | M2 | R4, ORIGINAL_REQUEST.md:35 |
| 22 | Hocuspocus Standard WS | Collaboration server running on pure standard `ws` (no uWS) | M3 | R1, docs/ARCHITECTURE.md |
| 23 | PostgreSQL Bytea Persistence | @hocuspocus/extension-database with Y.encodeStateAsUpdate | M3 | R1, docs/DATA_MODEL.md |
| 24 | Flush Debouncing & Graceful Flush | 3s debounce, 10s max debounce, SIGTERM/SIGINT flush | M3 | docs/ROADMAP.md:83 |
| 25 | In-Memory / pg-mem Test Adapter | Zero-dependency test storage adapter for headless runs | M3 | survey_workspace.md |
| 26 | Optional Redis Pub/Sub | Configurable via REDIS_URL, disabled by default | M3 | R1, docs/ARCHITECTURE.md |
| 27 | Collab Auth Hooks | onAuthenticate & onLoadDocument RBAC checks | M3 | docs/ARCHITECTURE.md |
| 28 | In-Process Agent Gateway HTTP API | Private authenticated `/internal/agent-gateway/edit` | M4 | R2, docs/ARCHITECTURE.md |
| 29 | DirectConnection Write Path | hocuspocus.openDirectConnection() single-authority in-process mutation | M4 | R2, ORIGINAL_REQUEST.md:22 |
| 30 | Agent Awareness Injection | Live awareness state (agent label, cursor, color) | M4 | R2, docs/ARCHITECTURE.md |
| 31 | Headless Provider Fallback | Headless HocuspocusProvider client with awareness verification | M4 | R2, ORIGINAL_REQUEST.md:22 |
| 32 | MCP Server Tooling | MCP server exposing append, insert_after, suggest_edit tools | M4 | R1, docs/ARCHITECTURE.md |
| 33 | 10k-Op Randomized Convergence Test | 5 human + 1 agent client, disconnect/reconnect, 0 divergence | M5 | R4, AC, ORIGINAL_REQUEST.md:40 |
| 34 | Schema Round-Trip Tests | Lossless JSON round-trip for tables, alerts, KaTeX, Mermaid, code | M5 | R4, AC, ORIGINAL_REQUEST.md:46 |
| 35 | Suggestion Export Rule Test | Unit & E2E verification of Markdown export suggestion stripping | M5 | R4, AC, ORIGINAL_REQUEST.md:47 |
| 36 | Concurrent Typing Keystroke Loss Test | Human typing concurrently in agent suggestion block loses 0 keystrokes | M5 | R3, AC, ORIGINAL_REQUEST.md:42 |
| 37 | Undo Isolation Integration Test | Ctrl+Z reverses only human edits, never agent suggestions | M5 | R3, AC, ORIGINAL_REQUEST.md:43 |
| 38 | Agent Gateway Awareness Verification Test | Agent cursor presence and label verified by connected client | M5 | R2, AC, ORIGINAL_REQUEST.md:41 |
| 39 | Adversarial Coverage Hardening | Tier 5 challenger edge cases, fuzzing, and forensic audit | M5 | Project Pattern, ROADMAP.md |
| 40 | Self-Contained Docker Compose Production Setup | docker-compose.prod.yml, Dockerfiles for collab & mcp-server, health checks (/healthz) | M3 | R1, Follow-up 2026-10-22 |
| 41 | Turnkey Launch Script & .env.example | ./scripts/deploy.sh with consolidated sensible defaults | M3 | Follow-up 2026-10-22 |
| 42 | Automated DB Initialization & Migrations | Automatic container startup schema initialization & migrations | M3 | Follow-up 2026-10-22 |
| 43 | Local Persistent Volume Mapping | Clean mappings for Postgres data, attachments, and audit logs | M3 | Follow-up 2026-10-22 |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Monorepo Foundation & Shared Schemas | pnpm monorepo setup, packages/shared, ProseMirror schemas, marks, Zod contracts, license verification | none | DONE |
| M2 | Suggestion-Mode Engine & Export Rules | Suggestion operations (diff/additive), accept/reject, typing collision, UndoManager filter, Markdown export serializer | M1 | DONE |
| M3 | Hocuspocus Collab Server & Persistence | Hocuspocus server (standard ws), PostgreSQL bytea snapshot persistence hook, pg-mem test harness, auth hooks, turnkey Docker Compose prod setup (docker-compose.prod.yml, ./scripts/deploy.sh, .env.example, migrations, volumes) | M1 | DONE |
| M4 | In-Process Agent Gateway & MCP Server | Fastify Agent Gateway endpoint, openDirectConnection in-process write path, awareness broadcast, MCP server | M2, M3 | DONE |
| M5 | Final Milestone: E2E Integration, Convergence & Hardening | Full system integration, 10,000-op convergence test, schema round-trip tests, typing collision, undo isolation, Tier 5 adversarial hardening | M4, TEST_READY.md | DONE |

---

## Interface Contracts

### 1. `packages/shared` ↔ `apps/collab` & `apps/mcp-server`
- **Schemas**:
  - `schema`: Complete ProseMirror `Schema` containing custom nodes (`table`, `callout_alert`, `math_display`, `math_inline`, `mermaid_block`, `code_block`) and marks (`suggestion_insert`, `suggestion_delete`).
  - `SuggestionInsertAttrs`: `{ agentId: string, tokenId: string, ownerUserId: string, timestamp: number }`
  - `SuggestionDeleteAttrs`: `{ agentId: string, tokenId: string, ownerUserId: string, timestamp: number }`
- **Operations API (`packages/shared/suggestion`)**:
  - `appendSection(doc: Y.Doc, heading: string, content: string, agentMeta: AgentMetadata): void`
  - `insertAfterSection(doc: Y.Doc, targetHeading: string, heading: string, content: string, agentMeta: AgentMetadata): boolean`
  - `suggestEditSection(doc: Y.Doc, sectionHeading: string, newContent: string, agentMeta: AgentMetadata): DiffResult`
  - `acceptSuggestion(doc: Y.Doc, suggestionId: string, userId: string): void`
  - `rejectSuggestion(doc: Y.Doc, suggestionId: string, userId: string): void`
  - `exportDerivedMarkdown(pmDocJson: any): string` (strips pending insertions, keeps pending deletions)

### 2. `apps/mcp-server` ↔ `apps/collab` (Agent Gateway HTTP Contract)
- **Endpoint**: `POST /internal/agent-gateway/edit`
- **Headers**:
  - `Content-Type: application/json`
  - `X-Gateway-Secret: <string>`
  - `X-User-Id: <string>` (forwarded human owner)
  - `X-Agent-Id: <string>`
- **Request Body**:
  ```json
  {
    "documentId": "post-123",
    "operation": "suggest_edit_section" | "append_section" | "insert_after_section",
    "targetHeading": "Architecture Overview",
    "content": "Updated section text...",
    "tokenId": "tok-456"
  }
  ```
- **Response Body**:
  ```json
  {
    "success": true,
    "appliedAt": 1729612800000,
    "changesSummary": { "insertions": 2, "deletions": 1 }
  }
  ```

### 3. `apps/collab` ↔ Persistence (`DocumentPersistenceAdapter`)
- **Interface**:
  ```typescript
  export interface DocumentPersistenceAdapter {
    fetch(documentName: string): Promise<Uint8Array | null>;
    store(documentName: string, state: Uint8Array): Promise<void>;
    destroy(): Promise<void>;
  }
  ```
- **Implementations**:
  - `PostgresPersistenceAdapter` (production: `pg` against PostgreSQL `bytea`)
  - `InMemoryPersistenceAdapter` (test suite / self-contained runs)

---

## Code Layout
```
Enterprise_Blogger/
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── .gitignore
├── PROJECT.md
├── TEST_INFRA.md
├── packages/
│   └── shared/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── schema/
│           │   ├── nodes/
│           │   │   ├── table.ts
│           │   │   ├── alert.ts
│           │   │   ├── math.ts
│           │   │   ├── mermaid.ts
│           │   │   └── code.ts
│           │   ├── marks/
│           │   │   ├── suggestion-insert.ts
│           │   │   └── suggestion-delete.ts
│           │   └── index.ts
│           ├── suggestion/
│           │   ├── diff.ts
│           │   ├── operations.ts
│           │   ├── collision.ts
│           │   └── undo.ts
│           ├── export/
│           │   └── markdown.ts
│           └── types/
│               └── index.ts
├── apps/
│   ├── collab/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── server.ts
│   │       ├── gateway/
│   │       │   ├── routes.ts
│   │       │   ├── direct-connection.ts
│   │       │   └── awareness.ts
│   │       ├── persistence/
│   │       │   ├── adapter.ts
│   │       │   ├── postgres.ts
│   │       │   └── in-memory.ts
│   │       └── auth/
│   │           └── hooks.ts
│   └── mcp-server/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           └── tools/
│               ├── append-section.ts
│               ├── insert-after.ts
│               └── suggest-edit.ts
└── tests/
    ├── package.json
    ├── tsconfig.json
    ├── vitest.config.ts
    ├── convergence/
    │   ├── harness/
    │   │   ├── client-pool.ts
    │   │   ├── network-simulator.ts
    │   │   └── generator.ts
    │   └── suites/
    │       ├── 10k-convergence.test.ts
    │       ├── typing-collision.test.ts
    │       └── undo-isolation.test.ts
    └── schema/
        ├── fixtures/
        └── suites/
            ├── round-trip.test.ts
            └── export-rules.test.ts
```
