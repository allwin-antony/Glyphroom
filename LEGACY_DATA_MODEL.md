# Legacy Data Model and Content Formats

This document describes the data model that exists in the current Django application and the representations consumed or emitted by the current React editor. It is a record of observed legacy behavior, not a proposed target format. The related application and API references are [APP_OVERVIEW.md](APP_OVERVIEW.md) and [LEGACY_API_AND_FRONTEND_CONTRACT.md](LEGACY_API_AND_FRONTEND_CONTRACT.md).

## Scope and Reading Notes

The database model is authoritative for the current column types, nullability, defaults, and relationships. The editor and API determine the payload encodings. In several places those are not the same thing: a Django `JSONField` may contain a JSON string sent by the editor, and a `TextField` may contain serialized Quill Delta JSON. Do not infer the Python/SQL type from the shape of a particular API value.

The frontend often decodes or renders only some legacy representations. Where a parser falls back, that behavior is noted. There is no repository-wide schema specification or fixture set establishing the distribution of formats already present in production data.

## Component Record (`Posts.Post`)

The application calls this record a post, but its business role is a reusable component/catalog entry. Current model definition: `backend/Posts/models.py`. It is associated with a required creator, optional team memberships, content fields, approval metadata, and generated search data.

### Identity, workflow, and relationships

| Field | Current database representation | Current behavior |
|---|---|---|
| `id` | Django-generated `BigAutoField` primary key | Used in frontend `/post/:id` and backend routes as an integer. Earlier migrations altered the primary-key definition; see schema history below. |
| `title` | `CharField(max_length=500)`, required | Editor submits trimmed plain text, although it uses a Quill editor/Yjs text for collaboration. Search indexing gives title the strongest full-text weight. |
| `author` | `CharField(max_length=100)`, required | Creation sets it to `user.first_name`; list/search responses sometimes return this field and sometimes `user__first_name`. It is not the relational creator identity. |
| `user` | Required FK to configured user model; delete cascades | Creator/owner identity used by post detail response as `author_id` and by list response as `user__first_name`. |
| `status` | `CharField(max_length=20)`, default `draft` | Creation sets `draft`; approval writes `approved`; disapproval writes `disapproved`. No declared choices constrain values. Old/commented code refers to `rejected` and `concept`, but those are not active routes in `Posts/urls.py`. |
| `date_created` | `DateTimeField(auto_now_add=True)` | Creation timestamp; used for sorting, filtering, and external payloads. Django settings use UTC and timezone-aware datetimes. |
| `modified_date` | `DateTimeField(auto_now=True)` | Updated on model save; included in component detail response. |
| `approvers_list` | Blank-allowed M2M to users (`approvers_posts`) | Assigned approval candidates. Drives “My Approvals” list. These are not the same relation as `approvers`. |
| `reviewers_list` | Blank-allowed M2M to users (`reviewers_posts`) | Assigned review candidates. Drives “My Reviews” and reviewer-comment authorization logic. |
| `contributors` | Blank-allowed M2M to users (`contributed_posts`) | Team members; user component list filters by this relation. Creation does not itself add the creator to this relation in the shown view. |
| `approvers` | Blank-allowed M2M to users (`approved_posts`) | Records users set as approvers when approve/disapprove action runs. Separate from assigned `approvers_list`. |
| `reviewers` | Blank-allowed M2M to users (`reviewed_posts`) | Separate relation from assigned `reviewers_list`; current reviewed-post list filters `reviewers_list`. |
| `coe_id` | Nullable/blank `IntegerField` | Optional external COE identifier. Editor submits `coeId` as a number or null. |
| `coe_name` | Nullable/blank `CharField(max_length=255)` | Optional COE display name; editor submits `coeName`. |
| `approvers_comment` | Nullable/blank `TextField` | Approval comment is set during approval; disapproval clears it. Exposed both within `content` and as top-level `approved_comments`. |
| `approve_date` | Nullable/blank `DateTimeField` | Set on both approval and disapproval. Detail response names it `approved_date`. |

`approvers_list`/`reviewers_list` are assignments. `approvers`/`reviewers` are separate activity relations. Do not collapse them when reading old rows or API payloads.

### Component content fields

