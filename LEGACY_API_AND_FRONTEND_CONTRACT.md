# Legacy API and Frontend Contract

This reference describes the endpoints, routes, payloads, and connection behavior present in the current implementation. It is for understanding the existing frontend/backend boundary during maintenance of the legacy model. It does not define a replacement API. See [APP_OVERVIEW.md](APP_OVERVIEW.md) for product and repository orientation and [LEGACY_DATA_MODEL.md](LEGACY_DATA_MODEL.md) for field formats and relationships.

## API Conventions

- The Django URL root is `/api/`. User APIs are under `/api/users/`; component APIs are under `/api/posts/`; comments are mounted directly under `/api/`.
- The frontend's `apiRequest()` prefixes `VITE_APP_API_URL` (default `http://localhost:8000`) plus `/api` to the supplied endpoint. Unless told otherwise, it uses a locally stored access token as a `Bearer` JWT and refreshes/retries on `401`.
- Django REST Framework is configured for JWT authentication, pagination page size 10, and no explicit global permission class. Therefore an endpoint without a view-level permission declaration is not automatically authenticated by the settings shown. Individual route/view permissions below are based on the actual class declarations.
- JSON field names are case-sensitive. The frontend sometimes supplies user IDs in request bodies even when the server also has an authenticated request user; server views frequently trust the supplied ID rather than deriving identity from `request.user`.
- Standard page-number pagination returns DRF's `count`, `next`, `previous`, and `results`. Some empty-list responses use `data` or `results` inconsistently.

## Frontend Routes

| Browser route | Page/component | Access wrapper and behavior |
|---|---|---|
| `/` | `features/Login.tsx` | Public login. Supports password login and Microsoft sign-in; Microsoft ID token is posted to backend and backend returns JWT access/refresh tokens. |
| `/home` | `features/home/Home.tsx` | Protected by a `localStorage.access_token` check. Component catalog list; applies date, contributor, reviewer, platform and COE UI filters, uses paged results/infinite loading, and stores list/filter/scroll state in Redux. |
| `/add-component` | `components/editor/NewEditor.tsx` | Protected. Creates a component. |
| `/edit-component` | `components/editor/NewEditor.tsx` | Protected. Expects `post` and `postID` in React Router location state; edit path can be entered without that state, but the editor's behavior then is not an edit. |
| `/mycomponents` | `features/home/Myposts.tsx` | Protected. Loads `/posts/user_post/{userId}`; backend filters on `contributors`, not creator FK. |
| `/myapprovals` | `features/home/MyApprovals.tsx` | Protected. Loads assigned approver queue. |
| `/myreviews` | `features/home/MyReview.tsx` | Protected. Loads assigned reviewer queue. |
| `/post/:id` | `features/posts/Post.tsx` | Route itself is public; it fetches component detail without authentication. Mutating controls rely on frontend checks and server endpoints may additionally require JWT. |
| `/search` | `components/Search.tsx` | Protected. Receives initial search state through router location state, then paginates subsequent results. |
| `/admin-panel` | `features/admin/AdminPanel.tsx` | Protected by token presence. Admin role handling is in the page/UI; `App.tsx` itself only checks for a token. Visible tabs are Users and Settings. A Groups component exists but its tab is not included in the visible tab list. |
| `/myprofile` | `features/profile/MyProfile.tsx` | Protected, currently a minimal page with a Home button. |
| `/not-authorized` | `features/NotAuth.tsx` | Public information page. |
| `*` | `features/NotFound.tsx` | Catch-all. |

The `ProtectedRoute` reads the JWT from local storage. It also obtains MSAL auth state and an auth-mode variable, but the shown decision is based on the JWT token. `isAuth` is a boolean, so the `isAuth === null` loading branch is not reached by that expression.

## Component and Catalog APIs

All paths in this section are prefixed with `/api/posts`. Route definitions are in `backend/Posts/urls.py`.

