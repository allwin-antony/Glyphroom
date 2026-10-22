import { describe, it, expect } from 'vitest';
import { Schema } from 'prosemirror-model';
import {
  allMarks,
  standardMarks,
  suggestionMarks,
  MARK_SUGGESTION_INSERT,
  MARK_SUGGESTION_DELETE,
} from '../src/schema/marks/index.js';
import { blogNodes } from '../src/schema/nodes/index.js';
import { blogSchema } from '../src/schema/index.js';

describe('ProseMirror Schema Compilation & Mark Registry', () => {
  it('successfully compiles the complete schema with all nodes and marks', () => {
    expect(() => {
      new Schema({
        nodes: blogNodes,
        marks: allMarks,
        topNode: 'doc',
      });
    }).not.toThrow();
  });

  it('verifies blogSchema is pre-compiled and valid', () => {
    expect(blogSchema).toBeDefined();
    expect(blogSchema.nodes.doc).toBeDefined();
    expect(blogSchema.nodes.table).toBeDefined();
    expect(blogSchema.nodes.callout_alert).toBeDefined();
    expect(blogSchema.nodes.math_display).toBeDefined();
    expect(blogSchema.nodes.math_inline).toBeDefined();
    expect(blogSchema.nodes.mermaid_block).toBeDefined();
    expect(blogSchema.nodes.code_block).toBeDefined();
  });

  it('verifies all required standard marks are registered', () => {
    const schema = new Schema({ nodes: blogNodes, marks: allMarks });
    expect(schema.marks.strong).toBeDefined();
    expect(schema.marks.em).toBeDefined();
    expect(schema.marks.link).toBeDefined();
    expect(schema.marks.code).toBeDefined();
  });

  it('verifies all required suggestion marks are registered with correct names', () => {
    const schema = new Schema({ nodes: blogNodes, marks: allMarks });
    expect(schema.marks[MARK_SUGGESTION_INSERT]).toBeDefined();
    expect(schema.marks[MARK_SUGGESTION_DELETE]).toBeDefined();
    expect(schema.marks.attribution).toBeDefined();
  });

  it('enforces that code mark excludes other formatting marks', () => {
    const schema = new Schema({ nodes: blogNodes, marks: allMarks });
    const codeType = schema.marks.code;
    expect(codeType.excludes(schema.marks.strong)).toBe(true);
    expect(codeType.excludes(schema.marks.em)).toBe(true);
  });

  it('enforces mutual exclusion between suggestion_insert and suggestion_delete', () => {
    const schema = new Schema({ nodes: blogNodes, marks: allMarks });
    const insertType = schema.marks[MARK_SUGGESTION_INSERT];
    const deleteType = schema.marks[MARK_SUGGESTION_DELETE];

    expect(insertType.excludes(deleteType)).toBe(true);
    expect(deleteType.excludes(insertType)).toBe(true);
  });

  it('allows suggestion marks to co-exist with standard formatting marks', () => {
    const schema = new Schema({ nodes: blogNodes, marks: allMarks });
    const insertType = schema.marks[MARK_SUGGESTION_INSERT];

    expect(insertType.excludes(schema.marks.strong)).toBe(false);
    expect(insertType.excludes(schema.marks.em)).toBe(false);
    expect(insertType.excludes(schema.marks.link)).toBe(false);
  });
});