| Model/API field | Current database type and model default | Editor/API representation and meaning | Detail display, export, and search behavior |
|---|---|---|---|
| `description` | Required `TextField` | Main summary/description. Editor gets Quill `getContents()`, removes trailing newline(s), and sends `JSON.stringify(delta)`. The stored value is normally a string containing a Delta object with `ops`; the code does not declare this format at the model layer. | Detail uses read-only Quill and list cards can use text-only preview with first image thumbnail. PDF export parses Quill JSON or falls back to escaped plain text. External exports extract text from Delta and truncate to 1,000 chars. Search background task extracts text and includes it in the PostgreSQL vector (weight C). |
| `platforms_supported` (`platformSupported` in create/update request) | Nullable/blank `JSONField`, default `list` | Array of platform strings in the editor and API. Current editor shares it through Yjs array `platforms`. Creation updates the global `defaultPlatform.platforms` list with new values, initializing Android/iOS/Web defaults if no row exists. | Detail displays values as badges. Used as an exact JSON containment filter. Search indexing appends platform values to extracted keywords. Included in list and external integration responses. |
| `dependencies` | Nullable/blank `JSONField`, default `list` | Editor uses a plain-text Quill editor, reads `.getText()`, trims the end, and submits a string. The current create/update view assigns request data directly to the JSONField, so the actual value may be a JSON string scalar, not an array. The editor's edit collaboration text is Yjs `dependency`. | Detail renders as plain text via React text; PDF export is included in the content loop. It is not among the fields passed into `update_post_search_data`'s extracted text. |
| `resources` | Nullable/blank `JSONField`, default `list` | Editor uses plain-text Quill; submits trimmed string despite JSONField model type. The corresponding Yjs text is named `resources`. | Detail labels this “Resource Requirements” and renders as plain text. Included in PDF export; not included in generated search text. |
| `internal_design` | Nullable/blank `TextField` | Rich Quill Delta JSON string from editor. | Rendered with QuillViewer. Included in PDF export. Search background task extracts its text but the PostgreSQL vector itself indexes only title, keywords, and description. |
| `external_interfaces` | Nullable/blank `TextField` | Rich Quill Delta JSON string. | Rendered with QuillViewer and included in PDF export. Its extracted text contributes to generated keywords, but not directly to the vector expression. |
| `test_results` | Nullable/blank `TextField` | Rich Quill Delta JSON string. | Rendered with QuillViewer and included in PDF export. Its extracted text contributes to generated keywords. |
| `usage_example` | Nullable/blank `TextField` | Rich Quill Delta JSON string. | Rendered with QuillViewer and included in PDF export. Its extracted text contributes to generated keywords. |
| `bug_report` | Nullable `TextField` (not declared `blank=True`) | Plain-text Quill editor; editor submits trimmed string. | Rendered as plain text in detail. Not included in PDF content map or background search extraction. |
| `source_path` | Nullable/blank `TextField` | Current editor stores an array of `{label, url}` rows using `JSON.stringify`. Edit loading accepts JSON arrays, but falls back to a single legacy string displayed as a “Source Path” link. | Detail parses JSON arrays or falls back to a single source link. PDF export includes this field in its content loop; when it is JSON text it is treated as plain text unless it happens to parse as a Delta object. Not included in generated search text. |
| `used_in` | Nullable/blank `TextField` | Plain-text Quill editor; submits trimmed string. Yjs text name is `usedIn`. | Detail renders as plain text. Included in PDF export and generated keyword extraction. |
| `version_history` | Nullable/blank `TextField` | JSON-encoded array of rows shaped `{version, author, description, date}`. Editor synchronizes rows using Yjs array `versionHistory`, then serializes the array to a string. | Detail parses and renders a four-column table, with raw-text fallback when parsing fails. PDF export parses JSON and builds a table. Not used for search. |
| `keywords` | Nullable/blank `TextField` | Editor sends a `keywords` array of strings; current `uploadPosts` and `getPost.put` do not assign that request key to the model. Background indexing generates this database field instead as a lowercase, space-joined string of YAKE terms and platform names. Edit UI splits the stored string on whitespace. | Detail splits on whitespace into badges. Search uses trigram similarity against this string and adds it to the full-text vector at weight B. Manual editor keywords therefore are not persisted by the shown write views and can be overwritten by indexing. |

