# Glyphroom Feature Completion & Improvement Plan

> **Status:** In Progress — Phase 1 & 3 Core Features Integrated & Verified  
> **Focus:** Completing core product features and correcting partially delivered behavior  
> **Test Status:** 630/630 tests passing across all workspace projects (`shared`, `api`, `web`, `collab`, `mcp-server`, `tests`).  
> **Explicitly excluded:** Security hardening, SSO provider integration, and pilot-gating security work

## Integrated Feature Delivery Status

| Workstream | Area | Delivery Status | Automated Coverage |
|---|---|---|---|
| **A1, A2** | Review Checkpoint & Post State Machine | **DELIVERED** (Immutable `review_submission` snapshot, `submitted_version_id` pinning, changes requested → draft transition, post-submission edits excluded from publish) | `apps/api/tests/api-integration.test.ts` |
| **C1, C2** | Space Administration & Safeguards | **DELIVERED** (Space rename, description edit, archive/restore, prevent last-owner removal safeguard, Space Settings UI tab) | `apps/api/tests/spaces-and-access.test.ts` |
| **D1, D3** | Server-side Catalog Pagination & Search | **DELIVERED** (SQL query parameters `limit`/`offset`/`q`/`spaceId`/`coeId`/`tag`, load-more pagination UI) | `apps/api/tests/catalog-search.test.ts`, `apps/web/tests/catalog-reader.test.tsx` |
| **D4** | Reader Bookmarks / Saved Reading | **DELIVERED** (`bookmarks` schema, `/api/v1/bookmarks` CRUD, Reader bookmark toggle, Saved Reading `/bookmarks` view & sidebar link) | `apps/api/tests/bookmarks.test.ts` |
| **E1** | Persistent Post Tags | **DELIVERED** (Normalized `tags` & `post_tags` synced on create/update, loaded and saved in `PostSettingsTab.tsx`) | `apps/api/tests/api-integration.test.ts`, `apps/web/tests/post-settings-tags.test.tsx` |
| **F1** | In-App Notifications (Polling) | **DELIVERED** (`notifications` schema, `NotificationService`, `/api/v1/notifications`, polling bell UI in `TopBar.tsx`) | `apps/api/tests/notifications.test.ts` |
| **I1** | Operational Admin Console | **DELIVERED** (Admin users & PAT inventory endpoints, role/status update, PAT token revocation, UI tables with confirmation modals) | `apps/api/tests/admin-console.test.ts`, `apps/web/tests/admin-view.test.tsx` |

## Pending & Partial Workstreams (Explicitly Tracked)

| Workstream | Area | Current Status | Next Action |
|---|---|---|---|
| **B1** | Markdown Review Diff Viewer | **PENDING** (Review modal currently displays raw Markdown; needs visual side-by-side / unified diff against last published snapshot) | Implement diff component using `markdown_snapshot` comparisons |
| **A3** | Version Restore Collab Sync | **PENDING** (Snapshot restore exists in API, but active editor Yjs session reload/broadcast needs formal coordination) | Connect restore handler to broadcast update to live collab room |
| **D2** | Full-Text `tsvector` Ranking | **PARTIAL** (Server-side SQL search filters by query parameters and substring LIKE; full ranked `tsvector` projection pending) | Add generated `search_vector` column and tsquery ranking |
| **F1 (SSE)** | Notifications Realtime Stream | **PARTIAL** (Polling fallback delivered and functional; long-lived SSE stream `/api/v1/notifications/stream` pending) | Add Fastify SSE route for instant unread badge updates |
| **G1–G3** | Attachment Storage & Lifecycle | **PENDING** (Single-file upload works; storage path normalization, orphan garbage collection, and quarantine lifecycle pending) | Reconcile relative disk storage and scan state transitions |
| **I2, I3** | Operational Diagnostics & Audit Export | **PENDING** (Live audit verification route exists; CSV/JSON export and service connection dashboard pending) | Build audit query export endpoints and admin diagnostic card |
| **C3** | Space Dashboard | **PENDING** (Space directory and settings delivered; dedicated dashboard view with drafts/reviews breakdown pending) | Add Space analytics/overview tab in SpaceView |



