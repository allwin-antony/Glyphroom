import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { exportDerivedMarkdown } from '@glyphroom/shared';
import { ReaderPreview } from '../src/components/ReaderPreview.js';

vi.mock('mermaid', () => {
  const render = vi.fn(async (id: string, code: string) => ({
    svg: `<svg id="${id}" data-code="${code}"><rect width="100" height="100"/></svg>`,
  }));
  const initialize = vi.fn();
  return {
    default: { initialize, render },
    initialize,
    render,
  };
});

vi.mock('katex', () => ({
  default: {
    renderToString: vi.fn((tex: string) => `<span class="katex" data-tex="${tex}">${tex}</span>`),
  },
}));

describe('Reader Preview & Derived Markdown Export Suite', () => {
  it('correctly filters pending suggestions in published preview', () => {
    const docJSON = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Enterprise Architecture' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Our platform provides ' },
            {
              type: 'text',
              marks: [{ type: 'suggestion_insert', attrs: { status: 'pending' } }],
              text: 'AI-assisted ',
            },
            {
              type: 'text',
              marks: [{ type: 'suggestion_delete', attrs: { status: 'pending' } }],
              text: 'legacy ',
            },
            { type: 'text', text: 'knowledge management.' },
          ],
        },
      ],
    };

    const markdown = exportDerivedMarkdown(docJSON);

    // Assert: pending insertion 'AI-assisted ' is omitted
    expect(markdown).not.toContain('AI-assisted');

    // Assert: pending deletion 'legacy ' is preserved in reader export
    expect(markdown).toContain('legacy');

    expect(markdown).toContain('# Enterprise Architecture');
    expect(markdown).toContain('Our platform provides legacy knowledge management.');
  });

  it('renders direct markdown and shows empty state when markdown is empty', () => {
    const { getByText } = render(<ReaderPreview markdown="" title="Empty Draft" />);
    expect(getByText('Draft is empty.')).toBeDefined();
    expect(getByText('Empty Draft')).toBeDefined();
  });

  it('renders showcase engineering guide post with Mermaid, Alerts, Tables, and Lists', async () => {
    const showcasePostMarkdown = `# Glyphroom: Current Platform Guide

Glyphroom is a self-hosted platform for technical documentation, engineering blogs, and team knowledge sharing. It combines a collaborative document editor, team-scoped Spaces, a company Library, editorial review, and AI co-authoring through the Model Context Protocol (MCP). The project uses the Apache-2.0 license.

This guide reflects source revision \`de2cda8\`, including Track 1 in \`f3177f3\`, and verification on 2026-10-30.

## What Teams Can Write

- Architecture RFCs and decision records
- Operational runbooks and onboarding guides
- Incident reviews and retrospective reports
- Engineering blog posts and project status updates
- Test plans, checklists, and design-system documentation

## Architecture

| Component | Implementation | Responsibility |
| --- | --- | --- |
| Web | React, Vite, TipTap/ProseMirror | Authoring, reading, review, and administration |
| API | Fastify, Drizzle ORM | Identity, posts, metadata, workflows, comments, and notifications |
| Collaboration | Hocuspocus and Yjs | Live document synchronization and internal document operations |
| Persistence | PostgreSQL | Binary Yjs state, immutable versions, tags, and relational records |
| MCP | Stateless HTTP and local stdio | Agent discovery, draft creation, comments, and tracked edits |
| Plugins | Declarative extension contracts | UI slots, scoped storage, events, and namespaced tools |

\`\`\`mermaid
flowchart LR
  Browser[Browser editor] -->|WebSocket| Collab[Hocuspocus and Yjs]
  Browser -->|REST| API[Fastify API]
  Assistant[Assistant with local PAT] --> MCP[MCP server]
  MCP --> API
  MCP -->|Agent edits| Collab
  API --> DB[(PostgreSQL)]
  Collab --> DB
\`\`\`

## Spaces and the Company Library

1. Create a draft for an individual or team Space.
2. Collaborate on the working copy.
3. Submit a version for editorial review.
4. Publish an approved checkpoint.
5. Promote an appropriate Space publication to the Company Library for wider discovery.

> [!NOTE]
> Publishing within a Space and promoting to the Company Library are separate operations.

## Track 1: Live Checkpoints and Review

Track 1 adds three collaboration endpoints: \`POST /internal/documents/:documentName/flush\`, \`/restore\`, and \`/tombstone\`.

\`\`\`mermaid
sequenceDiagram
  participant Author
  participant API
  participant Collab
  participant Reviewer
  Author->>API: Submit for review
  API->>Collab: Request live checkpoint
  Collab-->>API: Yjs state and derived Markdown
  API-->>Author: Submitted version reference
  Reviewer->>API: Review submitted snapshot
  Reviewer->>API: Publish approved version
\`\`\`

> [!IMPORTANT]
> The standard publish operation uses a reviewed checkpoint.

> [!WARNING]
> Working content may differ from the last published snapshot. Readers and editors should be shown which version they are viewing.

## AI Co-Authoring with MCP

Each user keeps a Personal Access Token in their local assistant configuration.
`;

    const { container } = render(
      <ReaderPreview
        markdown={showcasePostMarkdown}
        title="Glyphroom: Current Platform Guide"
      />
    );

    // Verify Title and Section Headings rendered
    expect(container.textContent).toContain('Glyphroom: Current Platform Guide');
    expect(container.textContent).toContain('What Teams Can Write');
    expect(container.textContent).toContain('Architecture');
    expect(container.textContent).toContain('Spaces and the Company Library');
    expect(container.textContent).toContain('Track 1: Live Checkpoints and Review');
    expect(container.textContent).toContain('AI Co-Authoring with MCP');

    // Verify Table rendered
    expect(container.textContent).toContain('Component');
    expect(container.textContent).toContain('Implementation');
    expect(container.textContent).toContain('Responsibility');
    expect(container.textContent).toContain('Fastify, Drizzle ORM');
    expect(container.textContent).toContain('Hocuspocus and Yjs');

    // Verify Lists rendered
    expect(container.textContent).toContain('Architecture RFCs and decision records');
    expect(container.textContent).toContain('Promote an appropriate Space publication');

    // Verify Alerts rendered
    expect(container.textContent).toContain('Publishing within a Space and promoting to the Company Library are separate operations.');
    expect(container.textContent).toContain('The standard publish operation uses a reviewed checkpoint.');
    expect(container.textContent).toContain('Working content may differ from the last published snapshot.');

    // Verify Flow to Cards presentation toggle
    const cardsBtn = screen.getByTitle('Blocks View');
    expect(cardsBtn).toBeDefined();
    fireEvent.click(cardsBtn);

    const flowBtn = screen.getByTitle('Document View');
    expect(flowBtn).toBeDefined();
    fireEvent.click(flowBtn);
  });
});