The `uploadPosts` view accepts a `groupId` key but does not persist it in the current `Post` model. The current `Post` model has no active group FK. The edit view updates the listed content fields but does not update author, creator, team membership, status, approval metadata, or keywords.

### Rich text format (Quill Delta)

The editor stores rich sections as JSON-serialized Quill Delta. A typical shape is:

```json
{"ops":[{"insert":"A short description\n"}]}
```

Operations may contain inserted strings with optional formatting attributes, or embeds such as `{ "insert": { "image": "..." } }`. The editor removes final newline(s) before serialization; empty content may consequently be represented as an empty Delta object (`{"ops":[]}`), while pre-existing records may contain other empty encodings. The detail view checks a few exact empty strings, and the editor parses saved values with `JSON.parse` without a fallback for all rich fields; a malformed/non-JSON legacy value can therefore fail edit initialization even though QuillViewer itself has a plain-text fallback.

QuillViewer uses Quill's `setContents` for display. In text-only previews, it concatenates string inserts, omits embeds from text, compresses whitespace, truncates the text, and separately shows the first image as a thumbnail. Images in full detail open a zoomable overlay. PDF export has its own Delta-to-ReportLab conversion and handles text formatting, links, images, tables, and lists; its output is not a canonical serialization of the source Delta.

### Search and indexes

`Posts.backgroundtask.update_post_search_data(post_id)` extracts plain text from `title`, `description`, `internal_design`, `external_interfaces`, `test_results`, `usage_example`, and `used_in`; it runs YAKE keyword extraction, adds supported platforms, removes a few Delta-related tokens, lowercases/deduplicates terms, and stores them in `keywords`. It then writes `search_vector = SearchVector(title, weight='A') + SearchVector(keywords, weight='B') + SearchVector(description, weight='C')`.

Create and edit call this function on a new Python thread. This is separate from the database row write and can race with follow-up reads. Search endpoints combine PostgreSQL full-text matching with trigram similarity against `keywords`. `Post.Meta` declares GIN indexes for the search vector and trigram indexes for description, title, and keywords. It does not define field choices or validation for status or content shape.

## Other Current Entities

### `Posts.defaultPlatform`

| Field | Type/default | Behavior |
|---|---|---|
| `id` | Django-generated primary key | The helper `get_instance()` uses fixed ID 1, but create logic elsewhere uses `.first()` and may create a row without enforcing singleton uniqueness. |
| `platforms` | `JSONField(default=list)` | Shared list of suggested platform strings. Authenticated GET `/api/posts/get_default_platforms/` filters values case-insensitively by substring. Component creation adds newly selected platforms. |

### `Posts.ReviewersComments`

| Field | Type/default | Behavior |
|---|---|---|
| `id` | Django-generated primary key | Identifier returned as `review_comment_id`. |
| `post` | Required FK to `Post`, delete cascades; `related_name='reviewers_comments'` | Parent component. |
| `reviewer` | Required FK to configured user, delete cascades | User recorded as author. Creating a review comment checks membership in `post.reviewers_list`. |
| `comment` | Required `TextField` | Review feedback text. |
| `date_created` | `DateTimeField(auto_now_add=True)` | Ordered newest-first in model metadata. |
| `status` | `CharField(max_length=20)`, model default `Open` | Free-form review comment status. Migration `0023` initially recorded default `Pending`, while the current model says `Open`; existing rows are not necessarily all the current default. The update endpoint can set any provided string. |

### `Comments.Comments`

| Field | Type/default | Behavior |
|---|---|---|
| `id` | Django-generated primary key | Returned as `comment_id`. |
| `content` | Required `TextField` | Comment/reply body. |
| `created_at` | `DateTimeField(auto_now_add=True)` | Creation timestamp. |
| `author` | Required FK to `Users.CustomUser`, delete cascades | Comment author. |
| `post_id` | Required FK to `Posts.Post`, delete cascades | Field is literally named `post_id` even though it stores a relation. |
| `parent` | Nullable/blank self-FK, delete cascades, `related_name='replies'` | Null means top-level comment; set means reply. Detail returns top-level comments with nested one-level replies. The model allows nesting deeper, but the detail serializer only explicitly gathers each top-level comment's direct replies. |