## 1. Product Direction

Glyphroom should first become a dependable internal knowledge and documentation workspace for teams. The core product promise is:

1. Teams can create and organize technical knowledge.
2. Authors can collaborate safely on working drafts.
3. Reviewers can provide useful editorial feedback.
4. Readers can reliably find and consume the approved version.
5. Administrators can operate the workspace without database access.

AI/MCP remains an optional integration layer. This plan does not add new AI capabilities, model providers, autonomous workflows, or AI-generated content features. Existing MCP tools should continue to work against the improved core workflows.

## 2. Current Product Gaps

The following features are described in the product documentation but are currently missing, incomplete, or not delivered correctly:

| Area | Current state | Target state |
|---|---|---|
| Review workflow | Basic approval works, but changes requested does not reliably return a post to draft; publishing and republishing rules are inconsistent | Explicit, transactional lifecycle with clear review states |
| Review experience | Review modal displays raw Markdown and does not pin a reviewed snapshot | Immutable review checkpoint with a clean Markdown diff |
| Version history | Snapshots exist, but checkpoint and restore behavior is incomplete | Reliable milestones, restore, comparison, and recovery UX |
| Spaces | Membership and invitations exist; rename/archive/owner management is incomplete | Complete team workspace administration |
| Catalog | Full result set is loaded and filtered in memory | Server-side search, pagination, filters, and useful discovery |
| Tags | Tags are displayed as local editor state and are not persisted | Persistent tags with taxonomy management |
| Notifications | Documented but not implemented | In-app notifications for reviews, mentions, and publishing |
| Bookmarks | Documented as a reader capability but absent | Personal bookmarks and saved reading list |
| Admin console | Spaces and audit verification are partly present; users and PAT inventory are empty tabs | Complete operational administration screens |
| Attachments | Upload works in tests, but storage/schema/scanning behavior is inconsistent | Durable attachment lifecycle with clear status |
| My Work | Suggestions tab is effectively another draft/review filter | Actual pending-suggestion view and editorial tasks |
| Observability | Basic health endpoints exist | Useful product/service diagnostics and operational status |

## 3. Delivery Principles

- **Make the core path boring:** create → edit → submit → review → publish → republish.
- **One source of truth per feature:** workflow state in the API, document content in Yjs, derived search/read views in projections.
- **Do not hide incomplete behavior:** unfinished controls should be disabled, removed, or labeled clearly.
- **Prefer server-side capabilities:** filtering, authorization decisions, pagination, and state transitions belong in the API.
- **Keep existing integrations compatible:** MCP should consume the same post, review, version, comment, and search APIs as the web application.
- **Every feature needs a user-visible acceptance path and an automated regression test.**

## 4. Priority Model

- **P0 — Core correctness:** required before calling the product feature-complete.
- **P1 — Enterprise usability:** required for dependable daily internal use.
- **P2 — Quality of life:** valuable improvements after the core workflow is stable.

## 5. Workstream A — Editorial Lifecycle and Publishing

### Goal

Make document state predictable for authors, reviewers, moderators, and readers.

### A1 — Formalize the post state machine (P0)

Implement and centralize the allowed transitions:

```text
draft -> in_review
in_review -> draft              (changes requested)
in_review -> approved           (review approved)
approved -> published           (publish)
published -> in_review          (edited published content submitted again)
published -> archived           (archive)
archived -> draft               (restore for editing)
```

Tasks:

- Add a shared transition function used by every mutation route.
- Reject invalid transitions with a clear error code.
- Make `changes_requested` return the post to `draft`.
- Prevent review decisions on posts that are not `in_review`.
- Prevent publishing unless the post is `approved`.
- Make republishing require a new review when the working copy differs from the published snapshot.
- Display the current state and next permitted action in the editor and My Work screens.

#### Review checkpoint rule: use an immutable snapshot, not a document lock

Glyphroom will use the recommended **immutable review checkpoint** model rather than locking the live document:

