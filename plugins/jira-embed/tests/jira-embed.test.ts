import { describe, it, expect } from 'vitest';
import { JiraIssueNode } from '../src/jira-node.js';
import { jiraEmbedPlugin, jiraEmbedManifest } from '../src/plugin.js';

describe('Jira Embed Reference Web Plugin', () => {
  it('defines valid JiraIssueNode with expected attributes', () => {
    expect(JiraIssueNode.name).toBe('jiraIssue');

    const attributes = JiraIssueNode.config.addAttributes?.call({} as any);
    expect(attributes).toBeDefined();
    expect(attributes?.issueKey).toBeDefined();
    expect(attributes?.summary).toBeDefined();
    expect(attributes?.status).toBeDefined();
    expect(attributes?.url).toBeDefined();
  });

  it('renders safe HTML structure with data attributes', () => {
    const mockNode = {
      attrs: {
        issueKey: 'ENG-404',
        summary: 'Database Failover Drill',
        status: 'In Progress',
        url: 'https://jira.enterprise.local/browse/ENG-404',
      },
    } as any;

    const htmlOutput = JiraIssueNode.config.renderHTML?.call({} as any, {
      node: mockNode,
      HTMLAttributes: {},
    });

    expect(htmlOutput).toBeDefined();
    expect(Array.isArray(htmlOutput)).toBe(true);

    const [tag, attrs, ...children] = htmlOutput as any[];
    expect(tag).toBe('div');
    expect(attrs['data-type']).toBe('jira-issue');
    expect(attrs['data-issue-key']).toBe('ENG-404');
    expect(attrs['data-status']).toBe('In Progress');
  });

  it('exports /jira slash command without colliding with core commands', () => {
    expect(jiraEmbedPlugin.slashCommands.length).toBe(1);
    const cmd = jiraEmbedPlugin.slashCommands[0];
    expect(cmd.id).toBe('jira');
    expect(cmd.label).toBe('Jira Issue Card');
    expect(cmd.keywords).toContain('ticket');

    let insertedAttrs: any = null;
    const mockEditor = {
      chain: () => ({
        focus: () => ({
          insertJiraIssue: (attrs: any) => {
            insertedAttrs = attrs;
            return { run: () => true };
          },
        }),
      }),
    };

    const res = cmd.execute(mockEditor);
    expect(res).toBe(true);
    expect(insertedAttrs).toBeDefined();
    expect(insertedAttrs.issueKey).toBe('ENG-101');
  });

  it('provides toolbar action slot contribution', () => {
    expect(jiraEmbedPlugin.slots.length).toBe(1);
    expect(jiraEmbedPlugin.slots[0].slot).toBe('editor:toolbar:actions');
    expect(typeof jiraEmbedPlugin.slots[0].component).toBe('function');
  });
});