| Method and path | Permission in view | Request and response behavior / frontend usage |
|---|---|---|
| `POST /upload_post` | `IsAuthenticated` | Create. Frontend sends `title`, `description`, `platformSupported`, `dependencies`, `resources`, `internal_design`, `external_interfaces`, `test_results`, `usage_example`, `source_path`, `version_history`, `used_in`, `bug_report`, `coeId`, `coeName`, `keywords`, `groupId`, `Uuid`. View reads most content keys and `Uuid`, creates `status='draft'`, updates platform suggestions, and starts background search indexing. It does not persist `keywords` or `groupId` in the shown implementation. Returns a message, not the created ID/record. |
| `POST /all` | No explicit permission declaration | Catalog list with optional body filters `fromDate`, `toDate`, `contributor` (IDs), `reviewer` (IDs), `platform` (array). Does not filter to `status='approved'` despite route/view names. Paginates at 10 and returns fields including title, creator first name, status, date, id, description, supported platforms, and COE name. Used on Home and by filter application. |
| `POST /approved` | No explicit permission declaration | Same view as `/all`; the path does not imply an approved-only filter. |
| `GET /{id}` | `AllowAny` for GET | Component detail response: `content` object with the content fields; top-level title, IDs, status, dates, contributors/author, assigned and acted reviewer/approver lists, reviewer comments, and discussion comments/replies. Used on public `/post/:id` page. Missing records are returned as a 400 with `ComponentError`. |
| `PUT /{id}` | `IsAuthenticated` | Edit. Frontend sends the create payload shape, but the view updates selected content fields and COE values only. Does not update keyword/team/status/creator fields. Returns success message. It starts background indexing. |
| `DELETE /{id}` | `IsAuthenticated` | Delete component. View deletes by ID and returns a message. No explicit not-found handling around the lookup. |
| `POST /search/{query}` | No explicit permission declaration | Suggestion search, used as the user types. Accepts date/contributor/reviewer/platform filters in body; returns `{data: [...]}` with up to 10 ranked results, including similarity. COE filter is built by the frontend but not applied in this view. |
| `POST /fullsearch/{query}` | No explicit permission declaration | Paged search, used on submit. Same filters and vector/trigram logic, returns standard DRF page response. Frontend passes `fromDate`, `toDate`, `reviewer`, `contributor`, `platform`, and a `coeId` array, but backend does not apply COE filtering. Search results use page navigation. |
| `GET /user_post/{id}` | `IsAuthenticated` | Paged list of records where `contributors` contains this user ID. This is the source for My Components; it is not filtered on `Post.user` creator. |
| `GET /approve_posts/{id}` | `IsAuthenticated` | Paged list filtered by `approvers_list` membership; used for My Approvals. |
| `GET /review_posts/{id}` | `IsAuthenticated` | Paged list filtered by `reviewers_list` membership; used for My Reviews. |
| `GET /get_default_platforms/?name=...` | `IsAuthenticated` | Returns `{platforms: [...]}` filtered case-insensitively by substring. Used by editor and search filters. |
| `GET /get_coes` | `AllowAny`; authentication classes disabled | Calls configured COE service using an API-key header and returns its JSON on success, or an error response. Used by editor and search filter suggestions. |
| `POST /upload_image` | No explicit permission declaration | Multipart `image`; stores image and returns absolute `{url}`. |
| `POST /upload_file` | No explicit permission declaration | Multipart `file`; stores file and returns absolute `{url}`. Current editor upload invocation code is largely commented out. |
| `POST /download_pdf/{id}` | No explicit permission declaration | Returns PDF attachment generated from component title, selected content fields, Quill Delta content, and JSON version history. It is a POST although no request body is used. |
| `GET /external/all` | `HasExternalAPIKey` | Requires `X-SHARED-SECRET-KEY`. Returns all posts, including status, description plain text truncated to 1,000 chars, platform and COE fields, public URL, and contributor/reviewer/approver team details. It does not filter to approved status. |
| `GET /coe/{coe_id}` | `HasExternalAPIKey`; authentication classes disabled | Returns paged approved records for one COE ID with a plain-text description excerpt and URL. Uses a hard-coded public frontend base URL in the view. |
| `POST /{id}/add_owners` | `IsAuthenticated` | Body keys `add_user_ids`, `add_reviewers_ids`, `add_contributors_ids`. Replaces the assigned approvers, reviewers, and contributors sets using `.set()`. Frontend submits this from component configuration. |
| `POST /{id}/set_owners` | `IsAuthenticated` | Body `user_id`, `owner_group`; adds user to `approvers` only if `owner_group == 'approved'`, otherwise to `reviewers`. Route name says `remove_owners`, but POST adds. `DELETE` removes using same keys. |
| `POST /{id}/add_review_comment` | `IsAuthenticated` | Body `user_id`, `comment`. Creates a review comment only if user is in `reviewers_list`. Response nests `review_comment` with ID/user/date/status. |
| `PUT /{id}/add_review_comment` | `IsAuthenticated` | Body `comment_id`, optional `comment`, optional `status`; updates review comment scoped to component ID. |
| `DELETE /{id}/add_review_comment` | `IsAuthenticated` | Body `comment_id`; deletes review comment scoped to component ID. |
| `POST /{id}/add_approve_comment` | `IsAuthenticated` | Body `user_id`, optional `comment`; sets status to `approved`, stores comment/date, and sets `approvers` to the supplied user. View does not verify that user is in assigned approvers. |
| `PUT /{id}/add_approve_comment` | `IsAuthenticated` | Body `user_id`; clears approver comment, sets `disapproved`, stamps date, sets `approvers` to supplied user. View does not verify assigned approver membership. |