1. When an author submits a post, the current live Yjs state is flushed or captured.
2. A `post_versions` row is created with `trigger_reason = review_submission`.
3. The active review record stores the submitted version ID.
4. The reviewer reviews that exact version, even if authors continue typing afterward.
5. Approval publishes the pinned submitted version, not the later working copy.
6. Edits made after submission remain in the working copy and are clearly labeled as changes made after review submission.
7. Those later edits require a new review before a future republish.

This prevents unreviewed keystrokes from entering the approved publication while preserving the benefit of continuous collaboration. The editor should show a visible banner such as: **“Review checkpoint created at 14:32. Edits made after this time are not included in this review.”**

Data/API requirements:

- Add a submitted-version reference to the review record, preferably `post_reviews.submitted_version_id` referencing `post_versions.id`.
- Add an endpoint to retrieve the exact review checkpoint.
- Make publish resolve the active approved review and publish its submitted version.
- Expose whether the working copy differs from the reviewed or published snapshot.

Acceptance criteria:

- Every lifecycle transition has an API test.
- A post cannot skip review through the web UI or API.
- A changes-requested post appears in Drafts immediately.
- A published snapshot never changes until a new publication succeeds.

Likely locations: `apps/api/src/routes/posts.ts`, `apps/api/src/routes/reviews.ts`, `apps/api/src/services/`, `apps/web/src/components/editor/SubmitReviewButton.tsx`.

### A2 — Publication transaction and snapshot consistency (P0)

- Flush or obtain the current live Yjs snapshot before publication.
- Create the version row and update the post publication pointer in one database transaction.
- Store the change summary with the publication event.
- Make retries idempotent.
- Ensure failed publication does not leave an orphaned version or partially updated post.
- When publishing from review, use the review’s pinned `submitted_version_id`; never use the current mutable working state.
- Preserve post-submission working edits as unpublished changes rather than overwriting or silently discarding them.

Acceptance criteria:

- The published version contains the latest visible editor content.
- A simulated failure leaves the previous published version intact.
- Repeating the same publication request does not create duplicate publication events.

### A3 — Version history and restore (P0)

- Add explicit milestone creation for review submission, approval, publication, and manual checkpoint.
- Add a manual “Create checkpoint” action.
- Show version number, author, reason, timestamp, and publication status.
- Restore into the working copy without silently changing the published snapshot.
- Broadcast restored content to active collaborators.
- Add a clear “restore completed” and “restore failed” state.
- Identify review-submission checkpoints separately from ordinary manual and publication versions.

Acceptance criteria:

- Restoring a version creates a safety checkpoint first.
- Readers continue seeing the previous published version until republish.
- Active editors receive the restored working copy without requiring a page refresh.

## 6. Workstream B — Review and Editorial Experience

### Goal

Give reviewers enough context to make a decision without leaving the review workflow.

### B1 — Markdown snapshot diff viewer (P0)

- Replace the raw Markdown review block with a GitHub-style diff viewer based on derived Markdown snapshots.
- Compare the immutable review checkpoint’s `markdown_snapshot` against the last published version’s `markdown_snapshot`.
- For a first publication, compare the review checkpoint against an empty baseline.
- Support unified and side-by-side views with green additions and red deletions.
- Keep the diff at the Markdown level rather than attempting to visually diff raw ProseMirror/Yjs JSON trees.
- Show the current working copy separately when it contains edits made after submission; label those edits as outside the review checkpoint.
- Allow reviewers to open the full reader view and editor in separate actions.
- Show document metadata, author, space, last publication, and pending comments.

Acceptance criteria:

- A reviewer can identify every change since the last published version.
- A new post shows the full draft cleanly without a misleading empty comparison.
- Approving a review publishes exactly the version represented by the diff.
- Post-submission edits are visibly excluded from the approval target.
- Large documents remain usable through section-level diffing.

### B2 — Review comments and decision history (P1)

- Show existing review decisions in chronological order.
- Distinguish review comments from ordinary reader comments.
- Preserve reviewer notes after the post moves back to draft.
- Add a review summary to the author’s My Work page.
- Add a required note for “Request changes” when appropriate, with a configurable minimum rather than a hard-coded assumption.

