import React from 'react';
import type { PluginManifest } from '@enterprise-blogger/shared';
import { JiraIssueNode } from './jira-node.js';

export const jiraEmbedManifest: PluginManifest = {
  id: 'jira-embed',
  name: 'Jira Issue Embed',
  version: '1.0.0',
  description:
    'Renders safe, declarative Jira issue status cards in collaborative documents.',
  author: 'Enterprise Blogger Engineering',
  capabilities: ['ui:editor', 'ui:slots'],
};

const JiraToolbarButton: React.FC<{ editor?: any }> = ({ editor }) => {
  if (!editor) return null;

  return (
    <button
      type="button"
      onClick={() => {
        editor.commands.insertJiraIssue({
          issueKey: 'ENG-101',
          summary: 'Platform Security Review',
          status: 'In Progress',
          url: 'https://jira.enterprise.local/browse/ENG-101',
        });
      }}
      className="flex items-center gap-1 px-2 py-1 rounded-md border border-blue-300 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 text-xs font-semibold mr-1 shadow-xs transition-colors"
      title="Insert Jira Issue Card"
    >
      <span className="font-mono text-[10px] font-bold">JIRA</span>
    </button>
  );
};

export const jiraEmbedPlugin = {
  manifest: jiraEmbedManifest,
  editorExtensions: [JiraIssueNode],
  slashCommands: [
    {
      id: 'jira',
      label: 'Jira Issue Card',
      description: 'Insert an enterprise Jira issue card',
      keywords: ['jira', 'ticket', 'issue', 'tracker', 'task'],
      order: 40,
      execute: (editor: any) => {
        return editor
          .chain()
          .focus()
          .insertJiraIssue({
            issueKey: 'ENG-101',
            summary: 'Platform Security Review',
            status: 'In Progress',
            url: 'https://jira.enterprise.local/browse/ENG-101',
          })
          .run();
      },
    },
  ],
  slots: [
    {
      slot: 'editor:toolbar:actions' as const,
      order: 50,
      component: JiraToolbarButton,
    },
  ],
};
