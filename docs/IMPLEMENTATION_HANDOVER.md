# Glyphroom implementation handover

**Updated:** 2026-10-30. **Base commit:** `159607f`. This handover accompanies the first major-fix batch.

## Start here

The user requested an efficient first batch of major bug fixes, followed by a handover. This batch addresses caller-local MCP authentication, lost draft bodies/metadata, rich-content export loss, invalid structured suggestions, comments, and deployment wiring.

**Next recommended implementation:** the live checkpoint/review/republish/restore work described below. The larger inventory is [MCP_AND_BLOGGING_RELIABILITY_PLAN.md](MCP_AND_BLOGGING_RELIABILITY_PLAN.md); its numbered findings describe the pre-fix audit. Use this handover for current completion status.

Advanced security hardening remains the next phase. Basic caller identity and existing editing permissions are implemented as functional requirements.

## Delivered in this batch

| Area | Implementation | Status / limits |
|---|---|---|
| Per-user HTTP MCP PAT | `apps/mcp-server/src/index.ts` constructs actor-bound API/gateway clients per request. `/api/v1/auth/me` now returns PAT ID/scopes, populated by `apps/api/src/plugins/auth.ts`. | HTTP ignores server-global user PATs. Each supplied PAT is revalidated per request. Local stdio uses its local environment token through the same context resolver. Catalog/resources can connect anonymously; tools require caller capabilities. |
| MCP permissions and attribution | `src/api/client.ts` checks tool scopes; `src/gateway/client.ts` resolves editable UUIDs through the API before edits; `src/server.ts` supplies caller identity/scopes to plugin tools. | `posts:write` aliases draft/suggest; singular `post:*` aliases are supported where mapped. Comment/publication scopes remain explicit. Broader direct-API scope enforcement and browser WS authentication are later work. |
| Draft content and metadata | MCP creation forwards body/tags/COE. API stores body in canonical Yjs plus derived Markdown and atomically creates the post, tags, and view counter. PAT creation audit entries carry agent/token identity. | **Interim representation:** the complete Markdown body is preserved as text in one paragraph. It is not yet parsed into native rich nodes or native section headings. Initial content is ordinary draft content; subsequent append/insert operations still create pending suggestions. |
| API URL normalization | MCP accepts either API origin or an origin ending in `/api/v1`; Compose points it to `http://api:4001`. | Removes the duplicated-prefix and container-localhost mistakes. |
| Rich-block Markdown export | `packages/shared/src/export/markdown.ts` supports browser camelCase nodes, bold/italic/strike, code, tables, tasks, diagrams, formulas, status cards, images, and attachments in its JSON compatibility path. | Preserves exports. The reader still has its limited Markdown renderer. This does not retroactively repair already-lossy stored publication Markdown. |
| Structured suggestion corruption | `packages/shared/src/suggestion/operations.ts` rejects unsupported container/atom sections before mutation; gateway returns validation failure. | Safe explicit refusal replaces invalid table/list/blockquote mutations. Structured diffs remain to implement. Existing nested suggestion accept/reject functionality is retained. |
| Room/fragment consistency | Runtime MCP resolves slugs to the same UUID room the browser uses. Persistence prefers a populated `prosemirror` fragment consistently with the editor. | Legacy fragment migration and live-room restore/deletion still need work. |
| Comments | API accepts null optional parent/anchor fields from the editor and requires a reply parent from the same post. | General/reply comments work. MCP heading anchors, reader thread rendering, and reply notifications remain. |
| Space creation | `NewPostView.tsx` reads and submits `?spaceId=...`. | Existing mutation routes still need complete Space permission context. |
| Deployment | Browser WS defaults to same-origin `/ws`; API supports `ATTACHMENT_STORAGE_DIR`; Compose mounts attachments at `/app/uploads`; API image creates that directory with the application user's ownership. | Configuration changed, but Docker validation/deployment was unavailable in this WSL environment. Existing attachment files require preservation when introducing the volume. |