### B3 — Review queue usability (P1)

- Add filters for space, author, age, status, and assigned reviewer.
- Add sorting by oldest pending item and recently updated.
- Add empty, loading, and failure states with retry.
- Show the number of unresolved review comments and pending suggestions.
- Add bulk navigation: next item, previous item, return to queue.

## 7. Workstream C — Spaces and Team Workspaces

### Goal

Make Spaces usable as long-lived team work areas rather than only membership containers.

### C1 — Complete Space administration (P0)

- Add rename and description editing.
- Add archive and restore actions.
- Add a deliberate deletion policy; prefer archive by default.
- Add a Space settings page rather than placing all controls inside the admin console.
- Show owner, maintainers, member count, document count, and recent activity.

Acceptance criteria:

- Owners can manage their own Space without global admin access.
- Archived Spaces disappear from active navigation but remain readable to authorized users.
- Space deletion cannot accidentally delete documents without an explicit documented policy.

### C2 — Membership management quality (P0)

- Prevent removal or demotion of the last Space owner.
- Prevent maintainers from assigning ownership accidentally where ownership is not intended.
- Show pending invitations and membership history.
- Add clear role descriptions in the member management UI.
- Confirm destructive membership changes with a consistent dialog.

### C3 — Space dashboard (P1)

Add a dashboard containing:

- Recent documents.
- Drafts requiring attention.
- Review queue for the Space.
- Published document count.
- Members and maintainers.
- Recently archived documents.

## 8. Workstream D — Catalog, Search, and Discovery

### Goal

Make the knowledge base fast and useful as the number of documents grows.

### D1 — Server-side catalog query API (P0)

Add a typed query contract supporting:

- `q` search text.
- Space.
- COE.
- Tags.
- Author.
- Status.
- Published date range.
- Sort order.
- Cursor or page-based pagination.

Return:

- Results.
- Total or `hasMore` metadata.
- Applied filter summary.
- Search highlights where applicable.

Acceptance criteria:

- The browser never loads the entire catalog for a normal page.
- Access filtering happens before results are returned.
- The same query behavior is available to MCP search without a separate implementation.

### D2 — Use the existing PostgreSQL search model (P0)

- Populate published and working search projections whenever a document snapshot changes.
- Use full-text ranking for normal search.
- Use trigram matching for title and partial-word discovery.
- Exclude pending suggestion insertions according to the existing export rules.
- Add indexes and query plans for the expected catalog size.

### D3 — Catalog UI improvements (P1)

- Add pagination or infinite loading.
- Add URL-persisted filters so links can be shared.
- Add “clear all filters.”
- Add recent and popular sorting.
- Add a result count and query duration only for diagnostics if useful.
- Remove hardcoded COE filter values and load taxonomy from the API.
- Add keyboard navigation and accessible filter labels.

### D4 — Reader bookmarks (P1)

- Add bookmark/unbookmark action to ReaderView and catalog cards.
- Add a personal Bookmarks page.
- Store bookmark timestamp and optional note.
- Add bookmark filtering to My Work or the main navigation.

## 9. Workstream E — Tags, Taxonomy, and Metadata

### Goal

Make metadata reliable enough to support discovery and reporting.

### E1 — Persist tags (P0)

- Reuse the existing normalized `tags` and `post_tags` tables in `apps/api/src/db/schema.ts`; no new tag schema is required for this work.
- Add tags to post create/update payloads.
- Load existing tags into `PostSettingsTab.tsx` rather than initializing local placeholder values.
- Save changes transactionally with post metadata.
- Return tags in catalog and reader responses.
- Remove the current local-only default tags and replace them with persisted values.
- Add API queries for post tags and tag search where needed.

### E2 — Taxonomy administration (P1)

- Add tag create, rename, merge, and archive operations.
- Add COE administration.
- Prevent duplicate tags caused by capitalization or spacing.
- Show usage counts before deleting or archiving a tag.

### E3 — Metadata quality (P1)

