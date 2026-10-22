# Application Overview

This repository contains a web application for cataloging, finding, documenting, reviewing, and sharing reusable software components. Users create component records with descriptive and technical sections, supported platforms, team assignments, review and approval history, and discussion. The Django data model calls a component record a `Post`; the frontend and product language generally call it a component.

This overview is intended for engineers who need to understand the existing system as a legacy application, including work that may replace the backend and migrate its data. It describes current behavior only. For the detailed contracts, see [LEGACY_DATA_MODEL.md](LEGACY_DATA_MODEL.md) and [LEGACY_API_AND_FRONTEND_CONTRACT.md](LEGACY_API_AND_FRONTEND_CONTRACT.md).

## What the Application Does

The application combines a component catalog with a lightweight editorial workflow:

1. Users browse a paginated catalog and filter by creation dates, contributors, assigned reviewers, and supported platforms. The UI also offers a COE filter, though current list/search API views do not apply it.
2. Users search component titles, descriptions, and generated keywords using PostgreSQL full-text ranking and trigram similarity.
3. Authenticated users create components using a structured editor. Entries begin in `draft` status and include rich-text sections, links, version history, platforms, dependencies/resources, usage details, and optional COE metadata.
4. Contributors, reviewers, and approvers can be assigned to a component. Reviewers can write tracked review comments; approvers can approve or disapprove and leave an approval comment.
5. Users can discuss a component with top-level comments and replies. Component detail is publicly readable in the shown API configuration, while several editing and workflow APIs require a JWT.
6. Component records can be rendered as a PDF or exposed through API-key-protected external endpoints. COE values are loaded from an external service.

These are current code paths and visible UI features, not a statement that every permission boundary or flow is complete. For endpoint-level behavior and limitations, see the [API/frontend contract](LEGACY_API_AND_FRONTEND_CONTRACT.md).

## Repository Structure

```text
.
├── backend/
│   ├── manage.py                 Django management entry point
│   ├── requirements.txt          Python dependencies
│   ├── wiki/                     Django project settings, URLs, WSGI/ASGI
│   ├── Posts/                    Component records, APIs, search, exports, Channels consumer
│   ├── Users/                    Custom user, sign-in, user-management APIs
│   └── Comments/                 Threaded component discussion
└── frontend/
    ├── package.json              Vite scripts and React dependencies
    ├── vite.config.ts            Vite, React, Tailwind plugins and env prefixes
    └── src/
        ├── App.tsx               Browser routes and token-based protected wrapper
        ├── main.tsx              React, Redux persistence, and MSAL bootstrap
        ├── features/             Login, catalog, component detail, admin, profile
        ├── components/           Layout, header/search, editor, alerts, shared UI
        ├── lib/                  Auth config, JWT refresh, API request helper
        ├── store/                Redux slices and persisted theme/layout state
        ├── Styles/               Feature-specific styles
        └── utils/                Shared constants and utilities
```

There is no root-level README in the current repository. `frontend/README.md` is the Vite starter template and does not explain product behavior. Backend app tests are mostly Django test stubs in the inspected files. No deployment/container manifest or committed environment template was found in the project root or the inspected tree.

## Runtime Architecture

```text
Browser (React 19 + TypeScript + Vite)
  ├── MSAL / Microsoft identity sign-in
  ├── localStorage JWT access + refresh tokens
  ├── Redux Toolkit state; Redux Persist for theme and layout
  └── Axios helper ─────────────── HTTP /api/* ─────────────┐
                                                           │
Django REST Framework (backend/wiki)                       │
  ├── Users app: identity and user administration          │
  ├── Posts app: catalog, workflow, search, exports        │
  ├── Comments app: discussion threads                    │
  └── PostgreSQL: application data, search vectors/indexes ◄┘

React editor ── Yjs/y-websocket client ── Channels/Redis WebSocket path
External COE service and API-key consumers ── Django integration views
```

The frontend is a Vite-built single-page application. Its API helper prefixes requests with `/api` and attaches Bearer JWTs by default, refreshing when needed. `main.tsx` initializes MSAL, then mounts React with Redux and persistence providers. The backend is a Django REST Framework application using PostgreSQL; the Django settings configure JWT authentication, page-number pagination, CORS middleware, and Channels with a Redis channel layer. The ASGI application routes HTTP to Django and WebSockets through Channels.

