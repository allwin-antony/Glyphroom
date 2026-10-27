import type { OutboxService } from '../plugins/outbox.js';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, and, desc, inArray } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { spaces, spaceMembers, spaceRequests, users, posts, centersOfExcellence } from '../db/schema.js';
import type { PermissionService } from '../services/permissions.js';
import type { AuditService } from '../services/audit.js';
import type { NotificationService } from '../services/notifications.js';

const CreateSpaceSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  initialMaintainerId: z.string().uuid().optional(),
});

const UpdateSpaceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  isArchived: z.boolean().optional(),
});

const AddMemberSchema = z.object({
  userId: z.string().uuid().optional(),
  email: z.string().email().optional(),
  role: z.enum(['viewer', 'reviewer', 'author', 'maintainer', 'owner']),
}).refine((data) => data.userId || data.email, {
  message: 'Either userId or email must be provided',
});

const UpdateMemberRoleSchema = z.object({
  role: z.enum(['viewer', 'reviewer', 'author', 'maintainer', 'owner']),
});

const CreateSpaceRequestSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/),
  reason: z.string().optional(),
});

export const spaceRoutes: FastifyPluginAsync<{
  db: Database;
  permissionService: PermissionService;
  auditService: AuditService;
  notificationService: NotificationService;
  outboxService?: OutboxService;
}> = async (fastify, options) => {
  const { db, permissionService, auditService, notificationService, outboxService } = options;

  // 0. Space Directory Users (active users that can be invited to a space)
  fastify.get('/directory/users', { preHandler: (fastify as any).requireAuth }, async (_request, reply) => {
    const activeUsers = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
      })
      .from(users)
      .where(eq(users.isActive, true));

    return reply.send({ users: activeUsers });
  });

  // 1. List Spaces (Returns user's joined spaces + all active open spaces)
  fastify.get('/', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const user = request.user!;

    // Fetch all active spaces
    const allSpaces = await db
      .select({
        id: spaces.id,
        slug: spaces.slug,
        name: spaces.name,
        description: spaces.description,
        isArchived: spaces.isArchived,
        createdAt: spaces.createdAt,
        updatedAt: spaces.updatedAt,
      })
      .from(spaces)
      .where(eq(spaces.isArchived, false))
      .orderBy(spaces.name);

    // Fetch user's memberships
    const userMemberships = await db
      .select({
        spaceId: spaceMembers.spaceId,
        role: spaceMembers.role,
      })
      .from(spaceMembers)
      .where(eq(spaceMembers.userId, user.userId));

    const membershipMap = new Map(userMemberships.map((m) => [m.spaceId, m.role]));

    const result = allSpaces.map((s) => ({
      ...s,
      userRole: user.role === 'admin' ? ('owner' as const) : membershipMap.get(s.id) || null,
      isMember: user.role === 'admin' || membershipMap.has(s.id),
    }));

    return reply.send({ spaces: result });
  });

  // 2. Create Space (Admin only)
  fastify.post('/', { preHandler: [(fastify as any).requireAuth, (fastify as any).requireRole(['admin'])] }, async (request, reply) => {
    const user = request.user!;

    const parseResult = CreateSpaceSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }

    const { name, slug, description, initialMaintainerId } = parseResult.data;

    // Check slug uniqueness
    const [existing] = await db.select().from(spaces).where(eq(spaces.slug, slug)).limit(1);
    if (existing) {
      return reply.status(409).send({ error: 'Conflict', message: 'Space with this slug already exists' });
    }

    const [newSpace] = await db
      .insert(spaces)
      .values({
        name,
        slug,
        description: description || null,
      })
      .returning();

    // Assign initial maintainer / owner
    const maintainerId = initialMaintainerId || user.userId;
    await db.insert(spaceMembers).values({
      spaceId: newSpace.id,
      userId: maintainerId,
      role: 'owner',
    });

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'space_created',
      entityType: 'spaces',
      entityId: newSpace.id,
      metadata: { name, slug, maintainerId },
      ipAddress: request.ip,
    });

    if (outboxService) {
      await outboxService.enqueue(db, 'space:created', {
        spaceId: newSpace.id,
        name: newSpace.name,
        ownerId: maintainerId,
      });
    }

    return reply.status(201).send({ space: newSpace });
  });

  // 3. User Space Requests: List pending requests (Admin only)
  fastify.get('/requests', { preHandler: [(fastify as any).requireAuth, (fastify as any).requireRole(['admin'])] }, async (_request, reply) => {
    const requests = await db
      .select({
        id: spaceRequests.id,
        name: spaceRequests.name,
        slug: spaceRequests.slug,
        reason: spaceRequests.reason,
        status: spaceRequests.status,
        createdAt: spaceRequests.createdAt,
        requesterId: spaceRequests.requestedBy,
        requesterName: users.fullName,
        requesterEmail: users.email,
      })
      .from(spaceRequests)
      .innerJoin(users, eq(spaceRequests.requestedBy, users.id))
      .orderBy(desc(spaceRequests.createdAt));

    return reply.send({ requests });
  });

  // 4. User Space Requests: Submit a new space request (Any authenticated user)
  fastify.post('/requests', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const user = request.user!;

    const parseResult = CreateSpaceRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }

    const { name, slug, reason } = parseResult.data;

    const [newRequest] = await db
      .insert(spaceRequests)
      .values({
        requestedBy: user.userId,
        name,
        slug,
        reason: reason || null,
        status: 'pending',
      })
      .returning();

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'space_request_submitted',
      entityType: 'space_requests',
      entityId: newRequest.id,
      metadata: { name, slug },
      ipAddress: request.ip,
    });

    return reply.status(201).send({ request: newRequest });
  });

  // 5. User Space Requests: Review request (Approve / Reject) (Admin only)
  fastify.patch('/requests/:id', { preHandler: [(fastify as any).requireAuth, (fastify as any).requireRole(['admin'])] }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { action } = request.body as { action: 'approve' | 'reject' };

    const [req] = await db.select().from(spaceRequests).where(eq(spaceRequests.id, id)).limit(1);
    if (!req) {
      return reply.status(404).send({ error: 'Not Found', message: 'Request not found' });
    }

    if (action === 'approve') {
      // Check if space slug already exists
      const [existing] = await db.select().from(spaces).where(eq(spaces.slug, req.slug)).limit(1);
      if (existing) {
        return reply.status(409).send({ error: 'Conflict', message: 'A space with this slug already exists' });
      }

      // Create space
      const [newSpace] = await db
        .insert(spaces)
        .values({
          name: req.name,
          slug: req.slug,
          description: req.reason,
        })
        .returning();

      // Assign requester as owner
      await db.insert(spaceMembers).values({
        spaceId: newSpace.id,
        userId: req.requestedBy,
        role: 'owner',
      });

      await db
        .update(spaceRequests)
        .set({ status: 'approved', reviewedBy: user.userId, updatedAt: new Date() })
        .where(eq(spaceRequests.id, id));

      await auditService.appendLog({
        actorUserId: user.userId,
        actorType: 'human',
        action: 'space_request_approved',
        entityType: 'space_requests',
        entityId: id,
        metadata: { spaceId: newSpace.id, name: req.name },
        ipAddress: request.ip,
      });

      await notificationService.create({
        userId: req.requestedBy,
        type: 'space_request_decision',
        title: 'Space request approved',
        body: `Your request for ${req.name} was approved.`,
        entityType: 'space_request',
        entityId: id,
        href: `/spaces/${newSpace.id}`,
      });

      return reply.send({ message: 'Space approved and created', space: newSpace });
    } else {
      await db
        .update(spaceRequests)
        .set({ status: 'rejected', reviewedBy: user.userId, updatedAt: new Date() })
        .where(eq(spaceRequests.id, id));

      await auditService.appendLog({
        actorUserId: user.userId,
        actorType: 'human',
        action: 'space_request_rejected',
        entityType: 'space_requests',
        entityId: id,
        ipAddress: request.ip,
      });

      await notificationService.create({
        userId: req.requestedBy,
        type: 'space_request_decision',
        title: 'Space request rejected',
        body: `Your request for ${req.name} was rejected.`,
        entityType: 'space_request',
        entityId: id,
        href: '/spaces',
      });

      return reply.send({ message: 'Space request rejected' });
    }
  });

  // 6. Get Space by ID or Slug
  fastify.get('/:idOrSlug', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const { idOrSlug } = request.params as { idOrSlug: string };
    const user = request.user!;

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const [space] = await db
      .select()
      .from(spaces)
      .where(isUuid ? eq(spaces.id, idOrSlug) : eq(spaces.slug, idOrSlug))
      .limit(1);

    if (!space) {
      return reply.status(404).send({ error: 'Not Found', message: 'Space not found' });
    }

    const spaceRole = user.role === 'admin' ? 'owner' : await permissionService.getSpaceRole(space.id, user.userId);

    // Get members count
    const membersList = await db
      .select({
        userId: spaceMembers.userId,
        role: spaceMembers.role,
        fullName: users.fullName,
        email: users.email,
      })
      .from(spaceMembers)
      .innerJoin(users, eq(spaceMembers.userId, users.id))
      .where(eq(spaceMembers.spaceId, space.id));

    return reply.send({
      space: {
        ...space,
        userRole: spaceRole,
        isMember: user.role === 'admin' || Boolean(spaceRole),
        membersCount: membersList.length,
        maintainers: membersList.filter((m) => m.role === 'maintainer' || m.role === 'owner'),
      },
    });
  });

  // 6.5 Update Space (Owner, Maintainer, or Admin)
  fastify.patch('/:id', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const [space] = await db.select().from(spaces).where(eq(spaces.id, id)).limit(1);

    if (!space) {
      return reply.status(404).send({ error: 'Not Found', message: 'Space not found' });
    }

    const spaceRole = user.role === 'admin' ? 'owner' : await permissionService.getSpaceRole(id, user.userId);
    if (user.role !== 'admin' && spaceRole !== 'owner' && spaceRole !== 'maintainer') {
      return reply.status(403).send({ error: 'Forbidden', message: 'Only space maintainers or owners can update this space' });
    }

    const parseResult = UpdateSpaceSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }

    const updates = parseResult.data;
    const [updated] = await db
      .update(spaces)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(spaces.id, id))
      .returning();

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: updates.isArchived === true ? 'space_archived' : updates.isArchived === false ? 'space_restored' : 'space_updated',
      entityType: 'spaces',
      entityId: id,
      metadata: updates,
      ipAddress: request.ip,
    });

    if (updates.isArchived === true && outboxService) {
      await outboxService.enqueue(db, 'space:archived', {
        spaceId: id,
      });
    }

    return reply.send({ space: updated });
  });

  // 7. List Space Members
  fastify.get('/:id/members', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const spaceRole = user.role === 'admin' ? 'owner' : await permissionService.getSpaceRole(id, user.userId);
    if (user.role !== 'admin' && !spaceRole) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Access denied to space member directory' });
    }

    const members = await db
      .select({
        spaceId: spaceMembers.spaceId,
        userId: spaceMembers.userId,
        role: spaceMembers.role,
        createdAt: spaceMembers.createdAt,
        fullName: users.fullName,
        email: users.email,
        globalRole: users.role,
      })
      .from(spaceMembers)
      .innerJoin(users, eq(spaceMembers.userId, users.id))
      .where(eq(spaceMembers.spaceId, id))
      .orderBy(spaceMembers.createdAt);

    return reply.send({ members });
  });

  // 8. Add Member to Space (Maintainer, Owner, or Admin only)
  fastify.post('/:id/members', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    const spaceRole = user.role === 'admin' ? 'owner' : await permissionService.getSpaceRole(id, user.userId);
    if (user.role !== 'admin' && spaceRole !== 'owner' && spaceRole !== 'maintainer') {
      return reply.status(403).send({ error: 'Forbidden', message: 'Only space maintainers or owners can manage members' });
    }

    const parseResult = AddMemberSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }

    const { userId, email, role } = parseResult.data;

    let targetUser: typeof users.$inferSelect | undefined;
    if (userId) {
      const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      targetUser = u;
    } else if (email) {
      const [u] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
      targetUser = u;
    }

    if (!targetUser || !targetUser.isActive) {
      return reply.status(404).send({ error: 'Not Found', message: 'Target user not found or inactive' });
    }

    // Upsert membership
    await db
      .insert(spaceMembers)
      .values({
        spaceId: id,
        userId: targetUser.id,
        role,
      })
      .onConflictDoUpdate({
        target: [spaceMembers.spaceId, spaceMembers.userId],
        set: { role },
      });

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'space_member_added',
      entityType: 'space_members',
      entityId: id,
      metadata: { targetUserId: targetUser.id, role },
      ipAddress: request.ip,
    });

    return reply.status(201).send({ message: 'Member added to space', userId: targetUser.id, role });
  });

  // 9. Update Space Member Role (Maintainer, Owner, or Admin only)
  fastify.patch('/:id/members/:userId', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };
    const user = request.user!;

    const spaceRole = user.role === 'admin' ? 'owner' : await permissionService.getSpaceRole(id, user.userId);
    if (user.role !== 'admin' && spaceRole !== 'owner' && spaceRole !== 'maintainer') {
      return reply.status(403).send({ error: 'Forbidden', message: 'Only space maintainers or owners can change member roles' });
    }

    const parseResult = UpdateMemberRoleSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Validation failed', details: parseResult.error.format() });
    }

    const { role } = parseResult.data;

    await db
      .update(spaceMembers)
      .set({ role })
      .where(and(eq(spaceMembers.spaceId, id), eq(spaceMembers.userId, userId)));

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'space_member_role_updated',
      entityType: 'space_members',
      entityId: id,
      metadata: { targetUserId: userId, role },
      ipAddress: request.ip,
    });

    return reply.send({ message: 'Role updated successfully', role });
  });

  // 10. Remove Member from Space (Maintainer, Owner, or Admin only)
  fastify.delete('/:id/members/:userId', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };
    const user = request.user!;

    const spaceRole = user.role === 'admin' ? 'owner' : await permissionService.getSpaceRole(id, user.userId);
    if (user.role !== 'admin' && spaceRole !== 'owner' && spaceRole !== 'maintainer') {
      return reply.status(403).send({ error: 'Forbidden', message: 'Only space maintainers or owners can remove members' });
    }

    const [targetMembership] = await db
      .select({ role: spaceMembers.role })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, id), eq(spaceMembers.userId, userId)))
      .limit(1);

    if (!targetMembership) {
      return reply.status(404).send({ error: 'Not Found', message: 'Space member not found' });
    }

    if (targetMembership.role === 'owner') {
      const owners = await db
        .select({ userId: spaceMembers.userId })
        .from(spaceMembers)
        .where(and(eq(spaceMembers.spaceId, id), eq(spaceMembers.role, 'owner')));

      if (owners.length <= 1) {
        return reply.status(409).send({ error: 'Conflict', message: 'A Space must retain at least one owner' });
      }
    }

    await db
      .delete(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, id), eq(spaceMembers.userId, userId)));

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'space_member_removed',
      entityType: 'space_members',
      entityId: id,
      metadata: { targetUserId: userId },
      ipAddress: request.ip,
    });

    return reply.send({ message: 'Member removed from space' });
  });
};