- Add excerpt length guidance.
- Add required title and slug validation feedback before submission.
- Add document type/template metadata.
- Add last reviewed and review owner fields if the workflow requires them.

## 10. Workstream F — Notifications and Activity

### Goal

Help people know when work needs their attention without relying on chat or email.

### F1 — In-app notifications (P0)

Notifications must remain separate from the Hocuspocus collaboration protocol. Do not multiplex custom notification JSON packets over the Yjs WebSocket.

Preferred delivery:

- Add `GET /api/v1/notifications/stream` using Server-Sent Events for the notification bell and lightweight activity updates.
- Provide 30-second polling as a fallback when SSE is unavailable or when the deployment does not keep long-lived HTTP connections.
- Keep the existing collaboration WebSocket dedicated to Yjs synchronization and cursor awareness.

Create notifications for:

- Review requested.
- Changes requested.
- Review approved.
- Publication completed.
- Mention in a comment.
- Reply to a comment.
- Collaborator added or removed.
- Space request approved or rejected.

Required capabilities:

- Unread count.
- Mark one read.
- Mark all read.
- Notification detail link.
- Retention and pagination.
- Reconnection and last-event handling for SSE.

### F2 — Activity timeline (P1)

- Add a document activity timeline showing edits at milestone level, comments, review decisions, publication, promotion, and restore events.
- Keep audit records and user-facing activity separate: audit is immutable governance data; activity is a readable collaboration history.

### F3 — Optional email adapter (P2)

Only after in-app notifications are stable:

- Add SMTP as an optional adapter.
- Add per-user notification preferences.
- Avoid making email a dependency for core workflows.

## 11. Workstream G — Attachments and Embedded Content

### Goal

Make attachments dependable, understandable, and recoverable.

### G1 — Align attachment model and storage (P0)

- Use one canonical attachment table and one API type.
- Mount the actual API attachment directory in production.
- Store relative storage keys rather than machine-specific absolute paths.
- Add attachment deletion and orphan cleanup.
- Include attachments in backup and restore documentation.

### G2 — Attachment lifecycle (P1)

- Represent `pending`, `clean`, and `quarantined` consistently.
- Show scan status in the editor and reader.
- Do not show a file as clean before the configured scan step completes.
- Add retry for interrupted uploads.
- Add upload progress and clearer file-size/type errors.
- Add per-post attachment totals and limits.

### G3 — Editor integration (P1)

- Add attachment replacement and removal.
- Add image preview and alt text editing.
- Add download filename preservation.
- Ensure broken attachments show a useful fallback rather than an empty block.

## 12. Workstream H — Editor and Reader Quality

### H1 — Save and connection state (P0)

- Make save status distinguish saved, saving, offline, reconnecting, and failed.
- Add a retry action after persistence failure.
- Warn before leaving when metadata changes are still saving.
- Show the time of the last durable snapshot.

### H2 — Suggestions and comments navigation (P1)

- Make the Suggestions tab show only documents containing pending suggestions.
- Add accept/reject all with a confirmation summary.
- Add next/previous suggestion navigation.
- Show stale suggestions clearly.
- Make comment selection and anchor status visible when an anchor cannot be resolved.

### H3 — Reader experience (P1)

- Add table of contents navigation.
- Add copy-link-to-section.
- Add print-friendly view.
- Add document metadata and version date.
- Add related documents based on shared Space, COE, and tags.
- Add a clear distinction between company library, Space-published, and working content.

### H4 — Accessibility and interaction consistency (P1)

- Replace browser `alert()` and `confirm()` calls with shared dialogs and toasts.
- Add keyboard-accessible menus and dialogs.
- Add focus restoration after modal close.
- Add responsive table behavior for smaller screens.
- Add consistent error, loading, and empty states across all screens.

## 13. Workstream I — Administration and Operations Features

### I1 — Complete Admin Console (P0)

Implement the currently empty tabs:

- User directory with search and filters.
- Account status display.
- Role assignment interface.
- PAT inventory with owner, scope, last use, expiry, and revoke action.
- Space and taxonomy administration links.
- Audit event list with filters and pagination.

