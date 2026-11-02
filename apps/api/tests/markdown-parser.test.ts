import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { exportDerivedMarkdown, normalizeMarkdownInput } from '@glyphroom/shared';

// Mirrors the helper in apps/api/src/routes/posts.ts to ensure unit-level regression coverage
function populateYjsFromMarkdown(ydoc: Y.Doc, markdown: string) {
  const fragment = ydoc.getXmlFragment('prosemirror');
  const normalized = normalizeMarkdownInput(markdown);
  const lines = normalized.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      const text = hMatch[2].trim();
      const h = new Y.XmlElement('heading');
      h.setAttribute('level', String(level));
      const ht = new Y.XmlText(text);
      h.insert(0, [ht]);
      fragment.push([h]);
      i++;
      continue;
    }

    if (line.trim().startsWith('```mermaid')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      const m = new Y.XmlElement('mermaidBlock');
      m.setAttribute('code', codeLines.join('\n').trim());
      fragment.push([m]);
      continue;
    }

    if (line.trim() === '$$') {
      const mathLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '$$') {
        mathLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      const mb = new Y.XmlElement('mathBlock');
      mb.setAttribute('formula', mathLines.join('\n').trim());
      fragment.push([mb]);
      continue;
    }

    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      const cb = new Y.XmlElement('codeBlock');
      if (lang) cb.setAttribute('language', lang);
      const cbt = new Y.XmlText(codeLines.join('\n'));
      cb.insert(0, [cbt]);
      fragment.push([cb]);
      continue;
    }

    const alertMatch = line.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](.*)$/i);
    if (alertMatch) {
      const alertType = alertMatch[1].toLowerCase();
      const firstLine = alertMatch[2].trim();
      const alertLines: string[] = firstLine ? [firstLine] : [];
      i++;
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        alertLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      const alertEl = new Y.XmlElement('alert');
      alertEl.setAttribute('type', alertType);
      alertEl.setAttribute('alertType', alertType.toUpperCase());
      const alertP = new Y.XmlElement('paragraph');
      const alertText = new Y.XmlText(alertLines.join('\n').trim());
      alertP.insert(0, [alertText]);
      alertEl.insert(0, [alertP]);
      fragment.push([alertEl]);
      continue;
    }

    if (line.trim().startsWith('>')) {
      const bqLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        bqLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      const bqEl = new Y.XmlElement('blockquote');
      const bqP = new Y.XmlElement('paragraph');
      const bqText = new Y.XmlText(bqLines.join('\n').trim());
      bqP.insert(0, [bqText]);
      bqEl.insert(0, [bqP]);
      fragment.push([bqEl]);
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].match(/^#{1,6}\s+/) &&
      !lines[i].trim().startsWith('```') &&
      lines[i].trim() !== '$$' &&
      !lines[i].trim().startsWith('>')
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    const p = new Y.XmlElement('paragraph');
    const pt = new Y.XmlText(paraLines.join('\n'));
    p.insert(0, [pt]);
    fragment.push([p]);
  }
}

describe('populateYjsFromMarkdown robustness', () => {
  it('correctly handles double-escaped newlines without bundling everything into a single heading', () => {
    const raw = '# First Post\\n\\nThis draft was generated and created via the Glyphroom MCP tool interface.\\n\\n> [!NOTE]\\n> Created with active PAT authentication.';
    const ydoc = new Y.Doc();
    populateYjsFromMarkdown(ydoc, raw);

    const json: any = yDocToProsemirrorJSON(ydoc, 'prosemirror');
    expect(json.content).toBeDefined();
    expect(json.content.length).toBe(3);

    // Block 1: heading
    expect(json.content[0].type).toBe('heading');
    expect(Number(json.content[0].attrs.level)).toBe(1);
    expect(json.content[0].content[0].text).toBe('First Post');

    // Block 2: paragraph
    expect(json.content[1].type).toBe('paragraph');
    expect(json.content[1].content[0].text).toBe(
      'This draft was generated and created via the Glyphroom MCP tool interface.'
    );

    // Block 3: alert
    expect(json.content[2].type).toBe('alert');
    expect(json.content[2].attrs.type).toBe('note');
    expect(json.content[2].content[0].content[0].text).toBe('Created with active PAT authentication.');

    // Verify derived export roundtrip
    const exported = exportDerivedMarkdown(json);
    expect(exported).toContain('# First Post');
    expect(exported).toContain('> [!NOTE]');
    expect(exported).toContain('> Created with active PAT authentication.');
  });
});
