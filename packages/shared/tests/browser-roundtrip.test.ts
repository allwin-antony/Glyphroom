import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import { exportDerivedMarkdown } from '../src/export/markdown.js';
import { blogSchema } from '../src/schema/index.js';
import { suggestEditSection } from '../src/suggestion/operations.js';

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('browser-shaped content preservation', () => {
  it('exports a mixed browser document without dropping rich blocks or inline formatting', () => {
    const markdown = exportDerivedMarkdown({ type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Overview' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }, { type: 'hardBreak' }, { type: 'text', text: 'Italic', marks: [{ type: 'italic' }] }] },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const x = 1;' }] },
      { type: 'mermaidBlock', attrs: { code: 'graph TD\nA --> B' } },
      { type: 'mathBlock', attrs: { formula: 'E = mc^2' } },
      { type: 'projectStatusBlock', attrs: { milestoneTitle: 'Milestone', completionPercent: 0 } },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [paragraph('Header')] }] }, { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph('Value | pipe')] }] }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [paragraph('Complete')] }] },
      { type: 'image', attrs: { src: '/image.png', alt: 'Diagram' } },
      { type: 'fileAttachmentBlock', attrs: { url: '/design.pdf', fileName: 'Design' } },
    ] });
    for (const expected of ['## Overview', '**Bold**  \n*Italic*', '```ts\nconst x = 1;', '```mermaid\ngraph TD\nA --> B', '$$\nE = mc^2\n$$', 'milestoneTitle="Milestone"', 'completionPercent="0"', '| Header |', 'Value \\| pipe', '- [x] Complete', '![Diagram](/image.png)', '[Design](/design.pdf)']) {
      expect(markdown).toContain(expected);
    }
  });

  it('does not publish pending insertion text inside code blocks, including legacy blocks', () => {
    for (const type of ['codeBlock', 'code_block']) {
      expect(exportDerivedMarkdown({ type: 'doc', content: [{ type, content: [
        { type: 'text', text: 'original', marks: [{ type: 'suggestion_delete', attrs: { id: 'd', status: 'pending' } }] },
        { type: 'text', text: 'pending', marks: [{ type: 'suggestion_insert', attrs: { id: 'i', status: 'pending' } }] },
      ] }] })).toBe('```\noriginal\n```');
    }
  });

  it('rejects a structured section without making any Yjs mutation', () => {
    const doc = prosemirrorJSONToYDoc(blogSchema, { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Table section' }] },
      { type: 'table', content: [{ type: 'table_row', content: [{ type: 'table_header', content: [paragraph('Header')] }] }] },
    ] }, 'prosemirror');
    const before = Y.encodeStateAsUpdate(doc);
    expect(() => suggestEditSection(doc, 'Table section', 'Replacement', { agentId: 'agent', tokenId: 'token', ownerUserId: 'owner', timestamp: Date.now() })).toThrow('unsupported structured block');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    doc.destroy();
  });
});
