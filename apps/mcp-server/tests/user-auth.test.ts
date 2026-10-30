import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createInMemoryDatabase } from '../../api/tests/helpers/test-db.js';
import { createApiApp } from '../../api/src/app.js';
import { users, personalAccessTokens, centersOfExcellence } from '../../api/src/db/schema.js';
import { startMcpServer } from '../src/index.js';

describe('caller-local PATs and actual MCP/API authoring contracts', () => {
  const clients: Client[] = [];
  const identities: Array<{ userId: string; tokenId: string; secret: string }> = [];
  const gatewayCalls: Array<{ headers: http.IncomingHttpHeaders; body: any }> = [];
  let database: ReturnType<typeof createInMemoryDatabase>;
  let api: Awaited<ReturnType<typeof createApiApp>>;
  let mcp: Awaited<ReturnType<typeof startMcpServer>>;
  let gateway: http.Server;
  let apiUrl: string;
  let mcpUrl: URL;
  let coeId: string;

  const unpack = (result: any) => {
    expect(result.isError).not.toBe(true);
    return JSON.parse(result.content[0].text);
  };
  const connect = async (secret?: string) => {
    const client = new Client({ name: 'pat-regression-client', version: '1.0.0' });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers: secret ? { Authorization: `Bearer ${secret}` } : {} } }));
    return client;
  };
  const request = (index: number, path: string, body?: unknown) => fetch(`${apiUrl}/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${identities[index].secret}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  beforeAll(async () => {
    database = createInMemoryDatabase();
    for (let i = 0; i < 2; i++) {
      const [user] = await database.db.insert(users).values({ email: `pat-${i}@example.test`, fullName: `Writer ${i}`, role: 'author', isActive: true }).returning();
      const secret = `eb_pat_${crypto.randomBytes(32).toString('hex')}`;
      const [token] = await database.db.insert(personalAccessTokens).values({ userId: user.id, name: 'Fixture', tokenHash: crypto.createHash('sha256').update(secret).digest('hex'), scopes: ['posts:read', 'posts:write', 'comments:write'] }).returning();
      identities.push({ userId: user.id, tokenId: token.id, secret });
    }
    const [coe] = await database.db.insert(centersOfExcellence).values({ name: 'Engineering', code: 'ENG' }).returning();
    coeId = coe.id;
    api = await createApiApp({ db: database.db });
    apiUrl = await api.app.listen({ host: '127.0.0.1', port: 0 });
    gateway = http.createServer(async (req, res) => {
      let text = '';
      for await (const chunk of req) text += chunk;
      const body = JSON.parse(text);
      gatewayCalls.push({ headers: req.headers, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, operation: body.operation, documentId: body.documentId, appliedAt: Date.now(), changesSummary: { insertions: 1, deletions: 0 }, suggestionIds: [] }));
    });
    await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
    vi.stubEnv('MCP_TRANSPORT', 'http');
    vi.stubEnv('PORT', '0');
    vi.stubEnv('LOG_LEVEL', 'silent');
    vi.stubEnv('GLYPHROOM_API_URL', `${apiUrl}/api/v1`);
    vi.stubEnv('GLYPHROOM_PAT', 'server-global-token-must-not-be-used');
    vi.stubEnv('COLLAB_GATEWAY_URL', `http://127.0.0.1:${(gateway.address() as any).port}`);
    mcp = await startMcpServer();
    mcpUrl = new URL(`http://127.0.0.1:${(mcp.httpServer!.address() as any).port}/mcp`);
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.close()));
    if (mcp) {
      await mcp.mcpServer.close();
      await new Promise<void>((resolve) => mcp.httpServer!.close(() => resolve()));
    }
    if (gateway) await new Promise<void>((resolve) => gateway.close(() => resolve()));
    if (api) await api.close();
    if (database) await database.pool.end();
    vi.unstubAllEnvs();
  });

  it('preserves bodies/metadata and independent identities through HTTP, API, and gateway', async () => {
    const connected = await Promise.all(identities.map((identity) => connect(identity.secret)));
    const body = '## Glyphroom\n\nA collaborative **knowledge platform**.\n\n```ts\nconst answer = 42;\n```';
    const drafts = await Promise.all(connected.map(async (client, index) => unpack(await client.callTool({ name: 'create_post', arguments: { title: `Writer ${index} overview`, content: body, tags: ['glyphroom'], coeId, excerpt: 'Overview' } }))));
    for (let i = 0; i < drafts.length; i++) {
      const response = await request(i, `/posts/${drafts[i].id}`);
      const { post } = await response.json();
      expect(post.authorId).toBe(identities[i].userId);
      expect(post.workingMarkdown).toBe(body);
      expect(post.derivedMarkdown).toBe(body);
      expect(post.tags).toEqual(['glyphroom']);
      expect(post.coeId).toBe(coeId);
    }
    await Promise.all(connected.map(async (client, index) => unpack(await client.callTool({ name: 'append_section', arguments: { postId: drafts[index].slug, heading: 'Next', content: 'Follow-up' } }))));
    for (let i = 0; i < drafts.length; i++) {
      const call = gatewayCalls.find((entry) => entry.body.documentId === drafts[i].id)!;
      expect(call.headers['x-user-id']).toBe(identities[i].userId);
      expect(call.headers['x-token-id']).toBe(identities[i].tokenId);
    }
    const denied = await connected[1].callTool({ name: 'append_section', arguments: { postId: drafts[0].slug, content: 'Not my draft' } });
    expect(denied.isError).toBe(true);
    expect(gatewayCalls).toHaveLength(2);

    const comment = await request(0, `/posts/${drafts[0].id}/comments`, { content: 'Editor comment', parentId: null, yjsAnchorStart: null, yjsAnchorEnd: null });
    expect(comment.status).toBe(201);
    const parentId = (await comment.json()).comment.id;
    const wrongThread = await request(1, `/posts/${drafts[1].id}/comments`, { content: 'Wrong parent', parentId });
    expect(wrongThread.status).toBe(400);
    const ownReply = unpack(await connected[0].callTool({ name: 'add_comment', arguments: { postId: drafts[0].id, content: 'Reply', parentId } }));
    expect(ownReply.authorId).toBe(identities[0].userId);
  });

  it('does not fall back to a server credential and enforces the caller scope', async () => {
    const anonymous = await connect();
    expect((await anonymous.callTool({ name: 'create_post', arguments: { title: 'Anonymous', content: 'Denied' } })).isError).toBe(true);
    const secret = `eb_pat_${crypto.randomBytes(32).toString('hex')}`;
    const [limited] = await database.db.insert(personalAccessTokens).values({ userId: identities[0].userId, name: 'Read only', tokenHash: crypto.createHash('sha256').update(secret).digest('hex'), scopes: ['posts:read'] }).returning();
    const reader = await connect(secret);
    const result: any = await reader.callTool({ name: 'create_post', arguments: { title: 'Read-only draft', content: 'Denied' } });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('posts:draft');
    const other = await connect(identities[1].secret);
    const revoked = await fetch(`${apiUrl}/api/v1/pats/${limited.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${identities[0].secret}` } });
    expect(revoked.status).toBe(200);
    await expect(reader.listTools()).rejects.toThrow();
    expect((await other.listTools()).tools.length).toBeGreaterThan(0);
    const invalid = await fetch(mcpUrl, { method: 'POST', headers: { Authorization: 'Bearer invalid' } });
    expect(invalid.status).toBe(401);
  });
});