MCP scope enforcement is in `ApiClient` and the actor-bound gateway resolver. An omitted `actor` remains supported for explicitly injected legacy test/service clients; real HTTP/stdio startup always supplies an actor or explicit `null`. Preserve that distinction when refactoring.

## Verification

Runtime: Linux Node `v24.9.0`, pnpm `12.15.0`.

- Build: shared, API, collab, and MCP packages passed.
- API: 20 selected integration/attachment/Space tests passed.
- Shared: the full run passed 330 tests and exposed two old characterization tests that expected the corrupt structured-edit behavior. Those expectations now assert rejection with zero mutation; the focused rerun passed all 26 browser/structured-edit tests.
- MCP: all 38 tests passed, including the new two-user HTTP/API and revocation regressions.
- Web: 24 selected editor/block/attachment tests passed.
- Collab: 24 selected gateway/persistence tests passed.
- Integration workspace: all 112 tests passed, including 10,000-operation convergence.
- TypeScript: all eight workspaces passed after the final build.
- Docker Compose validation could not run because Docker is unavailable in this WSL distribution. Deployment remains to be exercised.

Important regression coverage:

- `apps/mcp-server/tests/user-auth.test.ts`: real HTTP MCP + actual Fastify API/in-memory database, two concurrent PAT owners, persisted bodies/tags/COE, correct canonical IDs and gateway identity headers, inaccessible draft rejection, anonymous/read-only refusal, token revocation, editor-shaped comments, cross-post parent rejection. Gateway writes use a recording HTTP stub; existing collab integration tests cover the CRDT path separately.
- `packages/shared/tests/browser-roundtrip.test.ts`: mixed browser rich-node exports, pending code suggestion export rules, and no Yjs mutation on rejected table edits.
- `packages/shared/tests/suggestion/adversarial-suggestion-stress.test.ts`: replaces two tests that characterized corruption with non-mutation regression assertions.
- `apps/web/tests/collaborative-editor.test.tsx`: verifies new drafts retain the Space query context.

The original full-workspace audit had a pre-existing Node 24 test mismatch in `apps/collab/tests/agent-gateway-stress.test.ts`: it expects a socket rejection for an oversized header, while Node returns HTTP `431`. A concurrent health-latency assertion also failed under load and passed in isolation. These are documented baseline issues, not fixed in this batch.

## Next work, in priority order

### 1. Live checkpoints and correct publication workflow — B03–B07, B11

Entry points:

- `apps/api/src/routes/posts.ts`: submit-review, publish, republish, versions/restore, delete.
- `apps/api/src/routes/reviews.ts`.
- `apps/collab/src/server.ts`, `gateway/`, `persistence/postgres.ts`.
- `apps/web/src/views/ReviewQueueView.tsx` and `components/editor/{SubmitReviewButton,SaveStatusBadge,tabs/VersionsTab}.tsx`.

Required behavior:

1. Capture the intended live Yjs state before creating a review checkpoint; persisted state can lag by 3–10 seconds.
2. Load the pinned checkpoint in the review UI instead of mutable `workingMarkdown`.
3. Route republishing through the reviewed-checkpoint workflow. It currently publishes the author's mutable working content directly.
4. Retain the prior published snapshot while a new revision is reviewed; changing working status must not hide the existing publication.
5. Replace the `PATCH {status: 'draft'}` no-op with real save/checkpoint/workflow actions and accurate UI states.
6. Restore content through the active room as a new operation. `Y.applyUpdate(oldSnapshot)` does not undo later CRDT changes, and direct database replacement can be overwritten by a live room.
7. Coordinate deletion with room shutdown/tombstoning; the persistence auto-insert fallback can recreate a deleted post.
8. Add workflow transactions, stable review-cycle references, idempotent retries, and unique per-post version numbering. Draft creation now has a transaction; audit/outbox and the other workflows still need consistent transaction boundaries.

