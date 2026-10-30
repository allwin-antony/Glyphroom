# Glyphroom MCP and Blogging Reliability Plan

> **Status:** Proposed implementation plan, based on a source audit and focused runtime checks.
> **Audit date:** 2026-10-30
> **Source baseline:** `159607f` — `fix(mcp): resolve stateless http transport handling and add dev watch scripts`.
> **Goal:** Support individually authenticated MCP clients and make the create → collaborate → review → publish → read workflow dependable.

**Implementation update:** The first fix batch is documented in [IMPLEMENTATION_HANDOVER.md](IMPLEMENTATION_HANDOVER.md). The findings below retain the original audit evidence; consult the handover for current completion status and next actions.

## 1. Recommended direction

Deliver this work in small, testable slices around three product guarantees:

1. **Every MCP action belongs to the caller.** A user configures their PAT in their local MCP client. The shared HTTP MCP server obtains identity and scopes from that request and uses the same actor throughout API calls, collaborative edits, comments, and plugin tools.
2. **A document retains its content across every interface.** Browser-created and MCP-created rich content survives editing, suggestions, persistence, review checkpoints, publication, reader rendering, and Markdown export.
3. **The reviewed version is the published version.** Capturing a review, approving it, publishing it, restoring a version, and continuing to edit are explicit operations with consistent results.

Basic PAT authentication, current user permissions, and correct attribution are part of making the integration function. Advanced security hardening, enterprise SSO/OAuth rollout, penetration testing, and infrastructure security remain a separate phase.

The earlier [feature improvement plan](FEATURE_IMPROVEMENT_PLAN.md) is useful background, but some delivery claims no longer describe the integration accurately. Use the findings and exit criteria below for this work. Existing delivered functionality—such as tags persistence in the REST API, bookmarks, notifications, and pinned first-publication checkpoints—provides the starting point.

## 2. Audit evidence and verification baseline

### What was exercised

- Earlier connected-MCP checks: discovery of all eight tools; three documentation/template resources; search; `get_post` by UUID and slug in all three requested formats; creation attempt.
- Current checkout: MCP handlers, API clients, PAT handling, collaboration gateway/persistence, document schemas/export, publishing/review/version routes, comments, catalog/dashboard consumers, attachments, and deployment wiring.
- Isolated runtime probes using actual application functions and the existing in-memory API database helper. These exercised the real API route validation and MCP-to-API create path without writing to the connected Glyphroom instance.
- Existing workspace tests and TypeScript checks, using Linux Node `v24.9.0` and pnpm `12.15.0`.

### Reproduced behavior

| Check | Observed result |
|---|---|
| Connected MCP creation | `401 Authentication required`; no post was created in that instance. |
| MCP search with `limit: 1, offset: 1` | Returned both available results. A nonexistent tag filter still returned a post. |
| MCP `get_post` formats | `summary` and `prosemirror_json` both returned `format: markdown`; the outline contained only the title. |
| Authenticated MCP creation against the isolated real API | Reported draft success, but the stored Yjs document had **zero blocks**, tags were empty, and readback contained only the title/excerpt fallback. |
| Browser-shaped rich-node export fixtures | `codeBlock`, `mermaidBlock`, `mathBlock`, `projectStatusBlock`, `tableRow`-based tables, task lists, images, and attachment blocks each exported as an empty string. `bold` text lost its formatting. |
| MCP append with headings, checklist, and Mermaid Markdown | Created literal paragraph text rather than the corresponding rich nodes. |
| Suggestion against a section containing a valid table | Reported success, but the resulting document failed schema validation: invalid content for `table`. |
| Editor's top-level comment payload | `400`: `parentId: null` and null anchors are rejected. Omitting those optional fields returned `201`. |
| Reply using a root comment from another post | Returned `201`, creating a cross-post parent reference. |
| “Save as Draft” payload on an approved post | PATCH returned `200`, but the post remained `approved`. The frontend nevertheless sets its state to `draft`. |
| Initial review/approval/publication in the API | Worked for the pinned fixture: `200` / `201` / `200`. |
| Author republish after changing working content | Returned `200` and published the later content without another review checkpoint. |
| Applying a historical Yjs update to the current document | Retained the later content; applying an old update does not rewind CRDT history. |

These observations establish specific defects. Concurrency, Docker persistence, and full-browser scenarios identified by source tracing still need the integration checks specified below.

### Existing automated suites

