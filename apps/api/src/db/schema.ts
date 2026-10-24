import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  bigint,
  integer,
  jsonb,
  inet,
  customType,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// Custom types for postgres tsvector and bytea
export const customBytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
  toDriver(val: Buffer): Buffer {
    return val;
  },
  fromDriver(val: unknown): Buffer {
    if (Buffer.isBuffer(val)) return val;
    if (typeof val === 'string') return Buffer.from(val, 'hex');
    return Buffer.from(val as any);
  },
});

export const customTsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
  toDriver(val: string): string {
    return val;
  },
  fromDriver(val: unknown): string {
    return String(val ?? '');
  },
});

// 1. Users Table
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).unique().notNull(),
    fullName: varchar('full_name', { length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }),
    role: varchar('role', { length: 20 }).notNull().$type<'admin' | 'moderator' | 'author' | 'reader'>(),
    ssoProvider: varchar('sso_provider', { length: 50 }),
    ssoSubject: varchar('sso_subject', { length: 512 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_users_email').on(table.email),
    index('idx_users_role').on(table.role),
  ]
);

// 2. Centers of Excellence Table
export const centersOfExcellence = pgTable('centers_of_excellence', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).unique().notNull(),
  code: varchar('code', { length: 50 }).unique().notNull(),
  description: text('description'),
});

// 3. Posts Table
export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 255 }).unique().notNull(),
    title: varchar('title', { length: 500 }).notNull(),
    excerpt: text('excerpt'),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('draft')
      .$type<'draft' | 'in_review' | 'approved' | 'published' | 'archived'>(),
    authorId: uuid('author_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    coeId: uuid('coe_id').references(() => centersOfExcellence.id),
    yjsState: customBytea('yjs_state').notNull(),
    workingMarkdown: text('working_markdown'),
    publishedVersionId: uuid('published_version_id'),
    publishedMarkdown: text('published_markdown'),
    searchVector: customTsvector('search_vector'),
    workingSearchVector: customTsvector('working_search_vector'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_posts_slug').on(table.slug),
    index('idx_posts_author').on(table.authorId),
    index('idx_posts_status').on(table.status),
  ]
);

// 4. Post Versions Table
export const postVersions = pgTable(
  'post_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .references(() => posts.id, { onDelete: 'cascade' })
      .notNull(),
    versionNumber: integer('version_number').notNull(),
    triggerReason: varchar('trigger_reason', { length: 30 })
      .notNull()
      .$type<'manual_save' | 'review_submission' | 'publication' | 'hourly_checkpoint'>(),
    yjsStateSnapshot: customBytea('yjs_state_snapshot').notNull(),
    markdownSnapshot: text('markdown_snapshot').notNull(),
    createdBy: uuid('created_by')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_post_versions_post_id').on(table.postId),
  ]
);

// 5. Post Collaborators Table
export const postCollaborators = pgTable(
  'post_collaborators',
  {
    postId: uuid('post_id')
      .references(() => posts.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    permission: varchar('permission', { length: 10 })
      .notNull()
      .$type<'edit' | 'review' | 'view'>(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.userId] }),
  ]
);

// 6. Post Reviews Table
export const postReviews = pgTable(
  'post_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .references(() => posts.id, { onDelete: 'cascade' })
      .notNull(),
    reviewerId: uuid('reviewer_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    decision: varchar('decision', { length: 20 })
      .notNull()
      .default('pending')
      .$type<'pending' | 'approved' | 'changes_requested'>(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_post_reviews_post_id').on(table.postId),
  ]
);

// 7. Comments Table
export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .references(() => posts.id, { onDelete: 'cascade' })
      .notNull(),
    authorId: uuid('author_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    parentId: uuid('parent_id'),
    content: text('content').notNull(),
    yjsAnchorStart: jsonb('yjs_anchor_start'),
    yjsAnchorEnd: jsonb('yjs_anchor_end'),
    isReviewComment: boolean('is_review_comment').notNull().default(false),
    status: varchar('status', { length: 10 })
      .notNull()
      .default('open')
      .$type<'open' | 'resolved'>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_comments_post_id').on(table.postId),
  ]
);

// 8. Tags & Post Tags
export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).unique().notNull(),
  slug: varchar('slug', { length: 100 }).unique().notNull(),
});

export const postTags = pgTable(
  'post_tags',
  {
    postId: uuid('post_id')
      .references(() => posts.id, { onDelete: 'cascade' })
      .notNull(),
    tagId: uuid('tag_id')
      .references(() => tags.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.tagId] }),
  ]
);

// 9. Personal Access Tokens (PATs) Table
export const personalAccessTokens = pgTable(
  'personal_access_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    tokenHash: varchar('token_hash', { length: 255 }).unique().notNull(),
    scopes: jsonb('scopes').notNull().$type<string[]>(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_pat_token_hash').on(table.tokenHash),
    index('idx_pat_user_id').on(table.userId),
  ]
);

// 10. Attachments Table
export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
  storageKey: varchar('storage_key', { length: 1024 }).notNull(),
  mimeType: varchar('mime_type', { length: 255 }).notNull(),
  size: bigint('size', { mode: 'bigint' }).notNull(),
  scanStatus: varchar('scan_status', { length: 20 })
    .notNull()
    .default('clean')
    .$type<'pending' | 'clean' | 'quarantined'>(),
  uploadedBy: uuid('uploaded_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 11. Audit Logs Table (Tamper-Evident SHA-256 Chained Hash Log)
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorType: varchar('actor_type', { length: 10 })
      .notNull()
      .$type<'human' | 'agent' | 'system'>(),
    patId: uuid('pat_id').references(() => personalAccessTokens.id),
    action: varchar('action', { length: 100 }).notNull(),
    entityType: varchar('entity_type', { length: 50 }),
    entityId: uuid('entity_id'),
    metadata: jsonb('metadata'),
    ipAddress: inet('ip_address'),
    prevHash: varchar('prev_hash', { length: 64 }).notNull(),
    rowHash: varchar('row_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_audit_logs_action').on(table.action),
    index('idx_audit_logs_created_at').on(table.createdAt),
  ]
);

// 12. Post View Counts (Buffered Counter Table)
export const postViewCounts = pgTable('post_view_counts', {
  postId: uuid('post_id')
    .primaryKey()
    .references(() => posts.id, { onDelete: 'cascade' }),
  totalViews: bigint('total_views', { mode: 'bigint' }).notNull().default(0n),
  lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
});

// 13. Post Attachments Table (Strictly Out-of-Band from Document CRDT)
export const postAttachments = pgTable(
  'post_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .references(() => posts.id, { onDelete: 'cascade' })
      .notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    fileSize: integer('file_size').notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    storagePath: text('storage_path').notNull(),
    scanStatus: varchar('scan_status', { length: 20 })
      .notNull()
      .default('clean')
      .$type<'scanning' | 'clean' | 'blocked'>(),
    uploadedBy: uuid('uploaded_by')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_post_attachments_post_id').on(table.postId),
    index('idx_post_attachments_sha256').on(table.sha256),
  ]
);
