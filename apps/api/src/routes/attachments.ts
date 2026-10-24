import type { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { posts, postAttachments, users } from '../db/schema.js';
import type { PermissionService } from '../services/permissions.js';
import type { AuditService } from '../services/audit.js';

// Allowed MIME magic bytes signatures
function detectMimeFromBytes(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;

  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // WebP: RIFF ... WEBP
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  // GIF: GIF8
  if (buffer.toString('ascii', 0, 4) === 'GIF8') {
    return 'image/gif';
  }
  // PDF: %PDF
  if (buffer.toString('ascii', 0, 4) === '%PDF') {
    return 'application/pdf';
  }
  // ZIP: PK\x03\x04
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return 'application/zip';
  }
  // Text / JSON / Markdown fallback detection
  const isAscii = buffer.slice(0, 1024).every((b) => b >= 9 && b <= 126);
  if (isAscii) {
    return 'text/plain';
  }

  return null;
}

export const attachmentRoutes: FastifyPluginAsync<{
  db: Database;
  permissionService: PermissionService;
  auditService: AuditService;
  storageDir?: string;
}> = async (fastify, options) => {
  const { db, permissionService, auditService } = options;
  const storageDir = options.storageDir || path.resolve(process.cwd(), 'uploads');

  // Ensure storage directory exists
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }

  // 1. Upload Attachment for a Post
  fastify.post('/:id/attachments', { preHandler: (fastify as any).requireAuth }, async (request, reply) => {
    const { id: postId } = request.params as { id: string };
    const user = request.user!;

    const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
    if (!post) {
      return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });
    }

    const permission = await permissionService.resolvePostPermission(
      { id: user.userId, role: user.role },
      { postId: post.id, authorId: post.authorId, status: post.status }
    );

    if (!permissionService.canEdit(permission)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'You do not have permission to attach files to this post' });
    }

    const data = await request.file({
      limits: {
        fileSize: 25 * 1024 * 1024, // 25 MB max limit
      },
    });

    if (!data) {
      return reply.status(400).send({ error: 'Bad Request', message: 'No file provided' });
    }

    const chunks: Buffer[] = [];
    let totalSize = 0;

    for await (const chunk of data.file) {
      totalSize += chunk.length;
      if (totalSize > 25 * 1024 * 1024) {
        return reply.status(413).send({ error: 'Payload Too Large', message: 'Attachment exceeds 25 MB limit' });
      }
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    const detectedMime = detectMimeFromBytes(buffer);

    if (!detectedMime) {
      return reply.status(415).send({
        error: 'Unsupported Media Type',
        message: 'File type rejected by security magic-byte inspection. Executables and unknown binaries are blocked.',
      });
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const safeExt = path.extname(data.filename).slice(0, 10).replace(/[^a-zA-Z0-9.]/g, '') || '.bin';
    const storageFileName = `${sha256}${safeExt}`;
    const storagePath = path.join(storageDir, storageFileName);

    // Save to disk if not already existing (content-addressable deduplication)
    if (!fs.existsSync(storagePath)) {
      await fs.promises.writeFile(storagePath, buffer);
    }

    const [attachment] = await db
      .insert(postAttachments)
      .values({
        postId,
        fileName: data.filename.slice(0, 255),
        fileSize: totalSize,
        mimeType: detectedMime,
        sha256,
        storagePath,
        scanStatus: 'clean',
        uploadedBy: user.userId,
      })
      .returning();

    await auditService.appendLog({
      actorUserId: user.userId,
      actorType: 'human',
      action: 'attachment_uploaded',
      entityType: 'post_attachments',
      entityId: attachment.id,
      metadata: { postId, fileName: attachment.fileName, fileSize: attachment.fileSize, mimeType: detectedMime },
      ipAddress: request.ip,
    });

    return reply.status(201).send({
      attachmentId: attachment.id,
      fileName: attachment.fileName,
      fileSize: attachment.fileSize,
      mimeType: attachment.mimeType,
      scanStatus: attachment.scanStatus,
      url: `/api/v1/attachments/${attachment.id}`,
    });
  });

  // 2. List Attachments for a Post
  fastify.get('/:id/attachments', async (request, reply) => {
    const { id: postId } = request.params as { id: string };

    const [post] = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
    if (!post) {
      return reply.status(404).send({ error: 'Not Found', message: 'Post not found' });
    }

    const permission = request.user
      ? await permissionService.resolvePostPermission(
          { id: request.user.userId, role: request.user.role },
          { postId: post.id, authorId: post.authorId, status: post.status }
        )
      : post.status === 'published'
      ? 'view'
      : 'none';

    if (!permissionService.canView(permission)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Access denied' });
    }

    const attachments = await db
      .select({
        id: postAttachments.id,
        fileName: postAttachments.fileName,
        fileSize: postAttachments.fileSize,
        mimeType: postAttachments.mimeType,
        scanStatus: postAttachments.scanStatus,
        createdAt: postAttachments.createdAt,
        uploadedByName: users.fullName,
      })
      .from(postAttachments)
      .leftJoin(users, eq(postAttachments.uploadedBy, users.id))
      .where(eq(postAttachments.postId, postId));

    return reply.send({
      attachments: attachments.map((a) => ({
        ...a,
        url: `/api/v1/attachments/${a.id}`,
      })),
    });
  });

  // 3. Serve Attachment Content (Authorized Serving)
  fastify.get('/attachments/:attachmentId', async (request, reply) => {
    const { attachmentId } = request.params as { attachmentId: string };

    const [attachment] = await db
      .select()
      .from(postAttachments)
      .where(eq(postAttachments.id, attachmentId))
      .limit(1);

    if (!attachment) {
      return reply.status(404).send({ error: 'Not Found', message: 'Attachment not found' });
    }

    if (attachment.scanStatus === 'blocked') {
      return reply.status(403).send({ error: 'Forbidden', message: 'File blocked by security scan' });
    }

    // Verify parent post permissions
    const [post] = await db.select().from(posts).where(eq(posts.id, attachment.postId)).limit(1);
    if (!post) {
      return reply.status(404).send({ error: 'Not Found', message: 'Parent post not found' });
    }

    const permission = request.user
      ? await permissionService.resolvePostPermission(
          { id: request.user.userId, role: request.user.role },
          { postId: post.id, authorId: post.authorId, status: post.status }
        )
      : post.status === 'published'
      ? 'view'
      : 'none';

    if (!permissionService.canView(permission)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Access denied to attachment' });
    }

    if (!fs.existsSync(attachment.storagePath)) {
      return reply.status(404).send({ error: 'Not Found', message: 'Stored file missing on disk' });
    }

    const isImage = attachment.mimeType.startsWith('image/');
    const stream = fs.createReadStream(attachment.storagePath);

    return reply
      .header('Content-Type', attachment.mimeType)
      .header('X-Content-Type-Options', 'nosniff')
      .header(
        'Content-Disposition',
        isImage ? 'inline' : `attachment; filename="${encodeURIComponent(attachment.fileName)}"`
      )
      .send(stream);
  });
};