Acceptance: type → immediate submit → edit again → review/publish produces exactly the pinned content; two connected editors observe restore; a late flush cannot resurrect a deleted post. Verify transaction behavior against PostgreSQL, not only pg-mem.

### 2. Native Markdown import, real MCP reads, and structured suggestions — M03/M05/M06, B01/B02

- Implement one Markdown-to-native-document importer for create/append/insert. Current creation preserves the body literally, while append/insert still split text into paragraphs. Heading-targeted edits on an initial Markdown heading need the native importer.
- Align browser/shared schemas with compatibility handling for existing node names; retain the export improvements.
- Implement actual `get_post` format and `includeSuggestions` handling, real outlines, and explicit working/published views. It still prefers reader/published content and does not honor formats.
- Preserve the structured-edit rejection until a valid, non-destructive structured diff exists. Include atom-block pending changes and accept/reject behavior.
- Replace reader/version ad-hoc Markdown parsing with shared rich rendering.
- Plan repair of already-lossy exports from their matching immutable Yjs version, not from the latest working document.

### 3. Complete search and work lists — M04, B08/B14

- MCP search still filters only the first API page and ignores offset/tags/COE.
- API query schema uses `search/page/limit`; add shared Space/author/tags/status-set/suggestion filters and correct arbitrary offset adaptation.
- My Work/Review Queue/Space/Home consumers still fetch one 24-item page and filter locally. Include approved posts, real totals, and genuine suggestion counts.
- Add stale-query protection to catalog load-more and select the intended working/published search projection.

### 4. Remaining daily workflows — M07, B09/B10/B12

- Carry complete post/Space context into permission resolution across metadata, tags, comments, review, and upload routes.
- Implement MCP heading anchors and persist editorial notes/instructions; expose explicit review submission rather than claiming `publish_post` submits a draft.
- Render comment threads and send reply/mention notifications.
- Introduce relative attachment keys, removal/cleanup, and migration of old storage paths.
- Test the updated deployment from a second machine and across API container recreation.

## Applying the fixes to a running instance

1. Rebuild/redeploy **API and MCP together**: the updated MCP requires the API's PAT context response. Deploy shared/collab/web builds for the export, validation, and browser changes.
2. Configure `GLYPHROOM_PAT` locally in OpenCode and send `Authorization: Bearer {env:GLYPHROOM_PAT}` in the remote MCP entry; use the V2 example in the plan. The shared HTTP MCP service does not need a server-wide user PAT.
3. Existing read/write PATs support reading, draft creation, and suggestions. Grant `comments:write` for comments and explicit `posts:publish` for permitted publication. Settings now exposes these options.
4. For existing Docker installations, preserve the API container's `/app/uploads` files **before container recreation**, then restore them into the new mounted volume. The previous Compose attachment mount was on collab instead of API. Existing database paths are still absolute.
5. Run the two-user smoke test and a real rich-document browser/publication test. Docker was unavailable here, and the external connected MCP instance has not been redeployed or mutated by this implementation pass.

## Efficient commands and workspace notes

The default `pnpm` on this machine is a Windows executable. Prefix pnpm commands with `npm exec --yes --package=pnpm@12.15.0 --` when working in this WSL checkout.

```bash
pnpm --filter @enterprise-blogger/shared --filter @enterprise-blogger/api --filter @enterprise-blogger/collab --filter @enterprise-blogger/mcp-server run build
pnpm -r --no-bail run typecheck
pnpm --filter @enterprise-blogger/mcp-server test
pnpm --filter @enterprise-blogger/shared test
pnpm --filter @enterprise-blogger/tests test
```

- Build collab/MCP before checking the integration workspace: it imports their `dist` exports.
- `opencode.jsonc` was already user-modified before this task. Preserve that configuration.
- The audit plan and documentation index also predate this implementation pass.
- `graphify update .` was run per `CLAUDE.md`; `graphify-out/` now exists and is ignored by Git. Follow the graph-query instructions for future exploration. SQL extraction reported its optional parser dependency missing.
- No new npm dependencies or database schema migrations were introduced in this batch.
