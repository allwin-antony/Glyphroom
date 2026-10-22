import { Node as ProseMirrorNode, Schema } from 'prosemirror-model';

export interface ProseMirrorMarkJSON {
  type: string;
  attrs?: Record<string, any>;
}

export interface ProseMirrorNodeJSON {
  type: string;
  attrs?: Record<string, any>;
  content?: ProseMirrorNodeJSON[];
  marks?: ProseMirrorMarkJSON[];
  text?: string;
}

export interface ProseMirrorDocJSON extends ProseMirrorNodeJSON {
  type: 'doc';
  content: ProseMirrorNodeJSON[];
}

/**
 * Losslessly serializes a ProseMirror AST Node into plain JSON.
 */
export function nodeToJSON(node: ProseMirrorNode): ProseMirrorNodeJSON {
  return node.toJSON() as ProseMirrorNodeJSON;
}

/**
 * Losslessly deserializes a plain JSON object into a typed ProseMirror Node.
 */
export function nodeFromJSON(schema: Schema, json: unknown): ProseMirrorNode {
  if (!json || typeof json !== 'object' || !('type' in json)) {
    throw new Error('Invalid ProseMirror JSON: input must be an object with a "type" property');
  }
  return schema.nodeFromJSON(json);
}

/**
 * Validates whether a JSON payload represents a structurally valid ProseMirror document.
 */
export function validateDocumentJSON(
  schema: Schema,
  json: unknown
): { valid: boolean; error?: string; doc?: ProseMirrorNode } {
  try {
    const doc = nodeFromJSON(schema, json);
    doc.check(); // Throws if node hierarchy violates schema content constraints
    return { valid: true, doc };
  } catch (err: any) {
    return { valid: false, error: err?.message || String(err) };
  }
}

/**
 * Creates an empty initial document containing a single empty paragraph.
 */
export function createEmptyDocument(schema: Schema): ProseMirrorNode {
  return schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]);
}
