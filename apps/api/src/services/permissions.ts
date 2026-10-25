import { eq, and } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { posts, postCollaborators, spaces, spaceMembers, type users } from '../db/schema.js';

export type UserRole = 'admin' | 'moderator' | 'author' | 'reader';
export type SpaceRole = 'viewer' | 'reviewer' | 'author' | 'maintainer' | 'owner';
export type PostPermission = 'admin' | 'edit' | 'review' | 'view' | 'none';

export interface PostPermissionContext {
  postId: string;
  authorId: string;
  status: 'draft' | 'in_review' | 'approved' | 'published' | 'archived';
  spaceId?: string | null;
  visibility?: 'space' | 'invited_only';
  isPromoted?: boolean;
}

export class PermissionService {
  constructor(private readonly db: Database) {}

  /**
   * Helper to rank permissions for max-permission calculations
   */
  private permissionRank(perm: PostPermission): number {
    switch (perm) {
      case 'admin': return 4;
      case 'edit': return 3;
      case 'review': return 2;
      case 'view': return 1;
      default: return 0;
    }
  }

  private maxPermission(a: PostPermission, b: PostPermission): PostPermission {
    return this.permissionRank(a) >= this.permissionRank(b) ? a : b;
  }

  /**
   * Resolve user role within a specific Space
   */
  async getSpaceRole(spaceId: string, userId: string): Promise<SpaceRole | null> {
    const [membership] = await this.db
      .select({ role: spaceMembers.role })
      .from(spaceMembers)
      .where(
        and(
          eq(spaceMembers.spaceId, spaceId),
          eq(spaceMembers.userId, userId)
        )
      )
      .limit(1);

    return membership ? membership.role : null;
  }

  /**
   * Resolve effective permission for a user on a specific post / document
   */
  async resolvePostPermission(
    user: { id: string; role: UserRole },
    postContext: PostPermissionContext
  ): Promise<PostPermission> {
    // 1. Global Admin has full administrative access
    if (user.role === 'admin') {
      return 'admin';
    }

    let effective: PostPermission = 'none';

    // 2. Post Author has edit rights on their own working document
    if (user.id === postContext.authorId) {
      effective = this.maxPermission(effective, 'edit');
    }

    // 3. Explicitly assigned collaborator / page guest permission
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
      effective = this.maxPermission(effective, collab.permission);
    }

    // 4. Space-level Membership & Role
    if (postContext.spaceId) {
      const spaceRole = await this.getSpaceRole(postContext.spaceId, user.id);
      if (spaceRole) {
        const isInvitedOnly = postContext.visibility === 'invited_only';

        if (isInvitedOnly) {
          // Maintainers and Owners always have access to invited_only sensitive pages in their space
          if (spaceRole === 'owner' || spaceRole === 'maintainer') {
            effective = this.maxPermission(effective, 'admin');
          }
          // Regular authors, reviewers, viewers in the space need direct page invitation (collab)
        } else {
          // Standard Space visibility: all space members receive their role's permissions
          if (spaceRole === 'owner' || spaceRole === 'maintainer') {
            effective = this.maxPermission(effective, 'admin');
          } else if (spaceRole === 'author') {
            effective = this.maxPermission(effective, 'edit');
          } else if (spaceRole === 'reviewer') {
            effective = this.maxPermission(effective, 'review');
          } else if (spaceRole === 'viewer') {
            effective = this.maxPermission(effective, 'view');
          }
        }
      }
    }

    // 5. Global Moderator role handling
    if (user.role === 'moderator') {
      if (postContext.status === 'in_review' || postContext.status === 'approved') {
        effective = this.maxPermission(effective, 'review');
      } else if (postContext.status === 'published') {
        effective = this.maxPermission(effective, 'view');
      }
    }

    // 6. Company Library / Promoted Pages
    // If a post is promoted to company and published, all active users can read it
    if (postContext.isPromoted && postContext.status === 'published') {
      effective = this.maxPermission(effective, 'view');
    }

    // 7. Standalone / Legacy published posts without a space are visible to readers
    if (!postContext.spaceId && postContext.status === 'published') {
      effective = this.maxPermission(effective, 'view');
    }

    return effective;
  }

  /**
   * Check if permission allows editing the document content
   */
  canEdit(permission: PostPermission): boolean {
    return permission === 'admin' || permission === 'edit';
  }

  /**
   * Check if permission allows reviewing/approving the document
   * Strict constraint: Author cannot review their own post!
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
   * Check if user can publish the post within the space or standalone
   */
  canPublish(userRole: UserRole, permission: PostPermission, isAuthor: boolean): boolean {
    if (userRole === 'admin') return true;
    if (userRole === 'moderator' && !isAuthor) return true;
    if (permission === 'admin') return true;
    return false;
  }

  /**
   * Check if user can promote a page to the Company Library.
   * Rules:
   * 1. Global Admin can promote any page.
   * 2. Standalone page (outside a team space): Author can self-promote.
   * 3. Space page: Space Maintainer or Owner can promote. Space Author CANNOT self-promote!
   */
  async canPromoteToCompany(
    user: { id: string; role: UserRole },
    postContext: PostPermissionContext
  ): Promise<boolean> {
    if (user.role === 'admin') return true;

    if (!postContext.spaceId) {
      // Standalone page: author or admin can promote
      return user.id === postContext.authorId;
    }

    // Team Space page: requires space maintainer or owner
    const spaceRole = await this.getSpaceRole(postContext.spaceId, user.id);
    if (spaceRole === 'owner' || spaceRole === 'maintainer') {
      return true;
    }

    return false;
  }
}
