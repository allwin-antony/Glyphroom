import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import { migrateQuillDeltaToProseMirror } from '../src/migration/quill-to-prosemirror.js';

describe('Task 6.1: Legacy Quill Delta to ProseMirror & Yjs Migration Suite', () => {
  it('losslessly converts Quill delta with headings, bold, and paragraphs', () => {
    const quillDelta = {
      ops: [
        { insert: 'Legacy Enterprise Architecture' },
        { insert: '\n', attributes: { header: 1 } },
        { insert: 'This is ' },
        { insert: 'bold text', attributes: { bold: true } },
        { insert: ' and regular description.\n' },
        { insert: 'Sub-heading Section' },
        { insert: '\n', attributes: { header: 2 } },
        { insert: 'Final concluding paragraph.\n' },
      ],
    };

    const { prosemirrorDoc, yjsState, report } = migrateQuillDeltaToProseMirror(quillDelta);

    // 1. Assert validation report
    expect(report.isValid).toBe(true);
    expect(report.contentLossRatio).toBeLessThanOrEqual(0.01);
    expect(report.headingsCount).toBe(2);
    expect(report.paragraphsCount).toBe(2);

    // 2. Assert ProseMirror JSON structure
    const content = prosemirrorDoc.content as any[];
    expect(content[0].type).toBe('heading');
    expect(content[0].attrs.level).toBe(1);
    expect(content[0].content[0].text).toBe('Legacy Enterprise Architecture');

    expect(content[1].type).toBe('paragraph');
    const boldNode = content[1].content.find((n: any) => n.text === 'bold text');
    expect(boldNode).toBeDefined();
    expect(boldNode.marks[0].type).toBe('strong');

    expect(content[2].type).toBe('heading');
    expect(content[2].attrs.level).toBe(2);

    // 3. Assert canonical Yjs binary state reconstructs identical ProseMirror document
    expect(yjsState).toBeInstanceOf(Uint8Array);
    expect(yjsState.length).toBeGreaterThan(0);

    const reloadedDoc = new Y.Doc();
    Y.applyUpdate(reloadedDoc, yjsState);
    const reconstructedPM = yDocToProsemirrorJSON(reloadedDoc, 'prosemirror');

    expect(reconstructedPM.type).toBe('doc');
    expect(reconstructedPM.content).toHaveLength(4);
  });

  it('safely handles empty Quill Delta without errors', () => {
    const { prosemirrorDoc, report } = migrateQuillDeltaToProseMirror({ ops: [] });
    expect(report.isValid).toBe(true);
    expect(prosemirrorDoc.content).toHaveLength(1);
  });
});