Configuration is environment-driven. Backend settings require a Django secret and PostgreSQL connection values; additional code reads Microsoft identity settings, frontend/API URLs, external COE service settings, external API keys, and integration notification settings. The frontend uses `VITE_` variables, with Vite also configured to expose `REACT_APP_`-prefixed variables. The repository includes a production frontend env file, but its values are intentionally not reproduced here. Treat it as configuration material, not documentation.

`backend/requirements.txt` declares Django, Django REST Framework, SimpleJWT, PostgreSQL driver, Channels/Channels Redis, Redis, Microsoft/LDAP-related packages, and YAKE among other dependencies. The PDF view imports ReportLab, but ReportLab is not listed in the pinned requirements file. The frontend dependencies include React, TypeScript, Vite, React Router, Redux Toolkit, Axios, MSAL, Quill, Yjs, and UI libraries. The requirements file pins Django 4.2.23, while some generated migrations/settings comments identify Django 5.2; verify the deployed environment/version before relying on either as a definitive runtime fact.

## Frontend Areas

### Bootstrap and shared services

- `frontend/src/main.tsx` initializes MSAL and mounts `<App />` beneath Redux, Redux Persist, and MSAL providers.
- `frontend/src/App.tsx` defines browser routes, theme setup, and `ProtectedRoute`. Its protected decision is based on whether `localStorage.access_token` exists; it does not perform a role check itself.
- `frontend/src/lib/apiUtils.tsx` centralizes Axios requests, Bearer token attachment, refresh-and-retry after 401, optional upload progress, and an optional retry mode.
- `frontend/src/store/` has user, home/catalog, theme, and layout slices. Theme and sidebar state are persisted; catalog state is maintained in Redux.
- Shared layout/header/search, notification, empty/loading states, sidebar, and component display helpers are under `frontend/src/components/`.

### User-facing routes

| Area | Route | Current purpose |
|---|---|---|
| Sign-in | `/` | Password login and Microsoft sign-in; backend issues the JWT tokens used by the application. |
| Catalog | `/home` | Searchable/filterable paginated catalog with infinite scrolling and stored list/filter/scroll state. |
| Authoring | `/add-component` | Create a component through the structured editor. |
| Editing | `/edit-component` | Reuse the editor with a component supplied through router location state. |
| User components | `/mycomponents` | List records associated through the `contributors` relationship. |
| Approval queue | `/myapprovals` | List records assigned to the current user as approver. |
| Review queue | `/myreviews` | List records assigned to the current user as reviewer. |
| Component detail | `/post/:id` | View component metadata and content, team, review and approval state, and discussion. Includes edit/delete/workflow controls according to current user/UI state. |
| Search results | `/search` | Display submitted search results and fetch additional pages. |
| Administration | `/admin-panel` | User list/management and settings screens. A Groups component exists in source but is not in the currently displayed tabs and calls routes not registered in current backend URLs. |
| Profile | `/myprofile` | Minimal profile placeholder with navigation back to Home. |

### Component editor and detail content

The editor combines plain-text fields, Quill rich-text editors, platform and keyword lists, COE selection, link rows, and version-history rows. Rich sections use Quill Delta; during edits, editor state is connected to Yjs structures. Current content includes:

- Title and description
- Supported platforms
- Dependencies and resource requirements
- Internal design and external interfaces
- Test results and usage example
- Relevant links/source path
- Version history
- Used-in information and bug report
- Keywords and COE ID/name

The detail page renders these differently by type: Quill for rich text, text for several fields, badges for platform/keyword values, link rows for source paths, and a table for version history. For exhaustive field-level storage and encoding, see [LEGACY_DATA_MODEL.md](LEGACY_DATA_MODEL.md).

## Backend Areas

### Django project

`backend/wiki/` contains settings, top-level HTTP URLs, WSGI, and ASGI. Top-level routes mount `/api/admin/`, `/api/users/`, `/api/posts/`, and comment URLs at `/api/`. ASGI configures Channels WebSockets in addition to HTTP.

### `Posts`

The `Posts` app owns the component record and most application behavior: list/detail/create/edit/delete, search, user-specific queues, assigned team management, reviewer comments, approval/disapproval, platform suggestions, image/file uploads, PDF generation, COE integration, and external component retrieval. Search indexing is performed in `Posts/backgroundtask.py` using a Python thread launched on create/edit; it extracts text and YAKE keywords, then writes a PostgreSQL search vector.

The `Post` model relates to users through creator, contributors, assigned reviewer/approver lists, and separate reviewer/approver activity relations. It also stores component content, dates/status, approval text/date, COE metadata, generated keywords, and search vector. See the [data model reference](LEGACY_DATA_MODEL.md).

### `Users`

