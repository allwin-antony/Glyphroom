import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/index.js';
import { bookmarks, posts, users, centersOfExcellence } from '../db/schema.js';
import type { PermissionService } from '../services/permissions.js';

const CreateBookmarkSchema = z.object({
  postId: z.string().uuid(),
  note: z.string().max(2000).optional(),
});

const postSelection = {
  id: posts.id,
  slug: posts.slug,
  title: posts.title,
  excerpt: posts.excerpt,
  status: posts.status,
  authorId: posts.authorId,
  authorName: users.fullName,
  coeName: centersOfExcellence.name,
  spaceId: posts.spaceId,
  visibility: posts.visibility,
  isPromoted: posts.isPromoted,
  publishedAt: posts.publishedAt,
  createdAt: posts.createdAt,
  updatedAt: posts.updatedAt,
};

export const bookmarkRoutes: FastifyPluginAsync<{
  db: Database;
  permissionService: PermissionService;
}> = async (fastify, options) => {
  const { db, permissionService } = options;

  // Visibility is checked when reading the list as well as when creating a bookmark.
  fastify.get('/', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const user = request.user!;
    const rows = await db
      .select({ bookmark: bookmarks, post: postSelection })
      .from(bookmarks)
      .innerJoin(posts, eq(bookmarks.postId, posts.id))
      .leftJoin(users, eq(posts.authorId, users.id))
      .leftJoin(centersOfExcellence, eq(posts.coeId, centersOfExcellence.id))
      .where(eq(bookmarks.userId, user.userId))
      .orderBy(desc(bookmarks.bookmarkedAt));

    const visible = [];
    for (const row of rows) {
      const permission = await permissionService.resolvePostPermission(
        { id: user.userId, role: user.role },
        {
          postId: row.post.id,
          authorId: row.post.authorId,
          status: row.post.status,
          spaceId: row.post.spaceId,
          visibility: row.post.visibility,
          isPromoted: row.post.isPromoted,
        }
      );
      if (permissionService.canView(permission)) visible.push({ ...row.bookmark, post: row.post });
    }
    return reply.send({ bookmarks: visible });
  });

  fastify.post('/', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const parsed = CreateBookmarkSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Bad Request', message: parsed.error.message });

    const user = request.user!;
    const [post] = await db.select().from(posts).where(eq(posts.id, parsed.data.postId)).limit(1);
    if (!post) return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });

    const permission = await permissionService.resolvePostPermission(
      { id: user.userId, role: user.role },
      {
        postId: post.id,
        authorId: post.authorId,
        status: post.status,
        spaceId: post.spaceId,
        visibility: post.visibility,
        isPromoted: post.isPromoted,
      }
    );
    if (!permissionService.canView(permission)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'You do not have access to bookmark this post' });
    }

    await db.insert(bookmarks).values({
      userId: user.userId,
      postId: post.id,
      note: parsed.data.note ?? null,
    }).onConflictDoUpdate({
      target: [bookmarks.userId, bookmarks.postId],
      set: { note: parsed.data.note ?? null, bookmarkedAt: new Date() },
    });
    const [bookmark] = await db.select().from(bookmarks)
      .where(and(eq(bookmarks.userId, user.userId), eq(bookmarks.postId, post.id))).limit(1);
    return reply.status(201).send({ bookmark });
  });

  fastify.delete('/:postId', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const { postId } = request.params as { postId: string };
    if (!z.string().uuid().safeParse(postId).success) {
      return reply.status(400).send({ error: 'Bad Request', message: 'postId must be a UUID' });
    }
    await db.delete(bookmarks).where(and(eq(bookmarks.userId, request.user!.userId), eq(bookmarks.postId, postId)));
    return reply.status(204).send();
  });
};
