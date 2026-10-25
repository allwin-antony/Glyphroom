import { z } from 'zod';
import { PostIdSchema, SafeIdentifierSchema } from './gateway.js';

/**
 * Tag name schema bounded between 1 and 50 characters matching PostgreSQL tags.name varchar(50).
 */
export const TagSchema = z
  .string()
  .min(1, 'Tag cannot be empty')
  .max(50, 'Tag name cannot exceed 50 characters')
  .regex(
    /^[a-zA-Z0-9_\-\s]+$/,
    'Tag can only contain alphanumeric characters, hyphens, underscores, and spaces'
  )
  .refine((val) => !val.includes('\0'), {
    message: 'Tag cannot contain null bytes',
  });

/**
 * Bounded search query schema preventing 1MB+ DoS attacks and null bytes.
 */
export const SearchQuerySchema = z
  .string()
  .min(1, 'Search query cannot be empty')
  .max(500, 'Search query cannot exceed 500 characters')
  .refine((val) => !val.includes('\0'), {
    message: 'Search query cannot contain null bytes',
  });

// ==========================================
// 1. search_posts
// ==========================================
export const McpSearchPostsInputSchema = z.object({
  query: SearchQuerySchema,
  tags: z.array(TagSchema).max(20, 'Cannot exceed 20 tags').optional(),
  coeId: SafeIdentifierSchema.optional(),
  limit: z.number().int().min(1).max(50).default(10),
  offset: z.number().int().min(0).default(0),
});
export type McpSearchPostsInput = z.infer<typeof McpSearchPostsInputSchema>;

export const McpSearchPostsOutputSchema = z.object({
  posts: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      slug: z.string(),
      excerpt: z.string().nullable(),
      status: z.enum(['draft', 'in_review', 'approved', 'published', 'archived']),
      coeName: z.string().optional(),
      tags: z.array(z.string()),
      author: z.object({
        id: z.string(),
        name: z.string(),
      }),
      updatedAt: z.string(),
    })
  ),
  totalCount: z.number().int().nonnegative(),
});
export type McpSearchPostsOutput = z.infer<typeof McpSearchPostsOutputSchema>;

// ==========================================
// 2. get_post
// ==========================================
export const McpGetPostInputSchema = z.object({
  postId: PostIdSchema,
  format: z.enum(['markdown', 'summary', 'prosemirror_json']).default('markdown'),
  includeSuggestions: z.boolean().default(false),
});
export type McpGetPostInput = z.infer<typeof McpGetPostInputSchema>;

export const McpGetPostOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  status: z.string(),
  author: z.object({
    id: z.string(),
    name: z.string(),
  }),
  content: z.string(),
  format: z.enum(['markdown', 'summary', 'prosemirror_json']),
  headings: z.array(z.string()),
  tags: z.array(z.string()),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type McpGetPostOutput = z.infer<typeof McpGetPostOutputSchema>;

// ==========================================
// 3. create_post
// ==========================================
export const McpCreatePostInputSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500, 'Title too long').describe('Title of the document (e.g. "Platform Architecture RFC")'),
  content: z.string().min(1, 'Initial content is required').describe(
    'Initial document content in Markdown. Supports Glyphroom rich blocks:\n' +
    '- Alerts: `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`\n' +
    '- Mermaid Diagrams: ```mermaid\\ngraph TD\\n...```\n' +
    '- KaTeX Math Formulas: `$$ formula $$`\n' +
    '- Status Pulse Cards: `<!-- status-block ragStatus="green" milestoneTitle="Title" completionPercent="75" targetDate="2026-12-01" blockers="None" -->`\n' +
    '- Checklists & Tables: `- [x] Done` and Markdown tables'
  ),
  tags: z.array(TagSchema).max(20, 'Cannot exceed 20 tags').optional().describe('Keywords or tags for catalog discovery'),
  coeId: SafeIdentifierSchema.optional().describe('Center of Excellence category ID'),
  excerpt: z.string().max(2000, 'Excerpt cannot exceed 2000 characters').optional().describe('Short 1-2 sentence summary for catalog cards'),
});
export type McpCreatePostInput = z.infer<typeof McpCreatePostInputSchema>;

export const McpCreatePostOutputSchema = z.object({
  id: z.string(),
  slug: z.string(),
  status: z.literal('draft'),
  title: z.string(),
  createdAt: z.string(),
  message: z.string(),
});
export type McpCreatePostOutput = z.infer<typeof McpCreatePostOutputSchema>;

