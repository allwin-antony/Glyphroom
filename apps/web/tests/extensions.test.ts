import { describe, it, expect } from 'vitest';
import { Schema } from 'prosemirror-model';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { SuggestionInsert, SuggestionDelete } from '../src/extensions/suggestion.js';
import { Alert } from '../src/extensions/alert.js';
import { MathBlock } from '../src/extensions/math.js';
import { MermaidBlock } from '../src/extensions/mermaid.js';
import { ProjectStatusBlock } from '../src/extensions/status-block.js';

describe('TipTap Web Extensions & Schema Compilation Suite', () => {
  it('correctly registers suggestion_insert and suggestion_delete marks', () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        SuggestionInsert,
        SuggestionDelete,
        Alert,
      ],
      content: '<p>Initial test content</p>',
    });

    const schema: Schema = editor.schema;

    expect(schema.marks.suggestion_insert).toBeDefined();
    expect(schema.marks.suggestion_delete).toBeDefined();
    expect(schema.nodes.alert).toBeDefined();

    // Verify mark attributes
    const insertMark = schema.marks.suggestion_insert.create({
      id: 'sug-123',
      agentId: 'agent:claude-3-7',
      tokenId: 'tok-999',
      ownerUserId: 'user-lead',
      timestamp: 1729680000000,
      status: 'pending',
    });

    expect(insertMark.attrs.id).toBe('sug-123');
    expect(insertMark.attrs.agentId).toBe('agent:claude-3-7');
    expect(insertMark.attrs.status).toBe('pending');

    editor.destroy();
  });

  it('renders and parses alert nodes with type attributes', () => {
    const editor = new Editor({
      extensions: [StarterKit, Alert],
      content: '<div class="enterprise-alert" data-alert-type="warning"><p>Attention required</p></div>',
    });

    const json = editor.getJSON();
    const alertNode = json.content?.find((n: any) => n.type === 'alert');

    expect(alertNode).toBeDefined();
    expect(alertNode.attrs?.type).toBe('warning');

    editor.destroy();
  });

  it('registers table, task list, math, mermaid, and project status extensions', () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        TaskList,
        TaskItem,
        MathBlock,
        MermaidBlock,
        ProjectStatusBlock,
      ],
      content: '<p>Schema test</p>',
    });

    const schema: Schema = editor.schema;

    // Verify all structured enterprise nodes are compiled into schema
    expect(schema.nodes.table).toBeDefined();
    expect(schema.nodes.tableRow).toBeDefined();
    expect(schema.nodes.tableHeader).toBeDefined();
    expect(schema.nodes.tableCell).toBeDefined();
    expect(schema.nodes.taskList).toBeDefined();
    expect(schema.nodes.taskItem).toBeDefined();
    expect(schema.nodes.mathBlock).toBeDefined();
    expect(schema.nodes.mermaidBlock).toBeDefined();
    expect(schema.nodes.projectStatusBlock).toBeDefined();

    // Test Table Insertion command
    editor.chain().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
    const tableJson = editor.getJSON();
    const tableNode = tableJson.content?.find((n: any) => n.type === 'table');
    expect(tableNode).toBeDefined();
    expect(tableNode.content?.length).toBe(2); // 2 rows

    // Test Project Status Block Insertion at document end
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: 'projectStatusBlock',
      attrs: {
        ragStatus: 'amber',
        milestoneTitle: 'Security Audit Signoff',
        completionPercent: 80,
      },
    });

    const statusJson = editor.getJSON();
    const statusNode = statusJson.content?.find((n: any) => n.type === 'projectStatusBlock');
    expect(statusNode).toBeDefined();
    expect(statusNode.attrs.ragStatus).toBe('amber');
    expect(statusNode.attrs.milestoneTitle).toBe('Security Audit Signoff');
    expect(statusNode.attrs.completionPercent).toBe(80);

    editor.destroy();
  });
});
