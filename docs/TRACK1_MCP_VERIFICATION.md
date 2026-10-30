# Track 1 and live MCP verification

**Date:** 2026-10-30. **Source:** `de2cda8`, including Track 1 commit `f3177f3`.

## Summary

The complete workspace build and all eight typechecks passed. Forty-seven focused API/MCP/web regression tests passed. The authenticated live MCP successfully read existing posts and created three drafts, including a full Glyphroom showcase.

Track 1's endpoint and workflow changes are present, but verification found functional gaps that prevent calling the entire workflow complete.

## Created posts

These IDs belong to the tested Glyphroom instance. All three posts are drafts.

| Post | ID | Reader path |
|---|---|---|
| Glyphroom MCP Authoring Smoke Test - 2026-10-30 | `9d322a37-7ab7-4ad9-bcee-6075f45b2f62` | `/posts/glyphroom-mcp-authoring-smoke-test-2026-10-30` |
| Glyphroom Track 1 Checkpoint Notes - 2026-10-30 | `5c4c4f7f-53a6-4aa4-b574-d0cbf4aa3e3b` | `/posts/glyphroom-track-1-checkpoint-notes-2026-10-30` |
| Glyphroom: Current Platform Guide and Rich-Content Showcase - 2026-10-30 | `a0624438-82eb-4524-9752-c1fe5e4302ac` | `/posts/glyphroom-current-platform-guide-and-rich-content-showcase-2026-10-30` |

The showcase supplied every field exposed by `create_post`: title, content, excerpt, tags, and a valid COE ID (`eb5a76d1-518a-41e7-82d1-2b7d23be9eb3`, Architecture Center of Excellence). COE discovery used the public API taxonomy endpoint because the current MCP catalog has no taxonomy-list tool.

MCP readback confirmed an approximately 8 KB body containing all five alerts, Mermaid, math, status-card syntax, tables, checklists, code, and a repository link. Tags persisted. A verification comment and threaded reply were added:

- Comment: `f26bba36-d9cc-4f2d-a11e-877ae8748287`.
- Reply: `8836c1bc-ce3f-4760-aa6d-a569d1cb13f2`.

The comment request included `anchorHeading`; the current MCP implementation does not persist that heading anchor. The user's reader screenshot confirms that the body is visible while tables, diagrams, math, and status syntax lack complete native rendering.

## Automated checks

| Area | Files / command | Result |
|---|---|---|
| Build | `pnpm build` | Passed |
| Types | `pnpm typecheck` | Eight workspaces passed |
| API | `publication-workflow.test.ts`, `api-integration.test.ts`, `catalog-search.test.ts` | 19 passed |
| MCP | `user-auth.test.ts`, `server-http.test.ts` | 4 passed |
| Web | `mywork-reviewqueue.test.tsx`, `collaborative-editor.test.tsx` | 24 passed |

The six Track 1 tests inject a mocked `CollabService`. Their success verifies API behavior around supplied snapshots, not the real HTTP request shape or active-room durability.

## Findings requiring follow-up

### 1. Flush/tombstone client requests fail before the handler

`apps/api/src/services/collab.ts` sends `Content-Type: application/json` with no body for flush/tombstone. A direct test against the actual local collab server produced:

```json
{
  "statusCode": 400,
  "code": "FST_ERR_CTP_EMPTY_JSON_BODY",
  "message": "Body cannot be empty when content-type is set to 'application/json'"
}
```

Sending the same flush request with body `{}` returned `200`, `inMemory: true`, and `workingMarkdown: "Live checkpoint text"`.

**Next action:** send an explicit JSON body or omit JSON Content-Type for bodyless methods. Distinguish dependency/HTTP failure from an idle room; add a real API→collab test. Also wire the API's `COLLAB_URL` and gateway credential in Compose.

### 2. Direct republish still skips a new review

`apps/api/src/routes/posts.ts` `/republish` checks edit permission and current published status, then snapshots working content and publishes it. It does not select a newly approved review checkpoint. This remains a source-confirmed workflow gap.

### 3. Empty snapshots and restore ordering remain incomplete

Submission/republish only replace cached Markdown when `flushed.workingMarkdown` is truthy, so an empty live document can retain stale cached text. Restore updates the active room, then the API writes the historical Yjs bytes over the newly cloned canonical state. Failure results from the collab service are also ignored by callers.

These paths need real-room regression coverage, including empty content, unavailable collab, reconnect after restore, and late flushes after deletion.

### 4. Live MCP collaboration gateway is unavailable

An append to the smoke-test draft returned:

```text
[CONNECTION_ERROR] Failed to communicate with Collab Gateway: fetch failed
```

Read/create/comment operations worked through the API. Check the running collab process and the MCP process's `COLLAB_GATEWAY_URL`/`AGENT_GATEWAY_URL`; package-local `.env` values override inherited values. Insert/suggestion operations were not retried against the same unavailable dependency.

### 5. Search and read-format contracts remain incomplete

- `search_posts(query="Glyphroom", limit=1, offset=1, tags=[a nonexistent tag])` returned four posts.
- `get_post(format="summary")` and `get_post(format="prosemirror_json", includeSuggestions=true)` returned Markdown.
- Search still returned empty tags and placeholder author names while direct post reads returned real tags and authors.

### 6. Concurrent tag creation fails

Creating two drafts concurrently with shared tags produced a `500` / PostgreSQL `23505` error against `tags_name_key` for one draft. The failed draft was checked before retrying; sequential creation succeeded and both drafts were read back.

**Next action:** make tag upserts safe across both unique name/slug constraints and concurrent transactions, with a PostgreSQL regression test.

## Scope of verification

Real MCP operations used the caller's locally configured PAT. No existing post was edited, and no review decision or publication was performed on the new drafts. The collab HTTP request-shape reproduction ran against a disposable local server, not the deployed user's documents.

The initial local workflow probes encountered the in-memory database's binary fixture representation and were not counted as successful end-to-end verification. The focused real-HTTP flush reproduction above is the confirmed transport result.