The public comment endpoints read `uuid`, `content`, `parentCommentId`, `commentId`, `parentCommentId`, and `replyId` from request data. The views do not apply `IsAuthenticated` permissions. See the API contract for exact behavior and the distinction between frontend UI checks and server checks.

### `Users.CustomUser`

Extends Django `AbstractUser`; the current custom field is `role = CharField(max_length=20, default='user')`. `username` is unique and stripped on save; `email` is also stripped. The rest of the standard user fields include password hash, first/last name, email, active/staff/superuser flags, join/login timestamps, groups, and permissions. Microsoft-authenticated users are looked up by username/email claim and created with name and role `user` if absent. Login/admin APIs expose only selected fields, not password data.

The older `Users.Group` model exists in migrations (`0002`, deleted in `0004`, recreated in `0005`) but is commented out of the current `Users.models` definition. The currently included frontend `Groups` component calls group API paths that are commented out of `Users.urls.py`. Treat group rows and membership history as migration evidence, not proof of active current group functionality.

### `Posts.UploadedImage` and `Posts.UploadedFile`

Both models have a Django-generated primary key, a file field stored beneath `uploads/`, and `uploaded_at` auto timestamp. `custom_url` returns the storage URL. The endpoints return absolute URLs; editor image/file upload workflows are partly commented in `NewEditor`, so the presence of these models/endpoints does not prove all attachments are actively created through the current editor. Rich Delta image embeds may contain either remote URLs or data URLs, depending on content history.

## Schema Evolution Notes

Migration history is part of the legacy format and should be consulted when data predates the current application shape.

- `Posts/0001_initial.py` created a much smaller record with `title`, `author`, status, a single `content` text field, creation timestamp, and creator FK. Early migrations altered the post ID type.
- `Posts/0008_rename_content_post_description_post_contributors_and_more.py` renamed `content` to `description` and introduced contributors and the expanded component sections. At that point several structured sections were declared JSONFields; subsequent migrations altered some field types.
- `Posts/0009` onward adjusts content field declarations; inspect the full chain for the exact historical type at each migration if reconstructing a specific database snapshot. Current model declarations are listed above.
- `Posts/0014_uploadedfile.py` added uploaded files. `0015` introduced a PostgreSQL search vector, with later migrations changing/recreating related indexes and fields. The current model includes the search vector plus GIN/trigram indexes.
- `Posts/0023_reviewerscomments.py` added reviewer comments with migration default `Pending`; current model default is `Open`.
- `Posts/0025` and later migrations introduced/altered approval comment and approval date fields; the current model uses `approvers_comment` and `approve_date`.
- `Posts/0027` and `0028` added keywords and its trigram index. Search data is subsequently generated by application code rather than a declared model `save()` hook.
- `Posts/0030` added bug report; `0031` added COE ID/name; `0032` recreated the search-vector field/index.
- Comments initially stored `author` as a string (`Comments/0001`), then changed it to a user FK (`0002`), and gained a nullable parent relation for replies (`0003`).
- Users group schema was created, deleted, and recreated in migrations `0002`-`0005`; the current model no longer declares it.

Migration names above are relative to `backend/`. This summary identifies changes relevant to the current data contract; it is not a substitute for inspecting the complete migration chain when determining the physical schema of a specific deployment.

## Current Compatibility Caveats

- Model types and serialized payload types differ, especially for `dependencies` and `resources` (JSONFields written as strings) and rich text held in TextFields.
- Source links and version history are JSON serialized inside TextFields, not separate relational tables.
- Several team concepts have parallel relations: assigned reviewers/approvers versus acted reviewers/approvers.
- Manual keywords are sent by the editor but not persisted by the shown create/update view; generated keywords are used for search.
- Content field semantics are established across models, migrations, frontend editors, backend views, and exports; no single serializer or schema contract centralizes them.
- The list API, detail API, external APIs, PDF export, and UI each expose/render different subsets and representations. See [LEGACY_API_AND_FRONTEND_CONTRACT.md](LEGACY_API_AND_FRONTEND_CONTRACT.md).