| Workspace | Audit result |
|---|---|
| `packages/shared` | 329 tests passed. |
| `apps/api` | 81 tests passed. |
| `apps/web` | 119 tests passed. |
| `apps/mcp-server` | 36 tests passed, including the recent repeated stateless HTTP request regression. |
| Reference plugins | 4 Jira tests and 4 Slack tests passed. |
| `apps/collab` | Initial concurrent workspace run: 102 passed, 2 failed. The health-latency case passed when rerun in isolation. The oversized-header case still expected a rejected request but received HTTP `431` on Node 24. |
| `tests` integration workspace | 112 tests passed after building its imported workspace packages, including the 10,000-operation convergence suite and MCP/gateway integration tests. |
| TypeScript | All eight checked workspaces passed after building the imported shared, collab, and MCP packages. |

The test command is not fully green because of the remaining oversized-header expectation. Treat that as a runtime/test compatibility issue, not evidence that the application accepted the oversized request. The latency result also needs an isolated performance-test environment rather than a wall-clock assertion under a fully parallel workspace run.

Fresh-checkout detail: the integration workspace imports built package exports. Its initial typecheck could not resolve collab/MCP declarations until those packages were built. The shell's default `pnpm` also resolved to a Windows executable; invoking the pinned Linux-compatible package through `npm exec` allowed installation and checks to run.

### Why the current tests miss these bugs

- `apps/mcp-server/tests/full-tools.test.ts:14-41,79-98` mocks the API client and checks draft status/ID, not persisted initial content or tags.
- `apps/mcp-server/tests/server-http.test.ts:55-99` tests independent HTTP clients and catalog/resource calls, but not authenticated tool calls using different PATs.
- `apps/api/tests/api-integration.test.ts:198-214` writes `workingMarkdown` directly before submission. This verifies snapshot selection but cannot detect a stale live collaboration snapshot.
- Web/API tests often run separately with mocked response shapes. They do not catch the editor's null-comment payload being rejected by the actual route.
- Shared schema tests use the shared schema's node names; browser fixtures use a different vocabulary. Passing both suites independently does not establish interoperability.
- The in-memory database helper uses simplified tables; use real PostgreSQL for transaction, constraint, and migration acceptance checks.

## 3. Prioritized findings

Priority meanings:

- **P0:** Caller identity, content preservation, or core publication correctness is broken.
- **P1:** A normal author/reader workflow is incomplete or misleading.
- **P2:** Follow-on usability work after the functional path is reliable.

### MCP integration

| ID | Priority | Finding and impact | Evidence / implementation entry points |
|---|---|---|---|
| M01 | P0 | Remote requests do not supply their own authenticated actor to tools. API calls use a process-wide PAT; gateway calls use default user/token IDs. Multiple users cannot use a shared server with correct independent attribution. | `apps/mcp-server/src/index.ts:24-36,73-88`; `src/server.ts:34-77`; `src/gateway/client.ts:51-60`; `apps/collab/src/gateway/direct-connection.ts:33-49`. |
| M02 | P0 | Scope vocabulary and propagation disagree. Settings offers `posts:read`/`posts:write`; MCP defaults mention `posts:draft`/`posts:suggest`; publication checks environment-provided scopes. API authentication loads token scopes but does not retain them in the request context. | `apps/web/src/views/SettingsView.tsx:23-40`; `apps/api/src/plugins/auth.ts:48-83`; `apps/mcp-server/src/server.ts:47-53`; `src/tools/publish-post.ts:27-46`. |
| M03 | P0 | `create_post` silently discards required content, tags, and COE. Authentication alone would still produce an empty document. | `apps/mcp-server/src/tools/create-post.ts:23-32`; `src/api/client.ts:82-92`; reproduced against the actual API. |
| M04 | P1 | Search ignores pagination/tags/COE, searches only the API's first page locally, and supplies placeholder author names and empty tags. | `apps/mcp-server/src/api/client.ts:29-54`; connected-MCP reproduction. |
| M05 | P0 | `get_post` ignores requested format and suggestion visibility, returns a synthetic outline, and prefers reader-derived/published content even though its contract promises working content. This prevents reliable edit/readback verification. | `apps/mcp-server/src/tools/get-post.ts:19-28`; `src/api/client.ts:57-79`; `packages/shared/src/validation/mcp.ts:66-88`. |
| M06 | P0 | Append/insert treat Markdown as paragraphs, and section suggestions can append inline text directly into non-text containers such as tables. Advertised rich-block support is incomplete and can create invalid documents. | `packages/shared/src/suggestion/operations.ts:145-199,239-294,351-375`; rich-node runtime probes. |
| M07 | P1 | `anchorHeading` is discarded. Publication notes are discarded, and `publish_post` only calls the publish endpoint despite advertising review submission too. A draft cannot complete the advertised workflow through this catalog. | `apps/mcp-server/src/tools/add-comment.ts:23-26`; `src/api/client.ts:101-125`; `src/tools/publish-post.ts:45-56`. |
| M08 | P0 | Slug and UUID edits can use different live rooms for the same database row. Fragment selection also differs between editor, gateway, and persistence. Changes may be missing from a collaborator's room or the exported document. | `apps/collab/src/gateway/direct-connection.ts:51-57,85-86`; `src/persistence/postgres.ts:51-71,91-93`; `apps/web/src/views/EditorView.tsx:105-112`; `components/Editor.tsx:89-93`. |

