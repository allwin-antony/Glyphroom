import { describe, it, expect, beforeEach } from 'vitest';
import { createInMemoryDatabase } from './helpers/test-db.js';
import { PermissionService } from '../src/services/permissions.js';
import { users, posts, postCollaborators } from '../src/db/schema.js';
import type { Database } from '../src/db/index.js';

describe('Global RBAC & Per-Post Collaborator Permission Matrix', () => {
  let db: Database;
  let permService: PermissionService;

  beforeEach(() => {
    const mem = createInMemoryDatabase();
    db = mem.db;
    permService = new PermissionService(db);
  });

  it('grants admin unrestricted permission on any post regardless of state or authorship', async () => {
    const admin = { id: 'admin-id-1', role: 'admin' as const };

    const draftPerm = await permService.resolvePostPermission(admin, {
      postId: 'p1',
      authorId: 'other-author',
      status: 'draft',
    });
    expect(draftPerm).toBe('admin');
    expect(permService.canEdit(draftPerm)).toBe(true);
    expect(permService.canView(draftPerm)).toBe(true);
    expect(permService.canPublish(admin.role, draftPerm, false)).toBe(true);
  });

  it('grants author implicit edit permissions on their own posts', async () => {
    const author = { id: 'author-alice', role: 'author' as const };

    const ownPostPerm = await permService.resolvePostPermission(author, {
      postId: 'p-own',
      authorId: 'author-alice',
      status: 'draft',
    });
    expect(ownPostPerm).toBe('edit');
    expect(permService.canEdit(ownPostPerm)).toBe(true);
    expect(permService.canView(ownPostPerm)).toBe(true);

    // CRITICAL GOVERNANCE CHECK: Author CANNOT self-approve / review their own post!
    expect(permService.canReview(ownPostPerm, true)).toBe(false);
    expect(permService.canPublish(author.role, ownPostPerm, true)).toBe(false);
  });

  it('resolves explicit per-post collaborator permissions (edit, review, view)', async () => {
    const postContext = { postId: 'post-100', authorId: 'author-alice', status: 'draft' as const };

    const editor = { id: 'user-bob', role: 'author' as const };
    const reviewer = { id: 'user-carol', role: 'author' as const };
    const viewer = { id: 'user-dave', role: 'reader' as const };

    // Assign in post_collaborators
    await db.insert(postCollaborators).values([
      { postId: postContext.postId, userId: editor.id, permission: 'edit' },
      { postId: postContext.postId, userId: reviewer.id, permission: 'review' },
      { postId: postContext.postId, userId: viewer.id, permission: 'view' },
    ]);

    const bobPerm = await permService.resolvePostPermission(editor, postContext);
    expect(bobPerm).toBe('edit');
    expect(permService.canEdit(bobPerm)).toBe(true);

    const carolPerm = await permService.resolvePostPermission(reviewer, postContext);
    expect(carolPerm).toBe('review');
    expect(permService.canReview(carolPerm, false)).toBe(true);
    expect(permService.canEdit(carolPerm)).toBe(false);

    const davePerm = await permService.resolvePostPermission(viewer, postContext);
    expect(davePerm).toBe('view');
    expect(permService.canView(davePerm)).toBe(true);
    expect(permService.canEdit(davePerm)).toBe(false);
  });

  it('moderator can review posts in_review, but cannot access private drafts of others', async () => {
    const mod = { id: 'mod-1', role: 'moderator' as const };

    // Private draft
    const draftPerm = await permService.resolvePostPermission(mod, {
      postId: 'p-draft',
      authorId: 'author-x',
      status: 'draft',
    });
    expect(draftPerm).toBe('none');
    expect(permService.canView(draftPerm)).toBe(false);

    // In-review post
    const inReviewPerm = await permService.resolvePostPermission(mod, {
      postId: 'p-review',
      authorId: 'author-x',
      status: 'in_review',
    });
    expect(inReviewPerm).toBe('review');
    expect(permService.canReview(inReviewPerm, false)).toBe(true);
    expect(permService.canPublish(mod.role, inReviewPerm, false)).toBe(true);
  });

  it('reader can view published posts, but has zero access to drafts', async () => {
    const reader = { id: 'reader-1', role: 'reader' as const };

    const draftPerm = await permService.resolvePostPermission(reader, {
      postId: 'p-secret',
      authorId: 'author-x',
      status: 'draft',
    });
    expect(draftPerm).toBe('none');
    expect(permService.canView(draftPerm)).toBe(false);

    const publishedPerm = await permService.resolvePostPermission(reader, {
      postId: 'p-published',
      authorId: 'author-x',
      status: 'published',
    });
    expect(publishedPerm).toBe('view');
    expect(permService.canView(publishedPerm)).toBe(true);
    expect(permService.canEdit(publishedPerm)).toBe(false);
  });
});
