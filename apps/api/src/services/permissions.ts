import { eq, and } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { posts, postCollaborators, type users } from '../db/schema.js';

export type UserRole = 'admin' | 'moderator' | 'author' | 'reader';
export type PostPermission = 'admin' | 'edit' | 'review' | 'view' | 'none';

export interface PostPermissionContext {
  postId: string;
  authorId: string;
  status: 'draft' | 'in_review' | 'approved' | 'published' | 'archived';
}

export class PermissionService {
  constructor(private readonly db: Database) {}

  /**
   * Resolve effective permission for a user on a specific post
   */
  async resolvePostPermission(
    user: { id: string; role: UserRole },
    postContext: PostPermissionContext
  ): Promise<PostPermission> {
    // 1. Admin has total access
    if (user.role === 'admin') {
      return 'admin';
    }

    // 2. Post Author has implicit edit rights
    if (user.id === postContext.authorId) {
      return 'edit';
    }

    // 3. Explicitly assigned collaborator permission
    const [collab] = await this.db
      .select({ permission: postCollaborators.permission })
      .from(postCollaborators)
      .where(
        and(
          eq(postCollaborators.postId, postContext.postId),
          eq(postCollaborators.userId, user.id)
        )
      )
      .limit(1);

    if (collab) {
      return collab.permission;
    }

    // 4. Moderator role handling
    if (user.role === 'moderator') {
      if (postContext.status === 'in_review' || postContext.status === 'approved') {
        return 'review';
      }
      if (postContext.status === 'published') {
        return 'view';
      }
      // Drafts without explicit collaboration are private
      return 'none';
    }

    // 5. Published posts are viewable by any active user
    if (postContext.status === 'published') {
      return 'view';
    }

    // 6. Otherwise no permission
    return 'none';
  }

  /**
   * Check if permission allows editing the document content
   */
  canEdit(permission: PostPermission): boolean {
    return permission === 'admin' || permission === 'edit';
  }

  /**
   * Check if permission allows reviewing/approving the document
   * Strict constraint from docs/DATA_MODEL.md: Author cannot review their own post!
   */
  canReview(permission: PostPermission, isAuthor: boolean): boolean {
    if (isAuthor) return false;
    return permission === 'admin' || permission === 'review';
  }

  /**
   * Check if permission allows viewing the document
   */
  canView(permission: PostPermission): boolean {
    return permission !== 'none';
  }

  /**
   * Check if user can publish the post
   */
  canPublish(userRole: UserRole, permission: PostPermission, isAuthor: boolean): boolean {
    if (userRole === 'admin') return true;
    if (userRole === 'moderator' && !isAuthor) return true;
    return false;
  }
}