### Blogging, collaboration, and reading

| ID | Priority | Finding and impact | Evidence / implementation entry points |
|---|---|---|---|
| B01 | P0 | Browser and shared schemas disagree on rich-node/mark names and attributes. The export fallback drops entire rich blocks, so published articles can lose code, tables, diagrams, formulas, status cards, and attachments. | `apps/web/src/components/Editor.tsx:337-373,681-748`; `packages/shared/src/schema/nodes/index.ts:31-50`; `packages/shared/src/export/markdown.ts:19-31,96-142,251-295`; reproduced. |
| B02 | P1 | Reader rendering is a line-by-line Markdown subset. It lacks proper tables, link/image rendering, task-list semantics, math/status rendering, and Mermaid rendering; versions use another partial renderer. | `apps/web/src/views/ReaderView.tsx:256-445`; `components/editor/tabs/VersionsTab.tsx:218-239`. |
| B03 | P0 | Submission captures the persisted database copy without coordinating with the live room. With the normal 3–10 second debounce, the checkpoint can miss recent edits even after the UI says saved. | `apps/api/src/routes/posts.ts:784-838`; `apps/collab/src/server.ts:37-39,99-104`; `apps/web/src/components/editor/SaveStatusBadge.tsx:55-73`. |
| B04 | P0 | Review UI displays mutable `workingMarkdown`, while first publication uses the approved checkpoint. A reviewer can approve a version different from what they just saw. | `apps/web/src/views/ReviewQueueView.tsx:277-281`; `apps/api/src/routes/reviews.ts:107-127`; `routes/posts.ts:910-947`. |
| B05 | P0 | Republishing skips the immutable-review path. “Save as Draft” is a successful no-op in the API, and approved posts get inappropriate frontend actions or disappear from My Work tabs. | `apps/api/src/routes/posts.ts:77-85,1230-1307`; `apps/web/src/components/editor/SubmitReviewButton.tsx:89-117,129-140,236-251`; `views/MyWorkView.tsx:74-89`; reproduced. |
| B06 | P0 | Restore writes historical state directly to PostgreSQL, then the browser merges an old Yjs update. The live room is not restored and can overwrite the database again. Deleting an open post also leaves a live writer whose persistence adapter can auto-insert the deleted row. | `apps/api/src/routes/posts.ts:726-764,1178-1226`; `apps/web/src/components/editor/tabs/VersionsTab.tsx:101-119`; `apps/collab/src/persistence/postgres.ts:119-143`. Restore merge behavior reproduced; full live-room/deletion scenarios need integration verification. |
| B07 | P0 | Workflow mutations, tag replacement, and event enqueueing lack shared transaction boundaries. Failures can return an error after content/state was already changed; simultaneous submissions can allocate the same version number. | `apps/api/src/routes/posts.ts:603-643,672-684,821-875,940-984,1283-1333`; `routes/reviews.ts:121-166`; `db/schema.ts:196-216` has no unique post/version-number constraint. |
| B08 | P1 | My Work, Review Queue, Home, and Space views fetch `/posts` once and filter locally. The API now defaults to 24 results, so older work disappears and counts are incomplete. Suggestions Waiting is just a draft/review status filter. | `apps/api/src/routes/posts.ts:88-96,254-277`; `apps/web/src/views/MyWorkView.tsx:45-89`; `ReviewQueueView.tsx:31-39`; `HomeView.tsx:27`; `SpaceView.tsx:97-100`. |
| B09 | P1 | Creating from a Space loses the Space context. The link includes `?spaceId=...`, but New Post does not read or submit it. Several mutation/comment/review routes also omit Space fields when resolving an existing member's permission. | `apps/web/src/views/SpaceView.tsx:282`; `NewPostView.tsx:17-47`; examples: `apps/api/src/routes/posts.ts:658-660`; `routes/reviews.ts:81-84`; `routes/comments.ts:80-83`. |
| B10 | P1 | Editor comments fail their API contract; replies can point at another post; reader discussion loses the thread structure. Reply/mention notification delivery is not wired into the comment route. | `apps/web/src/components/editor/tabs/CommentsTab.tsx:107-140`; `apps/api/src/routes/comments.ts:10-15,96-113,128-136`; `apps/web/src/views/ReaderView.tsx:47-54,793-809`; reproduced null/cross-post cases. |
| B11 | P1 | Save feedback reflects transport synchronization, not durable storage or metadata writes. Title-save failures only reach the console. Metadata PATCH also lacks friendly slug-collision handling. | `apps/web/src/components/editor/SaveStatusBadge.tsx:19,45-73`; `views/EditorView.tsx:162-173`; `apps/api/src/routes/posts.ts:648-696`. |
| B12 | P0 | Uploads are written under the API's working-directory `uploads` folder, but Compose mounts the attachment volume on collab at `/app/attachments`. Container replacement can lose uploaded files. Absolute paths also hinder moving existing storage. | `apps/api/src/routes/attachments.ts:59,116-135,241-246`; `docker-compose.prod.yml:67-68,111-113`; `docker/Dockerfile.api:72`. |
| B13 | P0 | The editor defaults to `ws://localhost:4000`. The deployed web image does not configure another URL, although Nginx already offers `/ws`. A browser on another machine attempts to connect to its own localhost. | `apps/web/src/views/EditorView.tsx:105-113`; `docker/Dockerfile.web:19-38`; `docker/nginx/nginx.conf:34-42`. |
| B14 | P1 | API/MCP search contracts diverge. The current API accepts `search/page/limit`, not the earlier documented `q/offset/tag/spaceId` contract. It also searches working and published Markdown together rather than selecting the intended document view. Catalog load-more has no stale-query response guard. | `apps/api/src/routes/posts.ts:88-96,216-230`; `apps/mcp-server/src/api/client.ts:29-54`; `apps/web/src/views/CatalogView.tsx:119-147`. |

