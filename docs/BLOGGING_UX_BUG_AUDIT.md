# Blogging UX Bug Audit

**Date:** 2026-11-02  
**Scope:** Editor, block mode, preview, reader, My Work, collaboration, Docker delivery

## Executive summary

The blogging experience has several independent problems across four boundaries:

1. The browser editor and Yjs history state are not always reflected by the UI.
2. Rich blocks use multiple serialization and rendering paths, so tables and Mermaid diagrams can look correct in one mode and fail in another.
3. Working content, published content, preview content, and version previews do not consistently use the same renderer or checkpoint.
4. The Docker workflow does not currently prove that the running web container contains the source change that was just built.

The highest-risk work is rich-content round-trip correctness and production undo/redo verification. These should be fixed before polishing lower-impact navigation details.

## Current repository and deployment observations

- The repository contains approximately **67k application/test source lines**, **9 workspace packages**, and **101 test files**.
- `docker compose -f docker-compose.prod.yml config --quiet` passes.
- The current Compose stack has healthy API, Collab, Postgres, and Web services.
- `glyphroom-mcp-server` is currently **unhealthy**.
- The running `glyphroom-web` image does not contain the current worktree marker for the undo/redo UI refresh. The browser is therefore not proven to be running the latest source bundle.
- `docker/Dockerfile.web` correctly copies `apps/web` after dependency installation, but the deployment process has no asset/version verification step and static `/assets/` files are cached for one year.

## Prioritized bug list

### P0 — release blockers

#### BLOG-001 — Undo/redo fix is not verified in the running Docker web image

**Symptoms:** Ctrl+Z/Ctrl+Y and toolbar undo/redo appear unavailable after rebuilding Docker.

**Evidence:**

- `apps/web/src/components/Editor.tsx` reads `editor.can().undo()` and `editor.can().redo()` for button state.
- Yjs changes history outside React; the current worktree contains a transaction subscription to refresh those controls.
- The running `glyphroom-web` asset bundle does not contain that current source marker.
- `docker/nginx/nginx.conf` gives `/assets/` a one-year cache lifetime.

**Likely causes:** stale image, cached browser asset, or a rebuild/restart that did not replace the web container. The existing unit tests do not exercise Ctrl+Z/Ctrl+Y in a real production browser against the Docker bundle.

**Required fix:**

- Add a visible web build/version identifier.
- Use content-hashed assets and no-cache headers for `index.html`.
- Add a deployment smoke check that fetches the running bundle and verifies the expected build identifier.
- Add a browser test for typing → Ctrl+Z → Ctrl+Y, toolbar undo/redo, and a second user/agent edit.
- Verify the Yjs UndoManager stack and the browser result, not just button enabled state.

#### BLOG-002 — Rich-content round-trip is not one canonical path

**Symptoms:** A block can render correctly in the editor but display as raw Markdown or incomplete content in preview/reader mode.

**Evidence:**

- The editor renders TipTap node views directly.
- Preview and reader mode export ProseMirror JSON to Markdown, parse Markdown again, and render separate presentation components.
- `packages/shared/src/export/markdown.ts` has a ProseMirror-node serializer and a fallback JSON serializer.
- `apps/web/src/components/reader/markdown.ts` has an independent conservative Markdown parser.

**Impact:** tables, Mermaid, code, formulas, attachments, status blocks, and marks can diverge between edit, preview, published reader, and version preview.

**Required fix:** Define and test one canonical rich-document projection. Every supported node needs an editor JSON → exported Markdown → reader render round-trip test, including empty cells, escaped pipes, multiline Mermaid, suggestions, and nested content.

### P1 — major blogging defects

#### BLOG-003 — Mermaid labels are blank in edit/block mode

**Symptom:** The diagram shape appears in the editor, but node labels/text are missing; the reader/preview shows the labels.

**Likely cause:** The editor Mermaid node view uses a different sanitization configuration from the reader:

- `apps/web/src/extensions/mermaid.tsx` uses `USE_PROFILES: { svg: true, svgFilters: true, html: true }` and permits `foreignObject`.
- `apps/web/src/components/reader/presenters/MermaidBlock.tsx` uses the shared strict SVG sanitizer.
- Mermaid labels commonly use SVG text and/or `foreignObject`; the editor path can strip or invalidate the label DOM while retaining the diagram geometry.

**Required fix:** Share one Mermaid renderer/sanitizer between edit and reader modes. Add tests for flowchart labels, edge labels, sequence diagrams, and multiline labels. The editor should show a visible syntax/render error rather than a blank diagram.

#### BLOG-004 — Preview title is duplicated when post title and first H1 differ

**Symptom:** If the post title equals the first H1, preview suppresses one heading. If they differ, preview renders both.

**Evidence:** `ReaderPreview.tsx` only suppresses its title when the first Markdown line is an exact matching `# ...` heading. `ReaderView.tsx` always renders the post title separately.

