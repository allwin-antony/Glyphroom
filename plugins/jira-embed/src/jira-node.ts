import { Node, mergeAttributes } from '@tiptap/core';

export interface JiraIssueAttributes {
  issueKey: string;
  summary: string;
  status: string;
  url: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    jiraIssue: {
      insertJiraIssue: (attributes: Partial<JiraIssueAttributes>) => ReturnType;
    };
  }
}

export const JiraIssueNode = Node.create({
  name: 'jiraIssue',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      issueKey: {
        default: 'PROJ-101',
        parseHTML: (el) => el.getAttribute('data-issue-key'),
        renderHTML: (attrs) => ({ 'data-issue-key': attrs.issueKey }),
      },
      summary: {
        default: 'Enterprise Task',
        parseHTML: (el) => el.getAttribute('data-summary'),
        renderHTML: (attrs) => ({ 'data-summary': attrs.summary }),
      },
      status: {
        default: 'In Progress',
        parseHTML: (el) => el.getAttribute('data-status'),
        renderHTML: (attrs) => ({ 'data-status': attrs.status }),
      },
      url: {
        default: 'https://jira.enterprise.local/browse/PROJ-101',
        parseHTML: (el) => el.getAttribute('data-url'),
        renderHTML: (attrs) => ({ 'data-url': attrs.url }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="jira-issue"]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { issueKey, summary, status, url } = node.attrs;

    return [
      'div',
      mergeAttributes(
        {
          'data-type': 'jira-issue',
          'data-issue-key': issueKey,
          'data-status': status,
        },
        HTMLAttributes,
        {
          class:
            'jira-issue-card flex items-center justify-between p-3 my-2 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 text-xs shadow-xs',
        }
      ),
      [
        'div',
        { class: 'flex items-center gap-2 font-mono' },
        ['span', { class: 'font-bold text-blue-600 dark:text-blue-400' }, issueKey],
        ['span', { class: 'text-foreground font-sans' }, summary],
      ],
      [
        'div',
        { class: 'flex items-center gap-2' },
        [
          'span',
          {
            class:
              'px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200',
          },
          status,
        ],
        [
          'a',
          {
            href: url,
            target: '_blank',
            rel: 'noopener noreferrer',
            class: 'text-text-muted hover:text-foreground text-[11px] underline',
          },
          'View',
        ],
      ],
    ];
  },

  addCommands() {
    return {
      insertJiraIssue:
        (attributes) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: attributes,
          });
        },
    };
  },
});
