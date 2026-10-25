import type { Server } from '@hocuspocus/server';
import {
  appendSection,
  insertAfterSection,
  suggestEditSection,
  type AgentMetadata,
  type AgentGatewayEditRequest,
  type AgentGatewayEditResponse,
  type AgentGatewayErrorCode,
} from '@enterprise-blogger/shared';
import { injectAgentAwareness } from './awareness.js';

export class GatewayError extends Error {
  constructor(
    public readonly code: AgentGatewayErrorCode,
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export async function executeAgentEdit(
  server: Server,
  request: AgentGatewayEditRequest,
  headers: {
    userId: string;
    agentId: string;
    tokenId?: string;
  }
): Promise<AgentGatewayEditResponse> {
  const agentMeta: AgentMetadata = {
    agentId: headers.agentId,
    tokenId: request.tokenId || headers.tokenId || 'default-token',
    ownerUserId: headers.userId,
    timestamp: Date.now(),
  };

  const context = {
    user: {
      id: headers.userId,
      role: 'author' as const,
      name: `Agent on behalf of ${headers.userId}`,
      permissions: ['edit' as const],
    },
    agentId: headers.agentId,
    tokenId: agentMeta.tokenId,
  };

  const documentName = request.documentId.startsWith('post-')
    ? request.documentId
    : `post-${request.documentId}`;

  let conn;
  try {
    conn = await server.hocuspocus.openDirectConnection(documentName, context);
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('Forbidden')) {
      throw new GatewayError('FORBIDDEN', msg, 403);
    }
    if (msg.includes('Unauthorized')) {
      throw new GatewayError('UNAUTHORIZED', msg, 401);
    }
    throw new GatewayError('INTERNAL_ERROR', `Failed to open document: ${msg}`, 500);
  }

  if (!conn || !conn.document) {
    throw new GatewayError('INTERNAL_ERROR', 'Direct connection returned null document', 500);
  }

  try {
    // 1. Inject live awareness into the document
    const targetHeading = (request as any).targetHeading;
    injectAgentAwareness(conn.document, agentMeta, { targetHeading });

    // 2. Execute requested suggestion operation inside conn.transact
    let changesSummary: { insertions: number; deletions: number; hunksApplied?: number } = { insertions: 0, deletions: 0 };
    let suggestionIds: string[] = [];

    await conn.transact((doc) => {
      switch (request.operation) {
        case 'append_section': {
          const result = appendSection(doc, request.heading, request.content, agentMeta, {
            fragmentName: 'prosemirror',
          });
          changesSummary = result.changesSummary;
          suggestionIds = result.suggestionIds;
          break;
        }

        case 'insert_after_section': {
          const result = insertAfterSection(
            doc,
            request.targetHeading,
            request.heading,
            request.content,
            agentMeta,
            { fragmentName: 'prosemirror' }
          );
          if (!result.success) {
            throw new GatewayError(
              'SECTION_NOT_FOUND',
              `Target heading "${request.targetHeading}" not found in document "${request.documentId}"`,
              404
            );
          }
          changesSummary = result.changesSummary;
          suggestionIds = result.suggestionIds;
          break;
        }

        case 'suggest_edit_section': {
          const result = suggestEditSection(
            doc,
            request.targetHeading,
            request.content,
            agentMeta,
            { fragmentName: 'prosemirror' }
          );
          if (!result.success) {
            throw new GatewayError(
              'SECTION_NOT_FOUND',
              `Target heading "${request.targetHeading}" not found in document "${request.documentId}"`,
              404
            );
          }
          changesSummary = result.changesSummary;
          suggestionIds = result.suggestionIds;
          break;
        }

        default:
          throw new GatewayError(
            'INVALID_OPERATION',
            `Unsupported operation: ${(request as any).operation}`,
            400
          );
      }
    });

    // 3. Flush updates immediately to all connected clients
    if (typeof (conn.document as any).flush === 'function') {
      (conn.document as any).flush();
    }

    return {
      success: true,
      operation: request.operation,
      documentId: request.documentId,
      appliedAt: agentMeta.timestamp,
      changesSummary,
      suggestionIds,
    };
  } finally {
    // 4. Clean up connection while keeping the document warm in memory
    await conn.disconnect({ unloadImmediately: false });
  }
}
