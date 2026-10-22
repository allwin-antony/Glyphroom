import { z } from 'zod';

// ==========================================
// 1. search_posts
// ==========================================
export const McpSearchPostsInputSchema = z.object({
  query: z.string().min(1, 'Search query cannot be empty'),
  tags: z.array(z.string()).optional(),
  coeId: z.string().optional(),
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
  postId: z.string().min(1, 'postId is required'),
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
  title: z.string().min(1, 'Title is required').max(500, 'Title too long'),
  content: z.string().min(1, 'Initial content is required'),
  tags: z.array(z.string()).optional(),
  coeId: z.string().optional(),
  excerpt: z.string().optional(),
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
  postId: z.string().min(1, 'postId is required'),
  heading: z.string().optional(),
  content: z.string().min(1, 'content is required'),
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
  postId: z.string().min(1, 'postId is required'),
  targetHeading: z.string().min(1, 'targetHeading is required'),
  heading: z.string().optional(),
  content: z.string().min(1, 'content is required'),
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
  postId: z.string().min(1, 'postId is required'),
  targetHeading: z.string().min(1, 'targetHeading is required'),
  newContent: z.string().min(1, 'newContent is required'),
  instruction: z.string().optional(),
});
export type McpSuggestEditSectionInput = z.infer<typeof McpSuggestEditSectionInputSchema>;

export const McpSuggestEditSectionOutputSchema = z.object({
  success: z.boolean(),
  postId: z.string(),
  operation: z.literal('suggest_edit_section'),
  appliedAt: z.number().int().positive(),
  suggestionsCount: z.number().int().nonnegative(),
  suggestionIds: z.array(z.string()),
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
  postId: z.string().min(1, 'postId is required'),
  content: z.string().min(1, 'Comment text cannot be empty'),
  parentId: z.string().optional(),
  anchorHeading: z.string().optional(),
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
  postId: z.string().min(1, 'postId is required'),
  notes: z.string().optional(),
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
