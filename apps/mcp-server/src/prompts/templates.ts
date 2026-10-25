import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type pino from 'pino';

export function registerPromptTemplates(server: McpServer, logger: pino.Logger): void {
  // 1. Architecture RFC Prompt
  (server as any).prompt(
    'draft-architecture-rfc',
    'Guides the AI agent to draft a comprehensive Architecture RFC formatted with Mermaid diagrams and callout alerts for Glyphroom.',
    async () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              'You are an expert Principal Systems Architect. Draft a comprehensive Architecture RFC for Glyphroom.\n\n' +
              'Requirements:\n' +
              '1. Structure: Context & Problem Statement, Architecture Diagram, Decision & Rationale, Security & Compliance, Rollout Plan.\n' +
              '2. Use a Mermaid flowchart or sequence diagram inside ```mermaid ... ```.\n' +
              '3. Use GitHub-style callouts (`> [!NOTE]`, `> [!IMPORTANT]`, `> [!WARNING]`).\n' +
              '4. Include structured tables for tradeoffs and task checklists (`- [ ]`).\n' +
              '5. Call the `create_post` tool to create the draft, and then `append_section` to add additional technical sections.',
          },
        },
      ],
    })
  );

  // 2. Weekly Status Pulse Prompt
  (server as any).prompt(
    'draft-weekly-pulse',
    'Guides the AI agent to draft an engineering team weekly pulse with a projectStatusBlock card and milestone bullets.',
    async () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              'You are an Engineering Manager. Draft a clear weekly engineering status pulse for Glyphroom.\n\n' +
              'Requirements:\n' +
              '1. Include an interactive status card at the top:\n' +
              '   <!-- status-block ragStatus="green" milestoneTitle="Sprint Milestone" completionPercent="70" targetDate="2026-12-01" blockers="None" -->\n' +
              '2. Sections: Key Deliverables Completed This Week, Objectives for Next Sprint, Active Blockers & Dependencies.\n' +
              '3. Use `> [!TIP]` or `> [!NOTE]` callouts for team announcements.\n' +
              '4. Use `create_post` to create the document.',
          },
        },
      ],
    })
  );

  logger.info('Registered Glyphroom prompt templates in MCP server');
}
