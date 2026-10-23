import type { FastifyPluginAsync } from 'fastify';
import { desc } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { auditLogs } from '../db/schema.js';
import type { AuditService } from '../services/audit.js';

export const auditRoutes: FastifyPluginAsync<{
  db: Database;
  auditService: AuditService;
}> = async (fastify, options) => {
  const { db, auditService } = options;

  // 1. List Audit Logs (Admin Only)
  fastify.get(
    '/',
    {
      preHandler: [
        (fastify as any).requireAuth,
        (fastify as any).requireRole(['admin']),
      ],
    },
    async (request, reply) => {
      const logs = await db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(100);

      return reply.send({ logs });
    }
  );

  // 2. Cryptographic Chain Integrity Verification (Admin Only)
  fastify.get(
    '/verify',
    {
      preHandler: [
        (fastify as any).requireAuth,
        (fastify as any).requireRole(['admin']),
      ],
    },
    async (request, reply) => {
      const result = await auditService.verifyChainIntegrity();
      return reply.send(result);
    }
  );
};