**Required product decision:** Choose one title policy:

- metadata title is always the article title and the first top-level H1 is suppressed; or
- document H1 is the article title and the separate metadata title is hidden when an H1 exists; or
- preview explicitly labels the two levels.

Apply the same policy to ReaderView, ReaderPreview, exports, search cards, and version previews.

#### BLOG-005 — Tables can degrade to raw pipe Markdown

**Symptom:** Editor/block mode shows a table, while preview/reader shows text resembling:

```text
| Col 1 | Col 2 | ... | --- | --- | ... | Data 1 | Data 2 |
```

**Likely causes:** malformed or differently shaped table Markdown, fallback serialization, or a parser boundary failure. The parser only recognizes a table when the header and divider are separate lines matching strict patterns. The fallback serializer also pads rows to a calculated width, which can expose malformed empty columns if the input shape is inconsistent.

**Required fix:**

- Normalize table width before serialization.
- Escape pipes inside cell content consistently.
- Preserve empty cells without producing extra structural columns.
- Parse tables from the canonical JSON projection rather than reparsing lossy Markdown where possible.
- Add tests for 1x1, 3x3, uneven rows, empty cells, multiline cells, escaped pipes, and tables beside Mermaid/code blocks.

#### BLOG-006 — My Work rows are not clickable

**Symptom:** Users must find and click the separate Edit or View button. Clicking the post title/row does nothing.

**Evidence:** `MyWorkView.tsx` only attaches navigation handlers to the action buttons.

**Required fix:** Make the row or title navigate to the primary destination, likely edit for drafts and shared editable work, reader for published/read-only work. Add keyboard support and stop propagation on secondary actions.

#### BLOG-007 — Version snapshot preview is a second, incomplete Markdown renderer

**Symptom:** Version previews render headings and list lines manually but do not render tables, Mermaid, code blocks, math, alerts, or links as the main reader does.

**Evidence:** `VersionsTab.tsx` uses `snapshotContent.split('\\n')` and a few prefix checks instead of `MarkdownRenderer`.

**Required fix:** Route version preview through the shared reader renderer and display the exact snapshot source/version metadata.

#### BLOG-008 — Save status means WebSocket sync, not durable persistence

**Symptom:** The UI can show “Saved” even though the database snapshot or title metadata has not completed successfully.

**Evidence:** `SaveStatusBadge.tsx` uses provider status and `hasUnsyncedChanges`; title autosave failures are logged in `EditorView.tsx` rather than shown to the user.

**Required fix:** Distinguish `synced`, `persisting`, `saved`, `save failed`, and `offline`. Surface title/metadata failures with retry. Add a durable checkpoint acknowledgement before submission.

#### BLOG-009 — Submit/review can use stale working content

**Symptom:** A user submits immediately after editing and the review checkpoint may not contain the latest visible content.

**Evidence:** The reliability audit already identifies the API/database checkpoint versus live Hocuspocus room race. The editor waits for provider sync, but transport sync is not the same as confirmed durable capture.

**Required fix:** Add a collaboration-side capture/checkpoint operation. Submission should wait for an acknowledgement containing the current document fingerprint, then create the immutable review snapshot from that captured state.

#### BLOG-010 — Restore/version operations are unsafe with an open editor

**Symptom:** Restoring a version while another editor is open can be overwritten by the live Yjs room or a later persistence flush.

**Evidence:** The existing reliability plan documents direct database restore plus old Yjs update merging as unsafe.

**Required fix:** Restore through the live collaboration authority, invalidate/rebase open clients, wait for durable acknowledgement, and show a conflict/reload state to other editors.

#### BLOG-011 — My Work counts and lists can be incomplete

**Symptom:** Older posts may be absent from tabs or counts after pagination changes.

**Evidence:** The reliability audit identifies local filtering and pagination problems across My Work, Review Queue, Home, and Space views. `MyWorkView` now loops pages, but other surfaces still use bounded first-page queries.

**Required fix:** Centralize paginated post querying and count contracts. Test 0, 1, 24, 25, and 101 posts across every blogging surface.

#### BLOG-012 — Review status semantics are inconsistent

**Symptom:** `approved` is grouped into “In Review,” while the editor actions and lifecycle rules can treat it differently. The UI can expose actions that do not match the immutable review model.

**Required fix:** Define a single lifecycle state machine and action matrix for draft, in review, approved, published, changes requested, and archived. Use it in My Work, editor toolbar, review queue, and API validation.

### P2 — important usability and consistency work

#### BLOG-013 — Editor and reader Mermaid security/rendering behavior differs

Even when labels render, differing Mermaid initialization and sanitization settings can produce different diagrams. Share configuration and add visual regression coverage.

#### BLOG-014 — Block-mode controls can perform destructive actions without enough context

The floating card controls expose delete and move operations close to the active content. Add undo-friendly feedback, clearer focus states, and confirmation only for destructive whole-card deletion if the operation cannot be recovered reliably.