### I2 — Audit viewer and export (P1)

- Add date, actor, action, entity, and Space filters.
- Add event detail view with structured metadata.
- Add CSV/JSON export for authorized administrators.
- Add scheduled integrity verification result history.

### I3 — Product diagnostics (P1)

- Add API endpoint for basic application metrics.
- Show active collaboration rooms and connection counts to administrators.
- Track failed document flushes and attachment failures.
- Add a small operational status page for administrators.

## 14. Workstream J — Data and API Quality

### J1 — Typed API contracts (P0)

- Move repeated request and response types into `packages/shared`.
- Add consistent error codes for validation, transition, conflict, and not-found cases.
- Add pagination response types.
- Remove `any` from core route response shapes where practical.

### J2 — Transaction boundaries (P0)

Use transactions for:

- Publication.
- Review checkpoint creation, review decision, and post-state update.
- Space approval plus owner assignment.
- Post metadata plus tag updates.
- Attachment metadata plus cleanup operations.

### J3 — API behavior tests (P0)

Add tests for:

- Every valid and invalid lifecycle transition.
- Moving-target review behavior: edits after submission remain unpublished and approval publishes the pinned checkpoint.
- Markdown diff correctness against the submitted and last-published snapshots.
- Search pagination and combined filters.
- Tags persistence using the existing `tags` and `post_tags` tables.
- Space archive and restore.
- Notification creation and read state.
- Bookmark lifecycle.
- Attachment persistence and orphan cleanup.
- Version restore while a live document is connected.

## 15. Suggested Delivery Sequence

### Phase 1 — Core correctness

1. Formal post state machine.
2. Immutable review checkpoint and submitted-version reference.
3. Publication transaction using the pinned review version.
4. Review changes-requested behavior.
5. Version restore and durable checkpoints.
6. Attachment schema/storage alignment.
7. Persisted tags using the existing schema.
8. Server-side catalog pagination contract.

### Phase 2 — Daily workflow usability

1. Working-vs-published diff viewer.
2. Review queue improvements.
3. Space administration and owner safeguards.
4. Search projections and ranked catalog search.
5. Suggestions and comments navigation.
6. Save/reconnect state improvements.

### Phase 3 — Enterprise product completeness

1. In-app notifications.
2. Complete Admin Console.
3. Audit viewer and export.
4. Bookmarks.
5. Taxonomy management.
6. Space dashboards.
7. Reader improvements and related documents.

### Phase 4 — Operational polish

1. Attachment lifecycle and recovery.
2. Product diagnostics.
3. Optional email notification adapter.
4. Accessibility and responsive UI pass.
5. Performance testing with a realistic catalog and document sizes.

## 16. Definition of Feature Complete

The feature work is complete when:

- An author can create, edit, submit, receive changes, revise, and resubmit a document without manual database intervention.
- A reviewer can compare immutable Markdown snapshots and leave an auditable decision tied to the submitted version.
- A moderator can publish or reject content through the intended workflow.
- Approval cannot publish edits made after the review checkpoint.
- A reader can search, filter, bookmark, read, comment, and return to saved documents.
- A Space owner can manage the Space, members, documents, and lifecycle.
- Tags, COEs, comments, notifications, versions, and attachments persist correctly.
- The Admin Console no longer contains placeholder tabs.
- Catalog requests are paginated and server-side filtered.
- Every major feature has API, UI, and regression coverage.
- Existing MCP tools continue to operate as optional clients of the same core workflows.

## 17. Recommended First Implementation Sprint

The first sprint should be deliberately narrow:

1. Add the shared post transition service.
2. Add the immutable review checkpoint and submitted-version reference.
3. Fix changes-requested → draft.
4. Enforce approved → published using the pinned version.
5. Add publication transaction handling.
6. Add regression tests for all lifecycle paths and moving-target review behavior.
7. Remove or disable UI actions that currently bypass the state machine.

This gives the rest of the feature work a stable workflow foundation and prevents new UI screens from building on inconsistent post states.
