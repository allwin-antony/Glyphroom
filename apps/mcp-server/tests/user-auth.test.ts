import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import http from 'node:http';
import * as Y from 'yjs';
import { initProseMirrorDoc, relativePositionToAbsolutePosition } from 'y-prosemirror';
import { blogSchema } from '@enterprise-blogger/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createInMemoryDatabase } from '../../api/tests/helpers/test-db.js';
import { createApiApp } from '../../api/src/app.js';
import { auditLogs, comments, posts, postReviews, postVersions, pluginEventOutbox, users, personalAccessTokens, centersOfExcellence } from '../../api/src/db/schema.js';
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
    const savedPost = (await database.db.select().from(posts)).find((post) => post.id === drafts[0].id)!;
    const ydoc = new Y.Doc();
    try {
      Y.applyUpdate(ydoc, savedPost.yjsState);
      const fragment = ydoc.getXmlFragment('prosemirror');
      // Model an editor-authored heading; create_post's raw Markdown paragraph
      // must not be re-imported into invented Yjs identities by the anchor API.
      const heading = new Y.XmlElement('heading');
      heading.setAttribute('level', '2');
      heading.insert(0, [new Y.XmlText('Glyphroom Section')]);
      fragment.insert(fragment.length, [heading]);
      await database.pool.query('UPDATE posts SET yjs_state = decode($1, \'hex\') WHERE id = $2',
        [Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString('hex'), drafts[0].id]);
      const anchored = unpack(await connected[0].callTool({ name: 'add_comment', arguments: {
        postId: drafts[0].id, content: 'Heading question', anchorHeading: 'Glyphroom Section', parentId,
      } }));
      const savedComment = (await database.db.select().from(comments)).find((comment) => comment.id === anchored.commentId)!;
      const { doc, meta } = initProseMirrorDoc(fragment, blogSchema);
      const from = relativePositionToAbsolutePosition(ydoc, fragment, Y.createRelativePositionFromJSON(savedComment.yjsAnchorStart), meta.mapping);
      const to = relativePositionToAbsolutePosition(ydoc, fragment, Y.createRelativePositionFromJSON(savedComment.yjsAnchorEnd), meta.mapping);
      expect({ from, to }).toEqual({ from: 53, to: 70 });
      expect(doc.textBetween(from!, to!)).toBe('Glyphroom Section');
      expect(savedComment).toMatchObject({ parentId, authorId: identities[0].userId });
      const parent = (await database.db.select().from(comments)).find((comment) => comment.id === parentId)!;
      expect(parent).toMatchObject({ yjsAnchorStart: null, yjsAnchorEnd: null });
    } finally { ydoc.destroy(); }

    const rawGetResult = await connected[0].callTool({
      name: 'get_post',
      arguments: { postId: drafts[0].id, format: 'prosemirror_json', includeSuggestions: true }
    });
    expect(rawGetResult.isError).not.toBe(true);
    const unwrapEnvelope = (text: string) => {
      const prefix = '<UNTRUSTED_CONTENT>\n';
      const suffix = '\n</UNTRUSTED_CONTENT>';
      expect(text.startsWith(prefix)).toBe(true);
      expect(text.endsWith(suffix)).toBe(true);
      return JSON.parse(text.slice(prefix.length, -suffix.length));
    };
    const getResult = unwrapEnvelope(rawGetResult.content[0].text);
    expect(getResult.format).toBe('prosemirror_json');
    expect(JSON.parse(getResult.content)).toMatchObject({ type: 'doc' });
  });

  it('validates publication notes at the actual MCP boundary and retains allowed notes with the approved pin', async () => {
    const [publisher] = await database.db.insert(users).values({ email: 'publisher@mcp-arguments.test', fullName: 'Publisher', role: 'admin' }).returning();
    const secret = `eb_pat_${crypto.randomBytes(32).toString('hex')}`;
    await database.db.insert(personalAccessTokens).values({ userId: publisher.id, name: 'Publish only',
      tokenHash: crypto.createHash('sha256').update(secret).digest('hex'), scopes: ['posts:publish'] });
    const client = await connect(secret);
    const [post] = await database.db.insert(posts).values({ slug: `notes-${crypto.randomUUID()}`, title: 'Notes contract',
      authorId: identities[0].userId, status: 'approved', yjsState: Buffer.from('unavailable-working-state') }).returning();
    const [checkpoint] = await database.db.insert(postVersions).values({ postId: post.id, versionNumber: 1,
      triggerReason: 'review_submission', markdownSnapshot: '', yjsStateSnapshot: Buffer.from('historical-state'),
      createdBy: identities[0].userId }).returning();
    await database.pool.query('UPDATE posts SET submitted_version_id = $1 WHERE id = $2', [checkpoint.id, post.id]);
    await database.db.insert(postReviews).values({ postId: post.id, submittedVersionId: checkpoint.id,
      reviewerId: identities[1].userId, decision: 'approved', notes: 'Independent review notes' });

    const invalid = await client.callTool({ name: 'publish_post', arguments: { postId: post.id, notes: 'n'.repeat(2001) } });
    expect(invalid.isError).toBe(true);
    expect((await database.db.select().from(pluginEventOutbox)).filter((event) => event.eventType === 'post:published')).toHaveLength(0);
    const notes = 'n'.repeat(2000);
    const receipt = unpack(await client.callTool({ name: 'publish_post', arguments: { postId: post.id, notes } }));
    expect(receipt).toMatchObject({ success: true, postId: post.id, status: 'published' });
    const event = (await database.db.select().from(pluginEventOutbox)).find((event) => event.eventType === 'post:published')!;
    expect(event.payload).toMatchObject({ postId: post.id, publishedVersionId: checkpoint.id, notes });
    const audit = (await database.db.select().from(auditLogs)).find((audit) => audit.action === 'post_published')!;
    expect(audit.metadata).toEqual({ versionId: checkpoint.id, versionNumber: 1, notes });
    const review = (await database.db.select().from(postReviews)).find((review) => review.postId === post.id)!;
    expect(review.notes).toBe('Independent review notes');
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
    const anchored: any = await reader.callTool({ name: 'add_comment', arguments: { postId: crypto.randomUUID(), content: 'Denied', anchorHeading: 'Heading' } });
    expect(anchored.isError).toBe(true);
    expect(anchored.content[0].text).toContain('comments:write');
    const publication: any = await reader.callTool({ name: 'publish_post', arguments: { postId: crypto.randomUUID(), notes: 'Denied' } });
    expect(publication.isError).toBe(true);
    expect(publication.content[0].text).toContain('posts:publish');
    const other = await connect(identities[1].secret);
    const revoked = await fetch(`${apiUrl}/api/v1/pats/${limited.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${identities[0].secret}` } });
    expect(revoked.status).toBe(200);
    await expect(reader.listTools()).rejects.toThrow();
    expect((await other.listTools()).tools.length).toBeGreaterThan(0);
    const invalid = await fetch(mcpUrl, { method: 'POST', headers: { Authorization: 'Bearer invalid' } });
    expect(invalid.status).toBe(401);
  });
});