The `Users` app defines `CustomUser`, which extends Django `AbstractUser` with a free-form `role`. It supports password login, Microsoft ID-token exchange for backend JWT tokens, token refresh, user lookup/listing, user updates, and population/sync. LDAP-related dependencies/settings are present, but the current authentication backend configuration shown does not enable LDAP as the active login flow.

### `Comments`

The `Comments` app stores component discussions as comments with a user author, component relation, and optional self-referential parent for replies. Review feedback is a separate `Posts.ReviewersComments` entity with a status field. The API and frontend contract reference explains the payload names and authorization behavior.

## Current Workflows and Semantics

### Create and edit

Creation requires a JWT and writes a new record in `draft` status. The frontend sends the creator ID as `Uuid`; the view uses that supplied ID to retrieve the creator. Create and update payloads use camel-case keys for platform and COE values alongside snake-case content fields. Rich content is serialized to JSON strings; links and version history are JSON strings inside text columns. Some keys sent by the frontend are not persisted by the shown backend views. Full details are in [LEGACY_API_AND_FRONTEND_CONTRACT.md](LEGACY_API_AND_FRONTEND_CONTRACT.md).

### Review and approval

Assigned reviewers and approvers are separate from users recorded as having reviewed/approved. Reviewer queue membership is based on `reviewers_list`; approver queue membership is based on `approvers_list`. Reviewer comments have their own status. The approval endpoint sets a component to `approved`; the disapproval endpoint sets it to `disapproved`; both stamp `approve_date`. The model does not declare allowed status choices. Some historical status-specific routes are commented out.

### Search and integration

Search combines a PostgreSQL search vector with trigram similarity against generated keywords. Supported fields and filters do not precisely match all current UI filter controls. External endpoints include an API-key-protected all-components feed and approved components by COE. A separate COE lookup endpoint calls an external service. Configuration values for those integrations are environment-provided.

### Collaboration

The editor uses Yjs and `y-websocket` client packages. The backend uses Django Channels and Redis and has a consumer that broadcasts binary WebSocket frames to a room. The frontend URL and registered backend route do not currently match, and the consumer's received Yjs updates are not saved back to component fields. Treat this as an observed/incomplete legacy capability, not durable persistence.

## Current Limitations and Legacy Notes

- The current backend is not a clean, centralized schema/API contract. Field encodings vary between database types and frontend payloads; parallel reviewer/approver relations have different meanings.
- The `Post` list route named `/approved` aliases the same view as `/all`, which does not apply an approved-only status filter.
- The frontend offers a COE filter but current list/search view implementations do not read its payload field.
- The editor sends keywords and group IDs, but current create/update views do not persist those values as sent.
- `My Components` queries contributors rather than the creator relation.
- WebSocket paths mismatch and current consumer behavior is broadcast-only; it does not persist Yjs document changes to component rows.
- Groups appear in migration history and frontend source, but the current user model/URL registration does not expose the corresponding active backend feature.
- User profile is minimal. The visible admin tabs are Users and Settings; a Groups component exists but is not shown in current tab navigation.
- Some view-level permission declarations are absent. A React protected route or hidden UI control does not establish backend authorization. `fetch_user` manually decodes the Bearer token using a hard-coded signing key instead of declaring DRF authentication; the key is not reproduced here.
- The README is still framework boilerplate and the inspected test modules do not define meaningful coverage for the core workflows.
- Historical migrations show schema evolution from a single `content` field to many sections, changes in relation types, and changing field representations. Current production data may include values from multiple eras; model declarations alone do not describe all stored content variants.

These notes describe repository evidence and compatibility risks. They do not assess the correctness or security of the application as a whole, and do not prescribe a replacement architecture.

## Local Development and Dependencies

- Frontend package scripts are declared in `frontend/package.json`: `npm run dev`, `npm run build`, `npm run lint`, and `npm run preview`.
- Backend management entry point is `backend/manage.py`; dependencies are pinned in `backend/requirements.txt`. Database credentials and Django secret are environment-configured.
- Backend settings expect PostgreSQL and configure Redis at `127.0.0.1:6379` as the Channels layer. A compatible PostgreSQL installation and Redis service are required for the configured runtime paths.
- Microsoft identity requires configured client/tenant/redirect settings. COE lookup and external integration features require their corresponding external service configuration.
- No committed environment template or deployment manifest was found in the root-level project structure inspected. The frontend production env file contains environment-specific values and should not be treated as safe documentation.

This section records declared scripts and settings, not a verified end-to-end deployment procedure.