### Additional bounded follow-ups

- Define title/excerpt/tags/COE snapshot semantics. Today readers receive mutable metadata alongside immutable published Markdown.
- Generate collision-resistant, length-bounded MCP slugs; repeated titles currently conflict, and a permitted 500-character title can generate a slug exceeding the API's 255-character limit.
- Provide explicit working checkpoints and archive/restore actions if those lifecycle features remain advertised; do not implement state changes through unrestricted metadata PATCH.
- Surface bookmark, comment, and list-loading failures in the UI; preserve working bookmark/tag/notification functionality while updating their shared contracts.
- Reconcile the documented API base URL with `ApiClient`: the README includes `/api/v1`, while the client appends it. Compose also needs an explicit API service URL for MCP rather than its localhost default.

## 4. Target implementation contracts

### 4.1 Caller-local PAT, request-local actor

```text
User's OpenCode configuration / environment
  Authorization: Bearer <that user's Glyphroom PAT>
                  |
                  v
Shared Glyphroom HTTP MCP endpoint
  validate via Glyphroom API identity service
  construct immutable RequestActor + request-scoped clients
           /                         \
          v                           v
Glyphroom REST API           Internal collab gateway
post/search/comment/        canonical post UUID, same actor,
workflow operations        same live room, attributed suggestions
```

Recommended approach:

1. Extract the existing PAT lookup into a reusable API identity service. Extend `/api/v1/auth/me` or add a small typed context endpoint returning `userId`, current role, `tokenId`, scopes, and expiry. It must return the actual PAT context, not only a browser session-shaped user.
2. Build an immutable `RequestActor` in the HTTP MCP handler. Keep the fresh server/transport pair per stateless request introduced in `159607f`.
3. Inject a request-scoped `ApiClient`, gateway identity, and plugin context. Do not implement this by changing `process.env`, mutating a singleton client's token, or accepting owner IDs from tool arguments.
4. Make the API's existing post/Space permission resolver the common source of effective permissions. Pass complete post context to it from all participating routes.
5. Keep infrastructure credentials, including the internal gateway credential, on the services. User PATs arrive from clients; they are not a shared deployment identity.
6. For local stdio, `GLYPHROOM_PAT` remains a valid local-process configuration. Resolve it to the same actor contract used by HTTP. Remove synthetic owner/token fallbacks from normal execution.
7. Preserve typed failure reasons: missing/invalid token, missing scope, post not found, section not found, invalid workflow transition, conflict, and unavailable dependency. A successful MCP connection alone is not the authentication acceptance test.

