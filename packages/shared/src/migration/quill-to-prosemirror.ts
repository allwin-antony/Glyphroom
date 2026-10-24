import * as Y from 'yjs';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import { blogSchema } from '../schema/index.js';

export interface QuillOp {
  insert: string | Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

export interface QuillDelta {
  ops: QuillOp[];
}

export interface MigrationValidationReport {
  inputCharCount: number;
  outputCharCount: number;
  headingsCount: number;
  paragraphsCount: number;
  contentLossRatio: number; // 0.0 means 0% content loss
  isValid: boolean;
}

export interface MigrationResult {
  prosemirrorDoc: Record<string, unknown>;
  yjsState: Uint8Array;
  report: MigrationValidationReport;
}

/**
 * Migrate legacy Quill Delta to canonical ProseMirror document tree and binary Yjs state.
 * Conforms to Task 6.1 of docs/ROADMAP.md.
 */
export function migrateQuillDeltaToProseMirror(delta: QuillDelta): MigrationResult {
  const nodes: Array<Record<string, unknown>> = [];

  let currentLineText = '';
  let currentMarks: Array<Record<string, unknown>> = [];
  let currentInlineNodes: Array<Record<string, unknown>> = [];
  let totalInputChars = 0;
  let headingsCount = 0;
  let paragraphsCount = 0;

  for (const op of delta.ops) {
    if (typeof op.insert === 'string') {
      totalInputChars += op.insert.length;
      const parts = op.insert.split('\n');

      for (let i = 0; i < parts.length; i++) {
        const textSegment = parts[i];

        if (textSegment.length > 0) {
          const marks: Array<Record<string, unknown>> = [];
          if (op.attributes?.bold) marks.push({ type: 'strong' });
          if (op.attributes?.italic) marks.push({ type: 'em' });
          if (op.attributes?.code) marks.push({ type: 'code' });

          currentInlineNodes.push({
            type: 'text',
            text: textSegment,
            ...(marks.length > 0 ? { marks } : {}),
          });
        }

        // Newline indicates end of line / block element
        if (i < parts.length - 1) {
          const isHeading = Boolean(op.attributes?.header);
          const level = Number(op.attributes?.header) || 1;

          if (isHeading) {
            headingsCount++;
            nodes.push({
              type: 'heading',
              attrs: { level: Math.min(Math.max(level, 1), 6) },
              content: currentInlineNodes.length > 0 ? currentInlineNodes : [{ type: 'text', text: ' ' }],
            });
          } else {
            paragraphsCount++;
            nodes.push({
              type: 'paragraph',
              content: currentInlineNodes.length > 0 ? currentInlineNodes : undefined,
            });
          }

          currentInlineNodes = [];
        }
      }
    }
  }

  // Trailing line if not ended with newline
  if (currentInlineNodes.length > 0) {
    paragraphsCount++;
    nodes.push({
      type: 'paragraph',
      content: currentInlineNodes,
    });
  }

  // If document is completely empty, provide fallback empty paragraph
  if (nodes.length === 0) {
    nodes.push({ type: 'paragraph' });
  }

  const prosemirrorDoc = {
    type: 'doc',
    content: nodes,
  };

  // Convert to canonical Yjs binary state
  const ydoc = prosemirrorJSONToYDoc(blogSchema, prosemirrorDoc as any, 'prosemirror');
  const yjsState = Y.encodeStateAsUpdate(ydoc);

  // Compute validation report
  let outputCharCount = 0;
  for (const n of nodes) {
    if (Array.isArray(n.content)) {
      for (const inline of n.content) {
        if (typeof inline.text === 'string') {
          outputCharCount += inline.text.length;
        }
      }
    }
  }

  // Account for newlines in input
  const nonNewlineInputChars = delta.ops.reduce((acc, op) => {
    return acc + (typeof op.insert === 'string' ? op.insert.replace(/\n/g, '').length : 0);
  }, 0);

  const charDiff = Math.abs(nonNewlineInputChars - outputCharCount);
  const contentLossRatio = nonNewlineInputChars > 0 ? charDiff / nonNewlineInputChars : 0;

  const report: MigrationValidationReport = {
    inputCharCount: totalInputChars,
    outputCharCount,
    headingsCount,
    paragraphsCount,
    contentLossRatio,
    isValid: contentLossRatio <= 0.01, // <= 1% loss criterion from Task 6.1
  };

  return {
    prosemirrorDoc,
    yjsState,
    report,
  };
}
