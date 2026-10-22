# Enterprise Blogger 2.0 — Test Infrastructure & Philosophy (TEST_INFRA.md)

## 1. Test Philosophy & Guiding Principles

Enterprise Blogger 2.0 is built on the premise that real-time collaborative editing between humans and AI agents requires mathematical guarantees of consistency, lossless serialization, and non-destructive human authority. The test infrastructure adheres to five core testing principles:

1. **Deterministic CRDT Convergence (Zero Divergence)**:
   - In distributed systems, peer clients must eventually reach identical states under arbitrary interleaving, reordering, and temporary network partitions.
   - Every convergence test runs with deterministic pseudo-random number generator (PRNG) seeds, guaranteeing that failures can be reproduced bit-for-bit.

2. **Opaque-Box Requirement-Driven Testing**:
   - Tests exercise public interface contracts and observable behavior (Yjs CRDT state vectors, ProseMirror node trees, exported Markdown, and Awareness protocols) rather than implementation-private internals.
   - Dual-track structure guarantees that tests validate requirements from `ORIGINAL_REQUEST.md` and `PROJECT.md` independently of internal implementation evolution.

3. **Human Keystroke Inviolability & Conflict Preservation**:
   - Human edits must never be silently swallowed or clobbered by AI agent suggestions.
   - Concurrent edits in overlapping text spans must retain human input intact, preserving human intent while attributing agent suggestions cleanly via marks.

4. **Strict Undo Isolation**:
   - Undo/Redo (`y-prosemirror` UndoManager) must strictly isolate transactions by origin. A human pressing Ctrl+Z must revert only their own keystrokes, never undoing or corrupting concurrent or prior AI agent suggestions.

5. **Permissive Licensing & Zero Copyleft**:
   - All test dependencies, harnesses, and fixtures are 100% compliant with permissive licenses (MIT, Apache-2.0, BSD). Strictly zero copyleft (GPL, AGPL).

---

## 2. Directory Layout & Architecture

```
tests/
├── package.json                    # Test package dependencies & test execution scripts
├── tsconfig.json                   # Strict TypeScript project configuration
├── vitest.config.ts                # Vitest runner configuration (Node environment, timeouts)
├── convergence/
│   ├── harness/
│   │   ├── client-pool.ts          # Headless Yjs client pool (5 human clients + 1 agent client)
│   │   ├── network-simulator.ts    # Discrete network latency, jitter, drop, and partition simulator
│   │   └── generator.ts            # Seeded PRNG operation generator (10k ops, fuzzing, scenarios)
│   └── suites/
│       ├── 10k-convergence.test.ts # 10,000-op randomized convergence suite (Tier 1 & 2)
│       ├── typing-collision.test.ts# Concurrent human typing during agent suggestions (Tier 2 & 3)
│       ├── undo-isolation.test.ts  # UndoManager origin filter & undo isolation (Tier 3)
│       ├── boundary-corner.test.ts # Boundary & corner cases: empty docs, max sizes, offset collisions (Tier 2)
│       ├── cross-feature.test.ts   # Suggestions in tables, KaTeX, Mermaid, code blocks (Tier 3)
│       └── enterprise-scenario.test.ts # Enterprise co-authoring: 5 engineers + 1 AI agent (Tier 4)
└── schema/
    ├── fixtures/
    │   └── index.ts                # Canonical & corner-case ProseMirror doc fixtures
    └── suites/
        ├── round-trip.test.ts      # Lossless JSON & CRDT round-trip tests (Tier 1)
        └── export-rules.test.ts    # Derived Markdown suggestion stripping & retention (Tier 1)
```

---

## 3. Test Tier Classification

The test suite is structured across 4 rigorous tiers:

| Tier | Name | Target Scope | Key Verification Criteria |
|---|---|---|---|
| **Tier 1** | **Feature Coverage** | Core collaboration, schema models, export rules | >=5 test cases per feature: GFM tables, alerts, KaTeX math, Mermaid diagrams, fenced code blocks, suggestion marks, basic sync. |
| **Tier 2** | **Boundary & Corner Cases** | Edge cases, extremes, and stress boundaries | Empty documents, 100KB+ section sizes, rapid concurrent edits at identical offsets, network drops during active agent transactions. |
| **Tier 3** | **Cross-Feature Combinations** | Multi-system interactions & collision handling | Agent suggestions inside tables, KaTeX math, and Mermaid; concurrent typing keystroke preservation; origin-isolated undo operations. |
| **Tier 4** | **Real-World Application Scenarios** | End-to-end production workflow simulations | Complete enterprise blogging scenario: 5 engineering authors concurrently writing sections while 1 AI reviewer suggests structural edits, with disconnects and reconnections. |

---

## 4. Test Harness Components

### 4.1 Client Pool (`client-pool.ts`)
- Manages a pool of headless Yjs clients: 5 simulated human editors (`human-1` through `human-5`) and 1 AI agent (`agent-gateway`).
- Each client maintains an isolated `Y.Doc`, `awarenessProtocol.Awareness`, and `Y.XmlFragment` ('prosemirror').
- Supports direct peer-to-peer sync or routing through the simulated network.
- Features helper methods for human typing, deleting, formatting, undo/redo, agent suggestion insertions, agent suggestion deletions, section appends, and awareness heartbeat broadcasts.
- Provides `assertConvergence()` to verify bit-exact or semantic state equality across all clients.

### 4.2 Network Simulator (`network-simulator.ts`)
- Implements discrete simulated packet routing between client endpoints.
- Configurable parameters:
  - `latencyMinMs` & `latencyMaxMs`: Simulates WAN/LAN network latency.
  - `dropRate`: Simulates lost packets (forcing CRDT sync reconciliation via state vectors).
  - `reorderRate`: Simulates out-of-order packet delivery.
  - `partition()` & `healPartition()`: Simulates network splits (e.g. 2 clients offline, 3 online, agent isolated) and subsequent state re-convergence.
- Discrete `flush()` method drains all in-flight packets until the network reaches quiescence.

### 4.3 Deterministic Generator (`generator.ts`)
- Seedable PRNG using a 32-bit Mulberry32 algorithm for 100% deterministic reproducibility.
- Generates balanced distributions of:
  - Human character/word insertions and deletions.
  - Rich-text block insertions (paragraphs, headings, callout alerts, code blocks, tables).
  - Agent suggestion marks (`suggestion_insert`, `suggestion_delete`) with unique UUIDs and metadata.
  - Network disruption events (disconnects, reconnects, partitions).
  - Undo and redo transactions.
- Scales from small verification batches (50 ops) to full convergence stress tests (10,000 ops).

---

## 5. Execution Commands

From the monorepo root:

```bash
# Run all E2E test suites
pnpm --filter @enterprise-blogger/tests test

# Run only the 10,000-op convergence suite
pnpm --filter @enterprise-blogger/tests test:convergence

# Run schema round-trip and export rules
pnpm --filter @enterprise-blogger/tests test:fixtures

# Run with verbose output
pnpm --filter @enterprise-blogger/tests test:all

# Type-check test code
pnpm --filter @enterprise-blogger/tests typecheck
```

---

## 6. Verification & Quality Gates

The test bed acts as the gatekeeper for Phase 0 Spike completion (`TEST_READY.md`):
- All 4 Tiers must pass with 100% success rate.
- Zero document divergence across all 6 clients in the 10,000-op convergence test.
- Zero keystrokes lost during concurrent human typing in agent suggestion ranges.
- Zero agent transactions reverted when human triggers Undo (Ctrl+Z).
- 100% lossless round-trip for all 5 canonical schema elements.
