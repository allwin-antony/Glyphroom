import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type pino from 'pino';

export const GLYPHROOM_BLOCK_DOCUMENTATION = `# Glyphroom Editor Block Specification

Glyphroom uses a collaborative ProseMirror editor with live Yjs CRDT synchronization.
When formatting document sections via MCP (create_post, append_section, insert_after_section, suggest_edit_section), use the following syntax:

---

## 1. Callout Alerts
Support 5 GitHub-style alerts for emphasizing operational and technical notices:

> [!NOTE]
> Background context, architecture rationale, or general explanations.

> [!TIP]
> Optimization suggestions, best practices, and efficiency improvements.

> [!IMPORTANT]
> Crucial requirements, required steps, and need-to-know details.

> [!WARNING]
> Breaking changes, deprecation warnings, and potential failure modes.

> [!CAUTION]
> High-risk actions, data loss potential, or security vulnerabilities.

---

## 2. Project Status & Health Pulse Cards
Renders an interactive status card with RAG badge, progress meter, target dates, and active blockers:

<!-- status-block ragStatus="green" milestoneTitle="Sprint 4 Database Migration" completionPercent="85" targetDate="2026-11-30" blockers="None" -->

* **ragStatus**: "green" (on track), "amber" (at risk), or "red" (blocked)
* **completionPercent**: 0 to 100
* **targetDate**: ISO date string (YYYY-MM-DD)
* **blockers**: Freeform blocker text or "None"

---

## 3. Mermaid Architecture & Sequence Diagrams
Renders rich diagrams natively in the browser:

\`\`\`mermaid
flowchart TD
  Client[Web Client] -->|WebSocket| Gateway[Collab Gateway :4000]
  Gateway --> Engine[Yjs CRDT Engine]
  Engine --> PostgreSQL[(PostgreSQL :5432)]
\`\`\`

Supported diagrams: \`flowchart\`, \`sequenceDiagram\`, \`stateDiagram\`, \`classDiagram\`, \`erDiagram\`.

---

## 4. KaTeX Math & LaTeX Formulas
Renders mathematical formulas:

$$
H(X) = -\\sum_{i=1}^{n} P(x_i) \\log_2 P(x_i)
$$

---

## 5. Checklists, Code, and Markdown Tables

### Tasks
- [x] Phase 1 Database Schema verified
- [x] Fastify REST API endpoints tested
- [ ] Staging cluster rollout

### Tables
| Microservice | Port | Protocol | Authority |
| :--- | :--- | :--- | :--- |
| apps/api | 4001 | HTTP REST | Identity & Catalog |
| apps/collab | 4000 | WS / HTTP | Single Write Yjs Authority |
| apps/web | 3000 | HTTP / SPA | Collaborative Editor |
`;

export const ARCHITECTURE_RFC_TEMPLATE = `# RFC: [System Name] Architecture & Design

## Context & Problem Statement
Describe the architectural motivation, current bottlenecks, and business goals.

## Architecture Diagram
\`\`\`mermaid
flowchart LR
  API[REST API] --> Queue[(Event Queue)]
  Queue --> Worker[Background Worker]
  Worker --> DB[(Database)]
\`\`\`

## Decision & Technical Rationale
- **Chosen Option**: [Option Name]
- **Pros**: High scalability, minimal latency.
- **Cons**: Additional operational overhead.

## Security & Compliance Considerations
> [!IMPORTANT]
> Zero-trust boundary: All incoming service-to-service payloads must validate SHA-256 signatures.

## Implementation Plan & Rollout
- [ ] Database schema migrations
- [ ] Integration test suite pass
- [ ] Canary deployment
`;

export const WEEKLY_STATUS_TEMPLATE = `# Weekly Engineering Status Pulse

<!-- status-block ragStatus="green" milestoneTitle="Core Platform Sprint 4" completionPercent="75" targetDate="2026-11-15" blockers="None" -->

## Key Deliverables Completed
- Delivered database indexing optimizations (p99 latency dropped from 120ms to 18ms).
- Verified MCP bidirectional synchronization and audit logging.

## Objectives for Next Sprint
- [ ] Finalize multi-user stress fuzzing benchmarks.
- [ ] Roll out air-gapped staging environment.

## Active Blockers & In-Flight Inquiries
> [!TIP]
> No hard blockers this week. SecOps review meeting scheduled for Thursday.
`;

export function registerDocumentationResources(server: McpServer, logger: pino.Logger): void {
  // 1. Editor block specification
  (server as any).resource(
    'glyphroom-block-specification',
    'glyphroom://documentation/editor-blocks',
    {
      description: 'Complete specification and syntax guide for Glyphroom custom editor blocks (Alerts, Mermaid, Math, Status Cards, Tables).',
      mimeType: 'text/markdown',
    },
    async (uri: any) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: GLYPHROOM_BLOCK_DOCUMENTATION,
        },
      ],
    })
  );

  // 2. Architecture RFC template
  (server as any).resource(
    'glyphroom-architecture-rfc-template',
    'glyphroom://templates/architecture-rfc',
    {
      description: 'Standard template for drafting technical specifications and Architecture RFCs in Glyphroom.',
      mimeType: 'text/markdown',
    },
    async (uri: any) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: ARCHITECTURE_RFC_TEMPLATE,
        },
      ],
    })
  );

  // 3. Weekly status pulse template
  (server as any).resource(
    'glyphroom-weekly-pulse-template',
    'glyphroom://templates/weekly-pulse',
    {
      description: 'Standard template for drafting weekly engineering status reports and sprint pulses.',
      mimeType: 'text/markdown',
    },
    async (uri: any) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: WEEKLY_STATUS_TEMPLATE,
        },
      ],
    })
  );

  logger.info('Registered Glyphroom documentation and template MCP resources');
}
