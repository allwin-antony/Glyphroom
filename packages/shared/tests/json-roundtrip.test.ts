import { describe, it, expect } from 'vitest';
import { blogSchema } from '../src/schema/index.js';
import {
  nodeFromJSON,
  nodeToJSON,
  validateDocumentJSON,
  createEmptyDocument,
} from '../src/schema/json.js';
import {
  tableFixture,
  alertFixture,
  mathFixture,
  mermaidFixture,
  codeFixture,
} from '../src/fixtures/canonical.js';

describe('ProseMirror JSON Lossless Round-Trip Fixtures', () => {
  it('creates an empty initial document and validates it', () => {
    const emptyDoc = createEmptyDocument(blogSchema);
    expect(emptyDoc.type.name).toBe('doc');
    expect(emptyDoc.childCount).toBe(1);
    expect(emptyDoc.child(0).type.name).toBe('paragraph');

    const json = nodeToJSON(emptyDoc);
    const validation = validateDocumentJSON(blogSchema, json);
    expect(validation.valid).toBe(true);
  });

  describe('GFM Table Fixture Round-Trip', () => {
    it('validates and round-trips the table fixture losslessly', () => {
      const validation = validateDocumentJSON(blogSchema, tableFixture);
      expect(validation.valid).toBe(true);

      const doc = nodeFromJSON(blogSchema, tableFixture);
      expect(doc.type.name).toBe('doc');
      const table = doc.firstChild!;
      expect(table.type.name).toBe('table');
      expect(table.childCount).toBe(2);

      const serialized = nodeToJSON(doc);
      expect(serialized).toEqual(tableFixture);

      const roundTrippedDoc = nodeFromJSON(blogSchema, serialized);
      expect(roundTrippedDoc.eq(doc)).toBe(true);
    });
  });

  describe('GitHub Alert Fixture Round-Trip', () => {
    it('validates and round-trips the alert fixture losslessly', () => {
      const validation = validateDocumentJSON(blogSchema, alertFixture);
      expect(validation.valid).toBe(true);

      const doc = nodeFromJSON(blogSchema, alertFixture);
      const alertNode = doc.firstChild!;
      expect(alertNode.type.name).toBe('callout_alert');
      expect(alertNode.attrs.alertType).toBe('WARNING');
      expect(alertNode.childCount).toBe(2); // paragraph + bullet_list

      const serialized = nodeToJSON(doc);
      expect(serialized).toEqual(alertFixture);

      const roundTrippedDoc = nodeFromJSON(blogSchema, serialized);
      expect(roundTrippedDoc.eq(doc)).toBe(true);
    });
  });

  describe('KaTeX Math Fixture Round-Trip', () => {
    it('validates and round-trips the math fixture losslessly', () => {
      const validation = validateDocumentJSON(blogSchema, mathFixture);
      expect(validation.valid).toBe(true);

      const doc = nodeFromJSON(blogSchema, mathFixture);
      expect(doc.childCount).toBe(2);

      const para = doc.child(0);
      const mathInline = para.child(1);
      expect(mathInline.type.name).toBe('math_inline');
      expect(mathInline.attrs.tex).toBe('E = mc^2');

      const mathDisplay = doc.child(1);
      expect(mathDisplay.type.name).toBe('math_display');
      expect(mathDisplay.attrs.tex).toContain('\\int');

      const serialized = nodeToJSON(doc);
      expect(serialized).toEqual(mathFixture);

      const roundTrippedDoc = nodeFromJSON(blogSchema, serialized);
      expect(roundTrippedDoc.eq(doc)).toBe(true);
    });
  });

  describe('Mermaid Diagram Fixture Round-Trip', () => {
    it('validates and round-trips the mermaid fixture losslessly', () => {
      const validation = validateDocumentJSON(blogSchema, mermaidFixture);
      expect(validation.valid).toBe(true);

      const doc = nodeFromJSON(blogSchema, mermaidFixture);
      const mermaid = doc.firstChild!;
      expect(mermaid.type.name).toBe('mermaid_block');
      expect(mermaid.attrs.securityLevel).toBe('strict');
      expect(mermaid.textContent).toContain('flowchart TD');

      const serialized = nodeToJSON(doc);
      expect(serialized).toEqual(mermaidFixture);

      const roundTrippedDoc = nodeFromJSON(blogSchema, serialized);
      expect(roundTrippedDoc.eq(doc)).toBe(true);
    });
  });

  describe('Fenced Code Block Fixture Round-Trip', () => {
    it('validates and round-trips the code block fixture losslessly', () => {
      const validation = validateDocumentJSON(blogSchema, codeFixture);
      expect(validation.valid).toBe(true);

      const doc = nodeFromJSON(blogSchema, codeFixture);
      const code = doc.firstChild!;
      expect(code.type.name).toBe('code_block');
      expect(code.attrs.language).toBe('typescript');
      expect(code.textContent).toContain('export function testConvergence()');

      const serialized = nodeToJSON(doc);
      expect(serialized).toEqual(codeFixture);

      const roundTrippedDoc = nodeFromJSON(blogSchema, serialized);
      expect(roundTrippedDoc.eq(doc)).toBe(true);
    });
  });
});