### Search and filter details

The backend builds PostgreSQL `SearchQuery`, ranks `search_vector`, and applies trigram similarity against `keywords` with a threshold. The automatic search vector is composed from title, keywords, and description; other rich fields can contribute indirectly through extracted generated keywords. List and search filters include dates, assigned reviewer, contributor, and platform. Although the frontend search bar also collects a COE filter and sends `coeId`, current search/list views do not read that key. The Home filter request body includes COE IDs but the server ignores them.

The `search/{query}` and `fullsearch/{query}` paths place query text in the URL path; callers do not URL-encode it explicitly in `PostSearchBar`. Special characters and slashes therefore matter to the actual path contract.

## User and Authentication APIs

All paths below are prefixed with `/api/users`. Definitions are in `backend/Users/urls.py`.

| Method and path | Permission in view | Request and response behavior / frontend usage |
|---|---|---|
| `POST /login_user` | No explicit permission declaration | Body keys `LoginUser`, `LoginPass`. Adds `@acsiatech.com` if missing, authenticates Django user/password, rejects inactive users, returns name, username, ID, role, access token, and refresh token. |
| `POST /auth/microsoft` | Function view is CSRF-exempt; no DRF permission declaration | Body `{id_token}`. Backend fetches Microsoft signing keys, verifies issuer/audience against configured values, gets/creates user, returns same user identity plus JWTs. Frontend uses MSAL first, then posts the ID token here. |
| `POST /api/token/refresh/` | SimpleJWT token refresh view; prefix is therefore `/api/users/api/token/refresh/` | Body `{refresh}`; returns refreshed access token according to SimpleJWT behavior. Frontend `refreshAccessToken()` calls this route. |
| `GET /fetch_user` | No explicit permission declaration | Frontend calls this with the Bearer token. The view manually extracts and decodes the token using a hard-coded signing key, then returns username, ID, role, and name. This is not standard DRF JWT authentication and the embedded key is intentionally not reproduced here. |
| `GET /get_users/` | `IsAuthenticated` | Query parameter `name`; searches usernames, limits to 10, returns `{results:[username,name,role,id,date_created,is_active]}`. Used for reviewer/contributor/approver suggestion. |
| `GET /get_users_pg/` | No explicit permission declaration in route/view shown | Optional `name`, `sortBy`, page query. Returns pagination metadata plus user rows. Used by Admin UserList. |
| `POST /update_user` | No explicit permission declaration in view shown | Body `{updates:[{id,role,is_active},...]}` or one direct update object. Applies provided role/active values. Returns a success message. Used by Admin UserList. |
| `GET /populate_users` | No explicit permission declaration; class permission is commented out | Invokes user population/synchronization behavior. Called by Admin Settings using the API helper's default GET method. |

The `Groups` frontend component calls `/get_groups` and `/create_group`, but those routes are commented out of current `Users/urls.py`; corresponding code is not a live URL contract in the current route table. The current user model has a `role` string in addition to Django staff/superuser flags; AdminPanel route protection in React checks only token presence, while user-management behavior is in its tab component/backend endpoints. `fetch_user` manually decodes a token with an embedded signing key; do not treat that as a reusable authentication contract or copy the key into replacement code/documentation.

## Discussion APIs

Comments are mounted at `/api/` from `backend/wiki/urls.py`, so their full paths differ from the Post namespace.

| Method and path | Permission in view | Request and response behavior |
|---|---|---|
| `POST /api/posts/{id}/comments` | No explicit permission declaration | Body keys `content`, `uuid`; optional `parentCommentId`. Creates top-level comment or reply. Returns message, body, username, user ID, comment ID, and created timestamp. The view trusts the supplied user ID. |
| `PUT /api/posts/comments/` | No explicit permission declaration | Body `content`, `commentId`; edits a comment. The view does not check that the requester authored it. |
| `DELETE /api/posts/comments/` | No explicit permission declaration | Body normally includes `parentCommentId`; for reply deletion also `replyId`. The view looks up the parent and nested reply. Its exception handling and variable initialization are inconsistent for some body shapes. |