// ==========================================
// 4. append_section
// ==========================================
export const McpAppendSectionInputSchema = z.object({
  postId: PostIdSchema.describe('UUID or slug of the target document'),
  heading: z.string().max(500, 'Heading cannot exceed 500 characters').optional().describe('Section heading title (e.g. "Security & Compliance Considerations")'),
  content: z.string().min(1, 'content is required').describe(
    'Markdown content for the section. Supports full Glyphroom rich blocks:\n' +
    '- Alerts: `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`\n' +
    '- Mermaid Diagrams: ```mermaid\\ngraph TD\\n...```\n' +
    '- KaTeX Math Formulas: `$$ formula $$`\n' +
    '- Status Pulse Cards: `<!-- status-block ragStatus="green" milestoneTitle="Title" completionPercent="75" targetDate="2026-12-01" blockers="None" -->`\n' +
    '- Checklists & Tables: `- [x] Done` and Markdown tables'
  ),
});
export type McpAppendSectionInput = z.infer<typeof McpAppendSectionInputSchema>;

export const McpAppendSectionOutputSchema = z.object({
  success: z.boolean(),
  postId: z.string(),
  operation: z.literal('append_section'),
  appliedAt: z.number().int().positive(),
  message: z.string(),
});
export type McpAppendSectionOutput = z.infer<typeof McpAppendSectionOutputSchema>;

// ==========================================
// 5. insert_after_section
// ==========================================
export const McpInsertAfterSectionInputSchema = z.object({
  postId: PostIdSchema.describe('UUID or slug of the target document'),
  targetHeading: z.string().min(1, 'targetHeading is required').max(500).describe('Exact or normalized heading of the existing section after which to insert'),
  heading: z.string().max(500, 'Heading cannot exceed 500 characters').optional().describe('New section heading to insert'),
  content: z.string().min(1, 'content is required').describe(
    'Markdown content for the inserted section. Supports Glyphroom rich blocks (Alerts, Mermaid, Math, Status Cards, Tables).'
  ),
});
export type McpInsertAfterSectionInput = z.infer<typeof McpInsertAfterSectionInputSchema>;

export const McpInsertAfterSectionOutputSchema = z.object({
  success: z.boolean(),
  postId: z.string(),
  operation: z.literal('insert_after_section'),
  appliedAt: z.number().int().positive(),
  message: z.string(),
});
export type McpInsertAfterSectionOutput = z.infer<typeof McpInsertAfterSectionOutputSchema>;

// ==========================================
// 6. suggest_edit_section
// ==========================================
export const McpSuggestEditSectionInputSchema = z.object({
  postId: PostIdSchema.describe('UUID or slug of the target document'),
  targetHeading: z.string().min(1, 'targetHeading is required').max(500).describe('Heading of the section you want to propose edits for'),
  newContent: z.string().min(1, 'newContent is required').describe(
    'Proposed revised Markdown content for the section. The system calculates a diff and attaches suggestion marks without overwriting existing human text.'
  ),
  instruction: z.string().max(2000, 'Instruction cannot exceed 2000 characters').optional().describe('Reason or explanation for the editorial suggestion (e.g. "Clarify Redis cluster failover")'),
});
export type McpSuggestEditSectionInput = z.infer<typeof McpSuggestEditSectionInputSchema>;

export const McpSuggestEditSectionOutputSchema = z.object({
  success: z.boolean(),
  postId: z.string(),
  operation: z.literal('suggest_edit_section'),
  appliedAt: z.number().int().positive(),
  suggestionsCount: z.number().int().nonnegative(),
  suggestionIds: z.array(SafeIdentifierSchema),
  changesSummary: z.object({
    insertions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    hunksApplied: z.number().int().nonnegative(),
  }),
  message: z.string(),
});
export type McpSuggestEditSectionOutput = z.infer<typeof McpSuggestEditSectionOutputSchema>;

// ==========================================
// 7. add_comment
// ==========================================
export const McpAddCommentInputSchema = z.object({
  postId: PostIdSchema,
  content: z.string().min(1, 'Comment text cannot be empty').max(10000),
  parentId: SafeIdentifierSchema.optional(),
  anchorHeading: z.string().max(500).optional(),
});
export type McpAddCommentInput = z.infer<typeof McpAddCommentInputSchema>;

export const McpAddCommentOutputSchema = z.object({
  commentId: z.string(),
  postId: z.string(),
  authorId: z.string(),
  createdAt: z.string(),
  status: z.literal('open'),
});
export type McpAddCommentOutput = z.infer<typeof McpAddCommentOutputSchema>;

// ==========================================
// 8. publish_post
// ==========================================
export const McpPublishPostInputSchema = z.object({
  postId: PostIdSchema,
  notes: z.string().max(2000).optional(),
});
export type McpPublishPostInput = z.infer<typeof McpPublishPostInputSchema>;

export const McpPublishPostOutputSchema = z.object({
  success: z.boolean(),
  postId: z.string(),
  status: z.enum(['in_review', 'published']),
  reviewId: z.string().optional(),
  message: z.string(),
});
export type McpPublishPostOutput = z.infer<typeof McpPublishPostOutputSchema>;