#### BLOG-015 — Block mode and document mode have different editing semantics

Block mode intercepts Enter, Shift+Enter, paste, and card insertion with custom behavior. This needs a documented keyboard model and tests for lists, tables, code, Mermaid, headings, and selections. Current behavior is likely surprising when selection is inside a nested node.

#### BLOG-016 — Preview mode wording is ambiguous

The editor calls the mode “Reader Preview,” while it is a live projection of the working editor JSON and may exclude pending AI insertions. Label it explicitly as “Working preview” or “Reader projection of current working content.”

#### BLOG-017 — Search/catalog and My Work navigation are inconsistent

Catalog cards open the reader and expose a small edit icon; My Work exposes both Edit and View buttons. Establish a consistent primary click action and action hierarchy across Home, Catalog, My Work, Bookmarks, and Reader.

#### BLOG-018 — MCP server is unhealthy in the current Compose stack

This is not only an agent bug: it can affect blogging suggestions and content discovery. The current health check calls `/healthz`, but the running MCP container is unhealthy. Capture its logs and verify the route, startup dependency, and API/gateway connectivity before relying on AI editing workflows.

## Recommended implementation order

### Phase 1 — correctness and deployment proof

1. Add build ID/version reporting and fix Docker/browser cache validation.
2. Add a real browser smoke suite for edit, Ctrl+Z/Ctrl+Y, toolbar history, refresh, and reconnect.
3. Unify Mermaid rendering and sanitization.
4. Unify rich-block serialization/rendering and fix table round trips.
5. Replace version preview's hand-written renderer.

### Phase 2 — workflow integrity

1. Add durable collaboration capture before submit.
2. Make restore safe with active rooms.
3. Correct save/error status semantics.
4. Normalize lifecycle actions and permissions.
5. Fix pagination/count contracts.

### Phase 3 — UX polish

1. Make My Work rows clickable.
2. Apply one title policy everywhere.
3. Normalize primary actions across Catalog, Home, My Work, and Reader.
4. Improve block-mode keyboard and destructive-action affordances.
5. Resolve MCP health and add an end-to-end agent suggestion smoke test.

## Acceptance checklist

- Type in a Docker-served editor, reload the page, and verify the edit persists.
- Type, Ctrl+Z, Ctrl+Y, toolbar undo, toolbar redo, and verify content plus button state.
- Perform the same test with a second connected client and an agent suggestion.
- Insert and edit a Mermaid diagram; labels match in document, block, preview, reader, and published snapshot.
- Insert tables with empty cells and escaped pipes; all render as tables in every read-only surface.
- Verify title-only, matching-title/H1, and different-title/H1 documents.
- Click a My Work row/title with keyboard and mouse; secondary actions remain independent.
- Preview a version containing every supported rich block.
- Submit immediately after typing and verify the immutable checkpoint contains the visible edit.
- Restore while another client is open and verify both clients converge to the restored state.
- Rebuild Docker, verify the running build ID, hard-refresh the browser, and confirm the new bundle is served.
- Confirm all Compose health checks are green, including MCP.

## Related existing audit

The broader service/API findings are already tracked in `docs/MCP_AND_BLOGGING_RELIABILITY_PLAN.md`, especially B01–B14. This report adds the user-facing blogging symptoms, their editor/reader entry points, and a proposed implementation order.

## Follow-up investigation — 2026-11-03

The latest user verification found three remaining items:

- **Undo/redo is fixed in the mounted React editor.** TipTap React was reconfiguring ProseMirror plugins on mount, which destroyed the Yjs UndoManager listener while retaining the editor state. The manager now survives plugin reconfiguration and is cleaned up when the editor is destroyed. Ctrl+Z/Ctrl+Y, toolbar undo/redo, and mounted-editor regression coverage pass.
- **Live preview now follows current edits.** `CollaborativeEditor` mirrors local, undo/redo, and collaborative document transactions into React state before passing the snapshot to `ReaderPreview`. A regression test verifies that newly inserted text appears immediately after switching to Preview.
- **Four-column tables now render correctly in preview.** The Markdown divider parser previously accepted only one- and two-column divider patterns, so TipTap tables with empty columns became plain pipe text. The parser now accepts any column count, with regression coverage for empty cells and mixed populated rows.
- **My Work primary row navigation opens reader view.** The explicit Edit action remains available for authors/editors.
- **Preview terminology is now consistent.** The visible mode labels and accessibility titles use `Document View` and `Blocks View`; the editor banner identifies the mode as `Working Preview` and describes current edits rather than published content.

Verification after these fixes: full web suite **207 tests passed**, shared suite **337 tests passed**, web typecheck passed, production web build passed, and the rebuilt Docker Web container is healthy. `/index.html` serves `Cache-Control: no-cache, no-store, must-revalidate`.