Component detail serializes comments as top-level records each with direct replies. The editor-facing UI supports add/edit/delete of comments/replies. These comment endpoints do not declare `IsAuthenticated` in their views, and the supplied `uuid` is not equivalent to authentication.

## Editor Request and Storage Contract

The `NewEditor` create and update path serializes fields as described in [LEGACY_DATA_MODEL.md](LEGACY_DATA_MODEL.md). Important payload conventions:

- Rich fields `description`, `internal_design`, `external_interfaces`, `test_results`, `usage_example`: JSON strings representing Quill Delta objects. Editor removes trailing newlines before serialization.
- `platformSupported`: array of strings (API name differs from model/detail field `platforms_supported`).
- `dependencies`, `resources`, `used_in`, `bug_report`: trimmed strings. Dependencies/resources are stored in Django JSONFields despite this scalar payload.
- `source_path`: JSON string of `{label,url}` objects.
- `version_history`: JSON string of `{version,author,description,date}` objects.
- `keywords`: array of strings sent by the frontend; shown create/update views do not persist it. Search task generates the stored `keywords` text.
- `coeId`, `coeName`, and `Uuid`: frontend camel-case/user identity keys. Server uses `Uuid` when creating, `coeId`/`coeName` for COE metadata, and the update view accepts COE values only when `coeId` is not `None`.
- `groupId`: sent but not stored by current `uploadPosts` implementation.

On edit, the frontend receives component detail as `{content:{...}, ...}` and expects rich content strings to be valid JSON for `JSON.parse`. It can read source path as a JSON link array or plain legacy string, and version history as a JSON array or fallback empty row. The detail viewer accepts Delta JSON strings or plain text for Quill sections, but the editor's own loading path is less tolerant.

## WebSocket and Collaborative Editor

The backend mounts Channels in `backend/wiki/asgi.py` and declares this route in `backend/Posts/routing.py`:

```text
ws/post/<room_id>/<section_name>
```

The consumer creates group name `post_{room_id}_{section_name}`, accepts the connection, and broadcasts received binary frames to group clients as Yjs update frames. It does not persist updates to the `Post` model in its `receive()` implementation. The consumer's helper `update_post()` exists but is not called by `receive()`.

The frontend editor creates a Yjs document for an existing component and uses these shared structures:

| Yjs shared name | Content |
|---|---|
| Text `title` | Title text |
| Text `description` | Description Quill content |
| Text `dependency` | Dependencies text |
| Text `resources` | Resources text |
| Text `internal_design` | Internal design Delta |
| Text `external_interfaces` | External interface Delta |
| Text `test_results` | Test results Delta |
| Text `usage_example` | Usage example Delta |
| Text `usedIn` | Used-in text |
| Text `bugreport` | Bug-report text |
| Array `platforms` | Supported-platform strings |
| Array `keywords` | Editor keyword strings |
| Array `versionHistory` | Y.Maps with `version`, `author`, `description`, `date` keys |
| Map `metadata` | Per-section initialization flags and `version_history_initialized` |

The frontend constructs the provider URL as `${WS_URL}/ws/post/${postID}` and supplies the room name `shared` as the second `WebsocketProvider` argument. The configured Channels route shown in the backend requires both `<room_id>` and `<section_name>` in the URL. These do not match: the frontend URL is missing a path segment, and the y-websocket room-name argument is not represented in the Django route. Treat existing collaborative editing as a contract discrepancy, not as a functioning persistence path. Also, ASGI wraps WebSockets in `AuthMiddlewareStack`, but the consumer's `connect()` does not reject anonymous users or check component permissions.

## Compatibility Notes

- URL paths, request names, response wrappers, auth declarations, and representations are inconsistent across features; use the tables above as the current observed contract, not a normative API standard.
- Frontend access wrappers are not a substitute for backend authorization. Several list/search/comment/user-maintenance views have no explicit permission declaration.
- `GET /posts/{id}` is public, while write methods on the same route require authentication; other write endpoints vary individually.
- Search/list responses do not consistently filter approved status; the route name `/approved` aliases the same listing view as `/all`.
- The frontend's COE filter is not applied by current list/search backend views.
- User IDs are sometimes passed in body/path and trusted by the server instead of taken from the authenticated principal.
- A request may succeed but not save all fields sent by the editor (notably keywords and group ID); read-after-write behavior can therefore differ from the submitted payload.
- Group endpoints called by an existing component are absent from active URL registration.

