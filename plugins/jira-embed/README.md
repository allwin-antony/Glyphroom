# Jira Embed Web Plugin for Glyphroom

A client-side reference plugin for Glyphroom that provides a declarative Jira issue card block in the rich text collaborative editor.

## Features

- **Custom TipTap Node**: `jiraIssue` node rendering safe, styled status cards for Jira tasks.
- **Slash Command**: Declarative `/jira` command accessible in the slash menu.
- **Toolbar Action**: Slot contribution under `editor:toolbar:actions`.
- **Zero Remote JS Loading**: Bundled statically at build-time. No external scripts or unauthenticated tracking pixels are loaded.

## Attributes

- `issueKey`: Issue identifier (e.g. `PROJ-101`)
- `summary`: Issue summary text
- `status`: Lifecycle status (`To Do`, `In Progress`, `Done`)
- `url`: Deep link to enterprise Jira instance
