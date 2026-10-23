import { describe, it, expect } from 'vitest';
import { exportDerivedMarkdown } from '@enterprise-blogger/shared';

describe('Reader Preview & Derived Markdown Export Suite', () => {
  it('correctly filters pending suggestions in published preview', () => {
    const docJSON = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Enterprise Architecture' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Our platform provides ' },
            {
              type: 'text',
              marks: [{ type: 'suggestion_insert', attrs: { status: 'pending' } }],
              text: 'AI-assisted ',
            },
            {
              type: 'text',
              marks: [{ type: 'suggestion_delete', attrs: { status: 'pending' } }],
              text: 'legacy ',
            },
            { type: 'text', text: 'knowledge management.' },
          ],
        },
      ],
    };

    const markdown = exportDerivedMarkdown(docJSON);

    // Assert: pending insertion 'AI-assisted ' is omitted
    expect(markdown).not.toContain('AI-assisted');

    // Assert: pending deletion 'legacy ' is preserved in reader export
    expect(markdown).toContain('legacy');

    expect(markdown).toContain('# Enterprise Architecture');
    expect(markdown).toContain('Our platform provides legacy knowledge management.');
  });
});