#### Shared scope catalog

Define one catalog consumed by the PAT UI, API, MCP core tools, tests, and plugin tools. Recommended functional mapping:

| Capability | Canonical scope |
|---|---|
| Search/read posts | `posts:read` |
| Create drafts and submit a draft for review | `posts:draft` |
| Append/insert/propose content changes | `posts:suggest` |
| Add comments and replies | `comments:write` |
| Publish an approved checkpoint | `posts:publish` |

Specify compatibility aliases for existing tokens: `posts:write` can map to draft/suggestion capabilities; legacy singular `post:...` names need an explicit migration/alias policy. Publication remains an explicit capability. Token scope checks and the user's existing post rights are both required for correct product behavior.

#### Intended OpenCode V2 configuration

Merge the server entry into `~/.config/opencode/opencode.json(c)` or the appropriate project config:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "glyphroom": {
        "type": "remote",
        "url": "https://your-glyphroom-host/mcp",
        "oauth": false,
        "headers": {
          "Authorization": "Bearer {env:GLYPHROOM_PAT}"
        }
      }
    }
  }
}
```

The variable is supplied to the OpenCode service making the request. A documented `{file:...}` reference is also available for a locally stored token. Saving OpenCode configuration reloads it; `/reload` forces a refresh. The Glyphroom request-authentication implementation above is required before this client configuration works end to end.

Reference: [OpenCode V2 MCP configuration](https://opencode.ai/v2/docs/mcp-servers).

### 4.2 One document model and one live room

- Resolve UUIDs/slugs to a canonical post UUID before collaborative operations. Every client uses `post-<uuid>`.
- Standardize the Yjs fragment on `prosemirror`. Handle legacy `default` fragments with one explicit compatibility/migration function; do not have different components choose independently.
- Establish a shared document contract matching the browser's TipTap node/mark names and attributes. Support legacy shared-schema names at conversion boundaries so existing documents remain readable.
- Use one structured Markdown import pipeline for MCP creation, append, and insert. It must produce native headings, lists/tasks, tables, alerts, code, diagrams, formulas, and status cards.
- Preserve the existing suggestion-mode policy for agent edits. Define pending-change metadata for atom blocks as well as text, so accepting/rejecting a diagram or status card works and clean export consistently excludes pending insertions.
- Validate proposed structured edits before mutation. Diff supported inline content without flattening tables/lists or inserting text into invalid containers. Unsupported structural changes return a precise error without partially mutating the document.
- Capture canonical Yjs bytes, clean Markdown, structured content, and revision/state-vector information from the same document state.
- Treat an empty clean export as a valid result; distinguish it from missing content or failed conversion. Do not silently replace it with a title/excerpt placeholder.

### 4.3 Working copy, review checkpoint, published snapshot

- Working content remains collaborative while a checkpoint is reviewed.
- A review cycle has an explicit submitted version ID; the UI loads that version.
- Approval/publication target that exact cycle and version. Reject stale decisions rather than looking up an unrelated latest checkpoint.
- Revisions of a published post go through the same checkpoint path. Existing readers retain the previous published snapshot during revision/review.
- Separate publication availability from working workflow status in API query rules; a previously published document must not disappear merely because a new revision is `in_review`.
- Publish relevant editorial metadata with the content snapshot so the reader does not accidentally combine a reviewed body with an unreviewed title/excerpt.
- Keep metadata save, manual working checkpoint, review submission, publication, and archive/restore as distinct operations and UI actions.
- Expose the selected view/version and `hasUnpublishedChanges` to clients. MCP reads of working content must not silently return the published body.

## 5. Delivery milestones

### Phase 0 — Capture reproducible contracts and fixtures

**Size:** Small. **Dependencies:** None.

Tasks:

- [ ] Document fresh-checkout setup and build prerequisites for the test workspace.
- [ ] Promote the reproduced API/MCP failures into focused regression tests using real route handlers and database fixtures.
- [ ] Create a browser-shaped rich-content fixture with every supported node/mark, not just the legacy shared schema.
- [ ] Add fixtures for two PAT owners, two Spaces, more than one catalog page, a published post with later working edits, and a pending-suggestion document.
- [ ] Make the Node oversized-header test accept the expected transport-level refusal contract on supported runtimes; isolate latency measurements from general parallel tests.

**Exit criteria:** Each P0 finding has a reproducible check or an explicitly assigned live integration scenario. The test runner reports genuine product regressions separately from missing build artifacts and runtime-specific assertions.

### Phase 1 — Implement request-scoped MCP identity

**Size:** Medium. **Dependencies:** Phase 0 fixtures. **Findings:** M01, M02; identity portion of M08/B09.

Tasks:

- [ ] Add the shared actor/scope types and API PAT context resolver.
- [ ] Read the incoming Bearer credential for HTTP MCP requests and inject actor-bound API/gateway clients.
- [ ] Keep request-scoped actor data through asynchronous tool execution and plugin handlers.
- [ ] Apply the same actor resolution to local stdio configuration.
- [ ] Resolve canonical post identity and full existing permission context before gateway edits.
- [ ] Align the Settings scope selector and compatibility aliases with the shared catalog.
- [ ] Normalize the API base URL once, configure MCP's API URL in Compose, and update client setup examples.

**Exit criteria:** Two MCP clients with different locally configured PATs can make interleaved/concurrent calls to one HTTP server. Drafts/comments/suggestions carry the correct owner and token identity, each client gets its permitted content, and the server has no shared user PAT configured. Token failures produce actionable responses. Existing stateless multi-request and resource tests still pass.

### Phase 2 — Fix content preservation and complete the eight tools

**Size:** Large. **Dependencies:** Phase 0 fixtures; Phase 1 for authenticated integration. **Findings:** M03–M08, B01, B02.

Recommended implementation order:

1. **Canonical schema and compatibility conversion.** Align browser, shared, template, and export representations. Add conversions for existing saved documents without rewriting immutable review/publication history in place.
2. **Shared rich Markdown importer/exporter and reader components.** Use one documented block specification; reuse the same rendering primitives for reader, review preview, and version preview.
3. **Atomic draft initialization.** Parse/validate initial content before creating the row; persist its canonical Yjs state, tags, COE, excerpt, and attribution together. Seed only newly created documents this way; subsequent content mutations go through the live room. Document initial pending-suggestion semantics and verify readback with `includeSuggestions: true` where applicable.
4. **Additive and suggestion operations.** Insert native rich nodes; preserve text/node identities in ongoing edits; support atom-block pending changes and actual suggestion IDs. Persist the supplied suggestion instruction as review context.
5. **Read/search contracts.** Return actual metadata, complete headings, selected view/revision, requested format, and suggestion visibility. Forward search to the shared API query contract.
6. **Comments and publication contract.** Resolve heading anchors to stable document positions. Persist publication notes/change summary. Add an explicit `submit_for_review` MCP wrapper over the existing API operation; keep `publish_post` for publication of an approved checkpoint and update its misleading description.

| Tool | Completion criteria |
|---|---|
| `search_posts` | Real server-side content query, tags/COE filters, limit/offset semantics, accurate total count and author/tag metadata; a match beyond page one is discoverable. |
| `get_post` | UUID and slug agree; Markdown, summary, and ProseMirror JSON are genuinely distinct; actual outline and version information; suggestion inclusion/exclusion is testable. |
| `create_post` | Required body and supplied metadata survive reload; no empty success after content initialization fails; repeated/long titles have predictable slug behavior. |
| `append_section` | Native rich nodes appear at document end in the same live room; existing content remains intact; attribution and reviewable pending changes survive reload. |
| `insert_after_section` | Inserts after the target section's subtree, consistently with current implementation intent; missing/ambiguous headings return a useful result; no partial insertion on failure. |
| `suggest_edit_section` | Produces valid, attributed suggestions; surrounding rich blocks remain valid; accept/reject and concurrent human typing preserve the intended content. |
| `add_comment` | General, anchored, and reply comments persist with correct actor/thread/anchor; no cross-post parent references. |
| `publish_post` | Uses the real approved checkpoint, returns the actual publication result/version, persists notes, and reports an invalid draft transition accurately. |

**Exit criteria:** Create a rich Glyphroom overview through authenticated MCP, retrieve its marked working JSON, open it in the browser, accept/reject sample suggestions, and verify that the intended clean content survives publication and export. The three resources and two prompt templates also remain discoverable and agree with the implemented syntax/workflow.

### Phase 3 — Make saving, review, republishing, and restore coherent

**Size:** Large. **Dependencies:** Canonical identity/schema and snapshot contract from Phase 2. **Findings:** B03–B07, B11; workflow portion of M07.

Tasks:

- [ ] Introduce a collaboration-side capture/checkpoint operation that acknowledges durable state. Submission waits for the intended visible edits and derives all snapshot formats from the same captured state.
- [ ] Centralize workflow transitions in a service shared by REST and MCP wrappers.
- [ ] Persist the active review-cycle/version reference and return it in review APIs.
- [ ] Render a pinned snapshot and a Markdown diff against the last published version in the review UI. Label later working changes separately.
- [ ] Route republishing through the same review/checkpoint flow while preserving the prior reader snapshot.
- [ ] Replace the `PATCH {status: draft}` no-op with explicit save/checkpoint or workflow actions. Use actual server responses for UI state; display approved/archived states accurately.
- [ ] Use database transactions for version/state updates, review decisions, tags, and outbox/notification records. Serialize per-post version allocation and add a unique `(post_id, version_number)` constraint with a migration for existing duplicates.
- [ ] Make retries for submission/publication idempotent and handle stale review actions as conflicts.
- [ ] Restore by reconstructing the selected snapshot's content into the current authoritative room as a new document operation. Capture a safety checkpoint first; publish remains unchanged until a later publication.
- [ ] Coordinate post deletion with live-room shutdown/tombstoning and prevent persistence from auto-provisioning a removed application post.
- [ ] Distinguish transport-synced, durably saved, metadata-saving, and failed states in editor feedback. Expose metadata errors instead of console-only failures.

**Exit criteria:** Type and immediately submit before the debounce expires; the reviewer receives exactly that checkpoint. Later edits do not change approval/publication. Restore works in two connected editors and after reload. Deleting with an editor connected cannot recreate the post. Injected failures/retries produce no partial workflow state or duplicate publication events.

### Phase 4 — Repair everyday blogging and deployment flows

**Size:** Medium–large. **Dependencies:** Shared query/actor/content contracts. **Findings:** B08–B10, B12–B14; metadata follow-ups.

Tasks:

- [ ] Extend one typed catalog query with Space, author/ownership, status sets, tags, COE, suggestion presence, sort, and pagination. Preserve current `search/page` clients while supporting accurate MCP `query/offset` adaptation, including non-page-aligned offsets.
- [ ] Select working versus published search projections according to the requested product view. Return lightweight card metadata and totals without requiring every dashboard to fetch full document bodies.
- [ ] Update My Work, Review Queue, Space pages, and Home summaries to filter/count server-side. Include approved work and genuine pending-suggestion counts.
- [ ] Protect catalog load-more against responses from an old filter/query. Load taxonomy options from the API.
- [ ] Read `spaceId` on New Post, preserve it through template creation, and expose the equivalent optional context in MCP creation.
- [ ] Pass full Space/post context into edit/review/comment/tag/upload operations so normal Space members can use their granted capabilities.
- [ ] Align optional/null comment fields, thread validation, anchors, resolved-thread behavior, and reader rendering.
- [ ] Deliver comment reply/mention notifications through the existing durable notification mechanism; keep polling as the supported baseline.
- [ ] Configure one API attachment storage directory and mount the durable volume there. Store relative keys, migrate existing absolute paths, and provide removal/orphan cleanup and missing-file feedback.
- [ ] Derive the browser WebSocket URL from the deployed origin and `/ws`, with an explicit override for separate deployments. Use the same routing convention in local development and Compose.
- [ ] Return clear slug-conflict/validation feedback and fix list/bookmark error states.

**Exit criteria:** With 60+ fixture posts across multiple Spaces, every relevant draft/review/approved post is reachable and counts are correct. Creating from a Space preserves its location. Editor and reader comments both work against the real API. Attachments survive API container recreation. A second machine can open the deployed editor and collaborate successfully.

### Phase 5 — End-to-end acceptance and documentation reconciliation

**Size:** Medium. **Dependencies:** Phases 1–4.

Tasks:

- [ ] Run the complete matrix below on a disposable full-stack deployment using real PostgreSQL, the real API, collab, MCP transport, and a browser.
- [ ] Add a reproducible smoke-test command that creates a tagged test post and records IDs/results, with cleanup of only its own fixtures.
- [ ] Complete the requested Glyphroom overview post as the human-readable feature demonstration.
- [ ] Update README, editor-block resource, prompt templates, feature-status tables, and deployment instructions to the verified behavior.
- [ ] Record the runtime/toolchain, commands, package results, and any remaining failures; update test-count claims from measured results.

**Exit criteria:** The user can keep a PAT locally, connect to the shared MCP server, create/read/edit/comment on a rich article, submit it, have a reviewer approve its pinned version, publish it, and find/read/export it with no lost content or manual database intervention.

## 6. Required acceptance matrix

| Scenario | Required assertions |
|---|---|
| Two independent HTTP MCP users | Interleaved create/read/comment/edit calls keep identity, scopes, post visibility, and attribution independent. Include a plugin tool context check. |
| Local stdio client | Local PAT resolves to the same actor model; tools and resources work; stdout remains valid MCP framing. |
| All eight current tools | Exercise every documented input, each meaningful format/filter, real result metadata, and relevant failure responses. No silent ignored arguments. |
| Resource/prompt discovery | Three current resources and two current prompts are accessible; generated example content uses supported syntax. |
| Rich-content round trip | Paragraphs, H1–H6, inline marks/links, nested lists/tasks, tables, code, five alert types, Mermaid, inline/display math, status cards, images, and attachments survive browser/MCP → Yjs → restart → review → published reader/export. |
| Pending suggestions | Text and atom-block insertions/deletions behave correctly before/after accept/reject; clean reader/export output follows the existing suggestion rules. |
| Canonical addressing | A browser using UUID and an MCP tool using slug edit one room. Both see all changes; persisted state agrees after restart. Legacy fragments are handled consistently. |
| Immediate review capture | Keystroke immediately followed by submit is present in the captured checkpoint; JSON and Markdown represent the same content. |
| Moving review target | Edit after submission, then approve/publish: reader sees only the submitted checkpoint; later work remains available to editors. |
| Republish and stale decisions | Prior reader snapshot remains available during re-review; publication references the newly approved version; decisions against an older cycle are rejected clearly. |
| Failure/retry/concurrent workflow | Failed writes roll back; duplicate requests do not create duplicate milestones/events; concurrent version numbers remain unique. Run against PostgreSQL. |
| Restore/delete with live editors | Restore updates both clients and durable storage; original publication stays pinned. Delete is not undone by a late room flush or reconnect. |
| Catalog/dashboard completeness | More than 24 results, combined filters, arbitrary MCP offsets, complete counts, old-query responses, and empty/error states behave consistently. |
| Space authoring | New Post preserves Space context; existing Space authors/reviewers/maintainers can perform their intended actions without requiring a separate direct invitation. |
| Comment lifecycle | Unanchored/anchored root comments, one-level replies, same-post parent validation, resolve/reload, and reply notifications all work through real client payloads. |
| Attachment/deployment continuity | Upload → reader/download → API container recreation → download; browser on a different host reaches the proxied collaboration service. |

## 7. Suggested pull-request sequence

| PR | Deliverable | Depends on |
|---|---|---|
| 1 | Baseline setup, cross-layer regression fixtures, runtime-compatible test assertions | — |
| 2 | API PAT context, request-scoped MCP clients, scope catalog, local-client docs | 1 |
| 3 | Canonical room/fragment identity and schema compatibility | 1 |
| 4 | Rich import/export/rendering and structured suggestion operations | 3 |
| 5 | Complete create/get/search/comment MCP contracts and explicit review-submission wrapper | 2, 4; shared query work can be developed alongside this |
| 6 | Durable capture, pinned review UI, transactional workflow, correct republishing | 2, 3, 4 |
| 7 | Live restore/delete coordination and accurate save feedback | 3, 6 |
| 8 | Server-filtered dashboards, Space creation/context, comment/thread/notification fixes | 2, 5, 6 |
| 9 | Durable attachments and deployed WebSocket/API routing | 3; can start earlier alongside content work |
| 10 | Full-stack acceptance, Glyphroom demonstration post, documentation/status reconciliation | 5–9 |

Use small, independently reviewable changes inside the large content/workflow milestones. The first useful checkpoint is **PRs 1–5:** a caller-local PAT can create a correctly attributed, nonempty rich draft and read back its actual working content. The completion checkpoint adds review/publication/restore and the everyday blogging journeys.

## 8. Implementation completion checklist

- [ ] Local user credentials work against a shared remote MCP server with per-request identity.
- [ ] All eight advertised tools honor their inputs and return truthful, typed results.
- [ ] Rich content and suggestions survive every authoring, storage, and reading boundary.
- [ ] Reviews and publications reference the exact checkpoint shown to the reviewer.
- [ ] Restore, deletion, and immediate-submit operations coordinate with live collaboration.
- [ ] Work lists, Space context, comments, metadata, and attachment persistence work through the actual UI/API contracts.
- [ ] Typechecks and the relevant automated/full-stack tests pass on the documented runtime.
- [ ] The original requested Glyphroom overview exists in Glyphroom and demonstrates the verified features.
