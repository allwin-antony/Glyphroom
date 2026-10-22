import { Schema, SchemaSpec, NodeSpec, MarkSpec } from 'prosemirror-model';
import { blogNodes } from './nodes/index.js';
import { allMarks, standardMarks, suggestionMarks } from './marks/index.js';

export * from './nodes/index.js';
export * from './marks/index.js';
export * from './table-grid.js';
export * from './json.js';

export const blogSchemaSpec: SchemaSpec = {
  nodes: blogNodes,
  marks: allMarks,
  topNode: 'doc',
};

export function createBlogSchema(
  customNodes?: Record<string, NodeSpec>,
  customMarks?: Record<string, MarkSpec>
): Schema {
  return new Schema({
    nodes: { ...blogNodes, ...customNodes },
    marks: { ...allMarks, ...customMarks },
    topNode: 'doc',
  });
}

export const blogSchema: Schema = createBlogSchema();
