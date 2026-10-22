import { describe, it, expect } from 'vitest';
import { Schema } from 'prosemirror-model';
import {
  AgentGatewayEditRequestSchema,
  AgentGatewayEditResponseSchema,
  AgentGatewayErrorResponseSchema,
  AgentGatewayHeadersSchema,
  McpSearchPostsInputSchema,
  McpSearchPostsOutputSchema,
  McpGetPostInputSchema,
  McpCreatePostInputSchema,
  McpAppendSectionInputSchema,
  McpInsertAfterSectionInputSchema,
  McpSuggestEditSectionInputSchema,
  McpAddCommentInputSchema,
  McpPublishPostInputSchema,
  SuggestionStatusSchema,
  SuggestionInsertAttrsSchema,
  SuggestionDeleteAttrsSchema,
  AttributionAttrsSchema,
  ResolveSuggestionPayloadSchema,
  safeValidate,
  validateOrThrow,
} from '../src/validation/index.js';
import { blogNodes } from '../src/schema/nodes/index.js';
import {
  allMarks,
  MARK_SUGGESTION_INSERT,
  MARK_SUGGESTION_DELETE,
} from '../src/schema/marks/index.js';
import { exportDerivedMarkdown } from '../src/export/markdown.js';

describe('Adversarial Fuzzing & Stress Testing Suite', () => {
  const schema = new Schema({ nodes: blogNodes, marks: allMarks });

  // =========================================================================
  // TASK 1: Zod Contracts Empirical Fuzzing
  // =========================================================================

  describe('1. AgentGatewayEditRequestSchema Fuzzing', () => {
    describe('1.1 Unknown and Malformed Operations in Discriminated Union', () => {
      const invalidOperations = [
        'delete_post',
        'drop_database',
        'update_schema',
        '__proto__',
        'constructor',
        'valueOf',
        '',
        null,
        undefined,
        12345,
        true,
        false,
        {},
        [],
      ];

      it.each(invalidOperations)('rejects unknown operation: %s', (op) => {
        const payload = {
          operation: op,
          documentId: 'doc-123',
          content: 'Some sample content',
        };
        const result = safeValidate(AgentGatewayEditRequestSchema, payload);
        expect(result.success).toBe(false);
      });
    });

    describe('1.2 Missing Required Fields Across Discriminated Union Variants', () => {
      it('rejects append_section when missing documentId', () => {
        const result = safeValidate(AgentGatewayEditRequestSchema, {
          operation: 'append_section',
          content: 'Valid content',
        });
        expect(result.success).toBe(false);
      });

      it('rejects append_section when missing content', () => {
        const result = safeValidate(AgentGatewayEditRequestSchema, {
          operation: 'append_section',
          documentId: 'doc-123',
        });
        expect(result.success).toBe(false);
      });

      it('rejects insert_after_section when missing targetHeading', () => {
        const result = safeValidate(AgentGatewayEditRequestSchema, {
          operation: 'insert_after_section',
          documentId: 'doc-123',
          content: 'Valid content',
        });
        expect(result.success).toBe(false);
      });

      it('rejects suggest_edit_section when missing targetHeading', () => {
        const result = safeValidate(AgentGatewayEditRequestSchema, {
          operation: 'suggest_edit_section',
          documentId: 'doc-123',
          content: 'Valid content',
        });
        expect(result.success).toBe(false);
      });

      it('rejects completely empty object payload', () => {
        const result = safeValidate(AgentGatewayEditRequestSchema, {});
        expect(result.success).toBe(false);
      });

      it('rejects null or non-object payloads', () => {
        expect(safeValidate(AgentGatewayEditRequestSchema, null).success).toBe(false);
        expect(safeValidate(AgentGatewayEditRequestSchema, undefined).success).toBe(false);
        expect(safeValidate(AgentGatewayEditRequestSchema, 'string').success).toBe(false);
        expect(safeValidate(AgentGatewayEditRequestSchema, 42).success).toBe(false);
      });
    });

    describe('1.3 Type Mismatches in Discriminator and Fields', () => {
      it('rejects non-string documentId', () => {
        const mismatches = [123, true, {}, [], Symbol('id')];
        for (const badDocId of mismatches) {
          const res = safeValidate(AgentGatewayEditRequestSchema, {
            operation: 'append_section',
            documentId: badDocId,
            content: 'Hello',
          });
          expect(res.success).toBe(false);
        }
      });

      it('rejects non-string content', () => {
        const mismatches = [123, true, { text: 'content' }, ['content']];
        for (const badContent of mismatches) {
          const res = safeValidate(AgentGatewayEditRequestSchema, {
            operation: 'append_section',
            documentId: 'doc-1',
            content: badContent,
          });
          expect(res.success).toBe(false);
        }
      });

      it('rejects non-string targetHeading in insert_after_section', () => {
        const res = safeValidate(AgentGatewayEditRequestSchema, {
          operation: 'insert_after_section',
          documentId: 'doc-1',
          targetHeading: 12345,
          content: 'Valid content',
        });
        expect(res.success).toBe(false);
      });

      it('rejects non-string heading in append_section', () => {
        const res = safeValidate(AgentGatewayEditRequestSchema, {
          operation: 'append_section',
          documentId: 'doc-1',
          heading: { title: 'Heading' },
          content: 'Valid content',
        });
        expect(res.success).toBe(false);
      });
    });

    describe('1.4 Path Injection and Traversal Strings in documentId', () => {
      const injectionStrings = [
        '../../../../etc/passwd',
        '..\\..\\Windows\\System32\\cmd.exe',
        '/var/log/../../../etc/shadow',
        'post-1\0.json',
        'C:\\secret\\doc',
        '..%2f..%2f..%2fetc%2fpasswd',
        'post/../../../../root',
        '<script>alert("xss")</script>',
        "' OR '1'='1",
      ];

      it.each(injectionStrings)(
        'rejects path injection documentId with descriptive error: %s',
        (injection) => {
          const payload = {
            operation: 'append_section',
            documentId: injection,
            content: 'Valid content payload',
          };
          const result = safeValidate(AgentGatewayEditRequestSchema, payload);
          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.formattedError).toContain('documentId');
            expect(result.error.issues.some((i) => i.path.includes('documentId'))).toBe(true);
          }
        }
      );
    });

    describe('1.5 Agent Gateway Headers Schema', () => {
      it('rejects missing x-internal-service-key or empty header', () => {
        expect(
          safeValidate(AgentGatewayHeadersSchema, {
            'x-user-id': 'u1',
            'x-agent-id': 'a1',
          }).success
        ).toBe(false);

        expect(
          safeValidate(AgentGatewayHeadersSchema, {
            'x-internal-service-key': '',
            'x-user-id': 'u1',
            'x-agent-id': 'a1',
          }).success
        ).toBe(false);
      });

      it('accepts X-Gateway-Secret header matching PROJECT.md specification', () => {
        const res = safeValidate(AgentGatewayHeadersSchema, {
          'X-Gateway-Secret': 'secret-key-project-spec',
          'X-User-Id': 'u1',
          'X-Agent-Id': 'a1',
        });
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data['x-internal-service-key']).toBe('secret-key-project-spec');
        }
      });
    });
  });

  // =========================================================================
  // TASK 1.2: MCP Tool Schemas Fuzzing
  // =========================================================================

  describe('2. MCP Tool Schemas Fuzzing', () => {
    describe('2.1 McpSearchPostsInputSchema: Extreme Values & Negative Numbers', () => {
      it('rejects negative limit', () => {
        const res = safeValidate(McpSearchPostsInputSchema, {
          query: 'test',
          limit: -1,
        });
        expect(res.success).toBe(false);
      });

      it('rejects limit of 0', () => {
        const res = safeValidate(McpSearchPostsInputSchema, {
          query: 'test',
          limit: 0,
        });
        expect(res.success).toBe(false);
      });

      it('rejects limit exceeding maximum 50', () => {
        const res = safeValidate(McpSearchPostsInputSchema, {
          query: 'test',
          limit: 51,
        });
        expect(res.success).toBe(false);
      });

      it('rejects extreme large limit numbers', () => {
        const res = safeValidate(McpSearchPostsInputSchema, {
          query: 'test',
          limit: 1000000000,
        });
        expect(res.success).toBe(false);
      });

      it('rejects float / non-integer limit', () => {
        const res = safeValidate(McpSearchPostsInputSchema, {
          query: 'test',
          limit: 10.5,
        });
        expect(res.success).toBe(false);
      });

      it('rejects negative offset', () => {
        const res = safeValidate(McpSearchPostsInputSchema, {
          query: 'test',
          offset: -1,
        });
        expect(res.success).toBe(false);
      });

      it('rejects empty query string', () => {
        const res = safeValidate(McpSearchPostsInputSchema, {
          query: '',
        });
        expect(res.success).toBe(false);
      });

      it('rejects null bytes in query string', () => {
        const res = safeValidate(McpSearchPostsInputSchema, {
          query: 'search\0term\0null',
        });
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.formattedError).toContain('null');
        }
      });

      it('rejects oversized search query string exceeding 500 characters', () => {
        const oversized = 'A'.repeat(501);
        const res = safeValidate(McpSearchPostsInputSchema, {
          query: oversized,
        });
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.formattedError).toContain('query');
        }
      });

      it('accepts search query string at exact boundary of 500 characters', () => {
        const atBoundary = 'A'.repeat(500);
        const res = safeValidate(McpSearchPostsInputSchema, {
          query: atBoundary,
        });
        expect(res.success).toBe(true);
      });
    });

    describe('2.1.1 McpSearchPostsInputSchema: Tag Attack Surface', () => {
      it('rejects tag array exceeding maximum limit of 20 tags', () => {
        const tooManyTags = Array.from({ length: 21 }, (_, i) => `tag-${i}`);
        const res = safeValidate(McpSearchPostsInputSchema, {
          query: 'valid query',
          tags: tooManyTags,
        });
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.formattedError).toContain('tags');
        }
      });

      it('rejects individual tag exceeding maximum length of 50 characters', () => {
        const res = safeValidate(McpSearchPostsInputSchema, {
          query: 'valid query',
          tags: ['valid-tag', 'T'.repeat(51)],
        });
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.formattedError).toContain('tags');
        }
      });

      it('rejects tags containing path traversal or null bytes', () => {
        const maliciousTags = ['../../traversal', 'tag\0poison', '<script>', 'tag/slash'];
        for (const badTag of maliciousTags) {
          const res = safeValidate(McpSearchPostsInputSchema, {
            query: 'valid query',
            tags: [badTag],
          });
          expect(res.success).toBe(false);
        }
      });
    });

    describe('2.2 McpCreatePostInputSchema: Extreme & Oversized Strings', () => {
      it('rejects empty title', () => {
        const res = safeValidate(McpCreatePostInputSchema, {
          title: '',
          content: 'Valid content',
        });
        expect(res.success).toBe(false);
      });

      it('accepts title at exact boundary 500 characters', () => {
        const res = safeValidate(McpCreatePostInputSchema, {
          title: 'T'.repeat(500),
          content: 'Valid content',
        });
        expect(res.success).toBe(true);
      });

      it('rejects title exceeding 500 characters (501)', () => {
        const res = safeValidate(McpCreatePostInputSchema, {
          title: 'T'.repeat(501),
          content: 'Valid content',
        });
        expect(res.success).toBe(false);
      });

      it('rejects empty content', () => {
        const res = safeValidate(McpCreatePostInputSchema, {
          title: 'Valid title',
          content: '',
        });
        expect(res.success).toBe(false);
      });

      it('accepts title with null bytes if within length', () => {
        const res = safeValidate(McpCreatePostInputSchema, {
          title: 'Title\0Null',
          content: 'Valid content',
        });
        expect(res.success).toBe(true);
      });
    });

    describe('2.2.1 McpCreatePostInputSchema: Tag Attack Surface', () => {
      it('rejects tag array exceeding maximum limit of 20 tags in create_post', () => {
        const tooManyTags = Array.from({ length: 21 }, (_, i) => `tag-${i}`);
        const res = safeValidate(McpCreatePostInputSchema, {
          title: 'Valid title',
          content: 'Valid content',
          tags: tooManyTags,
        });
        expect(res.success).toBe(false);
      });

      it('rejects individual tag exceeding 50 characters in create_post', () => {
        const res = safeValidate(McpCreatePostInputSchema, {
          title: 'Valid title',
          content: 'Valid content',
          tags: ['A'.repeat(51)],
        });
        expect(res.success).toBe(false);
      });
    });

    describe('2.3 McpSuggestEditSectionInputSchema: Boundary Checks', () => {
      it('rejects empty postId, targetHeading, or newContent', () => {
        expect(
          safeValidate(McpSuggestEditSectionInputSchema, {
            postId: '',
            targetHeading: 'H',
            newContent: 'C',
          }).success
        ).toBe(false);

        expect(
          safeValidate(McpSuggestEditSectionInputSchema, {
            postId: 'p1',
            targetHeading: '',
            newContent: 'C',
          }).success
        ).toBe(false);

        expect(
          safeValidate(McpSuggestEditSectionInputSchema, {
            postId: 'p1',
            targetHeading: 'H',
            newContent: '',
          }).success
        ).toBe(false);
      });
    });

    describe('2.4 Output Schemas: Negative Integers and Count Bounds', () => {
      it('rejects negative numbers in AgentGatewayEditResponse changesSummary', () => {
        const badPayload = {
          success: true,
          operation: 'append_section',
          documentId: 'doc-1',
          appliedAt: 1729600000000,
          changesSummary: {
            insertions: -5,
            deletions: 0,
          },
        };
        expect(safeValidate(AgentGatewayEditResponseSchema, badPayload).success).toBe(false);
      });

      it('rejects negative or non-positive appliedAt timestamp', () => {
        const badPayload = {
          success: true,
          operation: 'append_section',
          documentId: 'doc-1',
          appliedAt: -1,
          changesSummary: {
            insertions: 1,
            deletions: 0,
          },
        };
        expect(safeValidate(AgentGatewayEditResponseSchema, badPayload).success).toBe(false);
      });
    });
  });

  // =========================================================================
  // TASK 1.3: Suggestion Metadata Schemas Fuzzing
  // =========================================================================

  describe('3. Suggestion Metadata Schemas Fuzzing', () => {
    describe('3.1 Invalid Status Enums', () => {
      const invalidStatuses = [
        'invalid_status',
        'in_review',
        'approved',
        'draft',
        'archived',
        'PENDING',
        'ACCEPTED',
        '',
        null,
        123,
      ];

      it.each(invalidStatuses)('rejects invalid SuggestionStatusSchema value: %s', (status) => {
        const res = safeValidate(SuggestionStatusSchema, status);
        expect(res.success).toBe(false);
      });

      it.each(invalidStatuses)('rejects invalid status in SuggestionInsertAttrs: %s', (status) => {
        const res = safeValidate(SuggestionInsertAttrsSchema, {
          agentId: 'a1',
          tokenId: 't1',
          ownerUserId: 'u1',
          timestamp: 1729600000000,
          status,
        });
        expect(res.success).toBe(false);
      });

      it.each(invalidStatuses)('rejects invalid status in SuggestionDeleteAttrs: %s', (status) => {
        const res = safeValidate(SuggestionDeleteAttrsSchema, {
          agentId: 'a1',
          tokenId: 't1',
          ownerUserId: 'u1',
          timestamp: 1729600000000,
          status,
        });
        expect(res.success).toBe(false);
      });

      it('defaults undefined status to pending in SuggestionInsertAttrs and SuggestionDeleteAttrs', () => {
        const insertAttrs = validateOrThrow(SuggestionInsertAttrsSchema, {
          agentId: 'a1',
          tokenId: 't1',
          ownerUserId: 'u1',
          timestamp: 1729600000000,
        });
        expect(insertAttrs.status).toBe('pending');

        const deleteAttrs = validateOrThrow(SuggestionDeleteAttrsSchema, {
          agentId: 'a1',
          tokenId: 't1',
          ownerUserId: 'u1',
          timestamp: 1729600000000,
        });
        expect(deleteAttrs.status).toBe('pending');
      });
    });

    describe('3.2 Malformed and Extreme Timestamps', () => {
      const malformedTimestamps = [
        -1,
        0,
        -1729600000000,
        1.5,
        1729600000000.8,
        NaN,
        Infinity,
        -Infinity,
        '2026-10-22T16:00:00Z',
        '1729600000000',
        null,
        undefined,
        {},
      ];

      it.each(malformedTimestamps)(
        'rejects malformed timestamp in SuggestionInsertAttrsSchema: %s',
        (ts) => {
          const res = safeValidate(SuggestionInsertAttrsSchema, {
            agentId: 'a1',
            tokenId: 't1',
            ownerUserId: 'u1',
            timestamp: ts,
          });
          expect(res.success).toBe(false);
        }
      );

      it.each(malformedTimestamps)(
        'rejects malformed timestamp in SuggestionDeleteAttrsSchema: %s',
        (ts) => {
          const res = safeValidate(SuggestionDeleteAttrsSchema, {
            agentId: 'a1',
            tokenId: 't1',
            ownerUserId: 'u1',
            timestamp: ts,
          });
          expect(res.success).toBe(false);
        }
      );
    });

    describe('3.3 ResolveSuggestionPayloadSchema Fuzzing', () => {
      it('rejects unsupported actions in ResolveSuggestionPayloadSchema', () => {
        const badActions = ['delete', 'archive', 'cancel', 'dismiss', '', 123];
        for (const act of badActions) {
          const res = safeValidate(ResolveSuggestionPayloadSchema, {
            suggestionId: 'sug-1',
            action: act,
            resolvedByUserId: 'u-1',
          });
          expect(res.success).toBe(false);
        }
      });

      it('rejects empty suggestionId or resolvedByUserId', () => {
        expect(
          safeValidate(ResolveSuggestionPayloadSchema, {
            suggestionId: '',
            action: 'accept',
            resolvedByUserId: 'u-1',
          }).success
        ).toBe(false);

        expect(
          safeValidate(ResolveSuggestionPayloadSchema, {
            suggestionId: 'sug-1',
            action: 'accept',
            resolvedByUserId: '',
          }).success
        ).toBe(false);
      });

      it('rejects negative or malformed resolvedAt', () => {
        expect(
          safeValidate(ResolveSuggestionPayloadSchema, {
            suggestionId: 'sug-1',
            action: 'accept',
            resolvedByUserId: 'u-1',
            resolvedAt: -100,
          }).success
        ).toBe(false);

        expect(
          safeValidate(ResolveSuggestionPayloadSchema, {
            suggestionId: 'sug-1',
            action: 'accept',
            resolvedByUserId: 'u-1',
            resolvedAt: 'not-a-timestamp',
          }).success
        ).toBe(false);
      });
    });
  });

  // =========================================================================
  // TASK 2: Adversarial exportDerivedMarkdown Testing
  // =========================================================================

  describe('4. Adversarial exportDerivedMarkdown Testing', () => {
    const makeInsertMark = (status: 'pending' | 'accepted' | 'rejected') =>
      schema.mark(MARK_SUGGESTION_INSERT, {
        agentId: 'agent-adv',
        tokenId: 'tok-adv',
        ownerUserId: 'user-adv',
        timestamp: 1729600000000,
        status,
      });

    const makeDeleteMark = (status: 'pending' | 'accepted' | 'rejected') =>
      schema.mark(MARK_SUGGESTION_DELETE, {
        agentId: 'agent-adv',
        tokenId: 'tok-adv',
        ownerUserId: 'user-adv',
        timestamp: 1729600000000,
        status,
      });

    // -----------------------------------------------------------------------
    // 2.1 Interleaved pending insertions and pending deletions in the same paragraph
    // -----------------------------------------------------------------------
    it('handles interleaved pending insertions and pending deletions in the same paragraph', () => {
      const pendingInsert = makeInsertMark('pending');
      const pendingDelete = makeDeleteMark('pending');

      // Paragraph model:
      // "The " + [DEL: "quick "] + [INS: "rapid "] + [DEL: "brown "] + [INS: "auburn "] + "fox"
      const doc = schema.nodes.doc.create({}, [
        schema.nodes.paragraph.create({}, [
          schema.text('The '),
          schema.text('quick ', [pendingDelete]),
          schema.text('rapid ', [pendingInsert]),
          schema.text('brown ', [pendingDelete]),
          schema.text('auburn ', [pendingInsert]),
          schema.text('fox'),
        ]),
      ]);

      const markdown = exportDerivedMarkdown(doc);

      // Pending insertions MUST be stripped completely: "rapid " and "auburn " gone
      expect(markdown).not.toContain('rapid');
      expect(markdown).not.toContain('auburn');

      // Pending deletions MUST be retained as original text: "quick " and "brown " retained
      expect(markdown).toContain('quick');
      expect(markdown).toContain('brown');

      // Complete expected string
      expect(markdown).toBe('The quick brown fox');
    });

    it('handles tight interleaving without whitespace boundaries', () => {
      const pendingInsert = makeInsertMark('pending');
      const pendingDelete = makeDeleteMark('pending');

      // "anti" + [DEL: "gravity"] + [INS: "matter"] + "!"
      const doc = schema.nodes.doc.create({}, [
        schema.nodes.paragraph.create({}, [
          schema.text('anti'),
          schema.text('gravity', [pendingDelete]),
          schema.text('matter', [pendingInsert]),
          schema.text('!'),
        ]),
      ]);

      const markdown = exportDerivedMarkdown(doc);
      expect(markdown).toBe('antigravity!');
    });

    // -----------------------------------------------------------------------
    // 2.2 Document consisting exclusively of pending insertions
    // -----------------------------------------------------------------------
    describe('2.2 Document Consisting Exclusively of Pending Insertions', () => {
      it('exports single paragraph of pending insertions as empty string and does not crash', () => {
        const pendingInsert = makeInsertMark('pending');

        const doc = schema.nodes.doc.create({}, [
          schema.nodes.paragraph.create({}, [
            schema.text('Brand new pending sentence 1. ', [pendingInsert]),
            schema.text('Brand new pending sentence 2.', [pendingInsert]),
          ]),
        ]);

        let markdown: string | undefined;
        expect(() => {
          markdown = exportDerivedMarkdown(doc);
        }).not.toThrow();

        expect(markdown).toBe('');
      });

      it('exports multiple paragraphs of pending insertions as empty string and does not crash', () => {
        const pendingInsert = makeInsertMark('pending');

        const doc = schema.nodes.doc.create({}, [
          schema.nodes.paragraph.create({}, [
            schema.text('Paragraph 1 completely pending.', [pendingInsert]),
          ]),
          schema.nodes.paragraph.create({}, [
            schema.text('Paragraph 2 completely pending.', [pendingInsert]),
          ]),
        ]);

        let markdown: string | undefined;
        expect(() => {
          markdown = exportDerivedMarkdown(doc);
        }).not.toThrow();

        expect(markdown).toBe('');
      });

      it('exports heading + paragraph of pending insertions as clean empty string without crashing', () => {
        const pendingInsert = makeInsertMark('pending');

        const doc = schema.nodes.doc.create({}, [
          schema.nodes.heading.create({ level: 1 }, [
            schema.text('Pending Heading', [pendingInsert]),
          ]),
          schema.nodes.paragraph.create({}, [
            schema.text('Pending Body', [pendingInsert]),
          ]),
        ]);

        let markdown: string | undefined;
        expect(() => {
          markdown = exportDerivedMarkdown(doc);
        }).not.toThrow();

        expect(markdown).toBe('');
      });

      it('exports blockquote consisting of pending insertions as clean empty string without crashing', () => {
        const pendingInsert = makeInsertMark('pending');

        const doc = schema.nodes.doc.create({}, [
          schema.nodes.blockquote.create({}, [
            schema.nodes.paragraph.create({}, [
              schema.text('Pending Quote Content', [pendingInsert]),
            ]),
          ]),
        ]);

        const markdown = exportDerivedMarkdown(doc);
        expect(markdown).toBe('');
      });

      it('exports bullet_list consisting of pending insertions as clean empty string without crashing', () => {
        const pendingInsert = makeInsertMark('pending');

        const doc = schema.nodes.doc.create({}, [
          schema.nodes.bullet_list.create({}, [
            schema.nodes.list_item.create({}, [
              schema.nodes.paragraph.create({}, [
                schema.text('Pending List Item', [pendingInsert]),
              ]),
            ]),
          ]),
        ]);

        const markdown = exportDerivedMarkdown(doc);
        expect(markdown).toBe('');
      });

      it('exports ordered_list consisting of pending insertions as clean empty string without crashing', () => {
        const pendingInsert = makeInsertMark('pending');

        const doc = schema.nodes.doc.create({}, [
          schema.nodes.ordered_list.create({ order: 1 }, [
            schema.nodes.list_item.create({}, [
              schema.nodes.paragraph.create({}, [
                schema.text('Pending Ordered List Item', [pendingInsert]),
              ]),
            ]),
          ]),
        ]);

        const markdown = exportDerivedMarkdown(doc);
        expect(markdown).toBe('');
      });

      it('handles JSON AST input consisting exclusively of pending insertions without crashing', () => {
        const jsonAST = {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Pending insertion via JSON AST',
                  marks: [
                    {
                      type: MARK_SUGGESTION_INSERT,
                      attrs: {
                        agentId: 'a1',
                        tokenId: 't1',
                        ownerUserId: 'u1',
                        timestamp: 1729600000000,
                        status: 'pending',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        };

        let markdown: string | undefined;
        expect(() => {
          markdown = exportDerivedMarkdown(jsonAST as any);
        }).not.toThrow();

        expect(markdown).toBe('');
      });
    });

    // -----------------------------------------------------------------------
    // 2.3 Document consisting of accepted deletions and pending insertions
    // -----------------------------------------------------------------------
    describe('2.3 Document Consisting of Accepted Deletions and Pending Insertions', () => {
      it('exports document with only accepted deletions and pending insertions as empty string without crashing', () => {
        const acceptedDelete = makeDeleteMark('accepted');
        const pendingInsert = makeInsertMark('pending');

        const doc = schema.nodes.doc.create({}, [
          schema.nodes.paragraph.create({}, [
            schema.text('Accepted deletion: this text is gone. ', [acceptedDelete]),
            schema.text('Pending insertion: this text is unreviewed.', [pendingInsert]),
          ]),
        ]);

        let markdown: string | undefined;
        expect(() => {
          markdown = exportDerivedMarkdown(doc);
        }).not.toThrow();

        expect(markdown).toBe('');
      });

      it('handles mixed document with human text, accepted deletion, and pending insertion', () => {
        const acceptedDelete = makeDeleteMark('accepted');
        const pendingInsert = makeInsertMark('pending');

        const doc = schema.nodes.doc.create({}, [
          schema.nodes.paragraph.create({}, [
            schema.text('Start. '),
            schema.text('Accepted deletion to remove. ', [acceptedDelete]),
            schema.text('Pending addition to drop. ', [pendingInsert]),
            schema.text('Finish.'),
          ]),
        ]);

        const markdown = exportDerivedMarkdown(doc);
        expect(markdown).toBe('Start. Finish.');
        expect(markdown).not.toContain('Accepted deletion');
        expect(markdown).not.toContain('Pending addition');
      });

      it('handles multi-paragraph document where one paragraph is all accepted deletions and another is all pending insertions', () => {
        const acceptedDelete = makeDeleteMark('accepted');
        const pendingInsert = makeInsertMark('pending');

        const doc = schema.nodes.doc.create({}, [
          schema.nodes.paragraph.create({}, [
            schema.text('Entire paragraph accepted delete.', [acceptedDelete]),
          ]),
          schema.nodes.paragraph.create({}, [
            schema.text('Entire paragraph pending insert.', [pendingInsert]),
          ]),
        ]);

        const markdown = exportDerivedMarkdown(doc);
        expect(markdown).toBe('');
      });
    });

    // -----------------------------------------------------------------------
    // 2.4 Complex Combinations & Boundary Cases
    // -----------------------------------------------------------------------
    describe('2.4 Complex Combinations and Boundary Cases', () => {
      it('handles accepted insertions alongside pending deletions and accepted deletions', () => {
        const acceptedInsert = makeInsertMark('accepted');
        const pendingDelete = makeDeleteMark('pending');
        const acceptedDelete = makeDeleteMark('accepted');
        const pendingInsert = makeInsertMark('pending');

        const doc = schema.nodes.doc.create({}, [
          schema.nodes.paragraph.create({}, [
            schema.text('Original '),
            schema.text('[PendingDel: keep] ', [pendingDelete]),
            schema.text('[AcceptedDel: drop] ', [acceptedDelete]),
            schema.text('[AcceptedIns: keep] ', [acceptedInsert]),
            schema.text('[PendingIns: drop] ', [pendingInsert]),
            schema.text('Final.'),
          ]),
        ]);

        const markdown = exportDerivedMarkdown(doc);
        expect(markdown).toBe('Original [PendingDel: keep] [AcceptedIns: keep] Final.');
      });

      it('handles formatted marks inside pending deletion (strong, em)', () => {
        const pendingDelete = makeDeleteMark('pending');
        const strongMark = schema.mark('strong');

        const doc = schema.nodes.doc.create({}, [
          schema.nodes.paragraph.create({}, [
            schema.text('Pre '),
            schema.text('bold deleted text', [pendingDelete, strongMark]),
            schema.text(' Post'),
          ]),
        ]);

        const markdown = exportDerivedMarkdown(doc);
        // Formatted mark applied to retained pending deletion text
        expect(markdown).toBe('Pre **bold deleted text** Post');
      });

      it('handles completely empty document', () => {
        const doc = schema.nodes.doc.create({}, []);
        expect(exportDerivedMarkdown(doc)).toBe('');
      });

      it('handles document with empty paragraph', () => {
        const doc = schema.nodes.doc.create({}, [schema.nodes.paragraph.create({}, [])]);
        expect(exportDerivedMarkdown(doc)).toBe('');
      });

      it('completely strips math_inline with pending suggestion_insert from exported markdown', () => {
        const pendingInsert = makeInsertMark('pending');
        const doc = schema.nodes.doc.create({}, [
          schema.nodes.paragraph.create({}, [
            schema.text('Formula: '),
            schema.nodes.math_inline.create({ tex: 'E=mc^2' }, null, [pendingInsert]),
          ]),
        ]);
        const markdown = exportDerivedMarkdown(doc);
        expect(markdown).not.toContain('E=mc^2');
        expect(markdown).not.toContain('$E=mc^2$');
        expect(markdown).toBe('Formula: ');
      });

      it('retains math_inline with pending suggestion_delete in exported markdown', () => {
        const pendingDelete = makeDeleteMark('pending');
        const doc = schema.nodes.doc.create({}, [
          schema.nodes.paragraph.create({}, [
            schema.text('Preserved formula: '),
            schema.nodes.math_inline.create({ tex: 'a^2 + b^2 = c^2' }, null, [pendingDelete]),
          ]),
        ]);
        const markdown = exportDerivedMarkdown(doc);
        expect(markdown).toContain('$a^2 + b^2 = c^2$');
        expect(markdown).toBe('Preserved formula: $a^2 + b^2 = c^2$');
      });
    });
  });
});
