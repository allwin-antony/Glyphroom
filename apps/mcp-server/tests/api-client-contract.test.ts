import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { ApiClient, type AuthenticatedActor } from '../src/api/client.js';

interface CapturedRequest {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const actor = (scopes: string[]): AuthenticatedActor => ({
  userId: 'caller-user',
  tokenId: 'caller-token',
  fullName: 'Caller',
  scopes,
});

const servers: http.Server[] = [];

async function createStub(
  respond: (request: CapturedRequest, response: http.ServerResponse) => void
): Promise<{ baseUrl: string; requests: CapturedRequest[] }> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const captured = { method: request.method, url: request.url, headers: request.headers, body };
    requests.push(captured);
    respond(captured, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return { baseUrl: `http://127.0.0.1:${address.port}/api/v1`, requests };
}

function sendJson(response: http.ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('ApiClient frozen HTTP contract', () => {
  it('forwards exact search, repeated tags, COE, limit, offset and caller PAT without local filtering', async () => {
    const { baseUrl, requests } = await createStub((_request, response) => sendJson(response, {
      posts: [{
        id: 'older-authorized-post',
        title: 'Server-selected result outside the first catalog page',
        slug: 'older-authorized-post',
        excerpt: null,
        status: 'published',
        coeName: 'Platform Engineering',
        tags: ['architecture', 'internal docs'],
        authorId: 'author-42',
        authorName: 'Ada Lovelace',
        updatedAt: '2026-01-02T03:04:05.000Z',
      }],
      pagination: {
        page: 2,
        limit: 1,
        offset: 1,
        total: 37,
        totalPages: 37,
        hasNextPage: true,
      },
    }));
    const client = new ApiClient({
      baseUrl,
      defaultToken: 'caller-local-pat',
      actor: actor(['posts:read']),
    });

    const result = await client.searchPosts({
      query: '  older / match?  ',
      tags: ['architecture', 'internal docs'],
      coeId: '11111111-1111-4111-8111-111111111111',
      limit: 1,
      offset: 1,
    });

    expect(requests).toHaveLength(1);
    const requestUrl = new URL(requests[0].url!, 'http://stub.test');
    expect(requestUrl.pathname).toBe('/api/v1/posts');
    expect(requestUrl.searchParams.get('search')).toBe('  older / match?  ');
    expect(requestUrl.searchParams.getAll('tags')).toEqual(['architecture', 'internal docs']);
    expect(requestUrl.searchParams.get('coeId')).toBe('11111111-1111-4111-8111-111111111111');
    expect(requestUrl.searchParams.get('limit')).toBe('1');
    expect(requestUrl.searchParams.get('offset')).toBe('1');
    expect(requestUrl.searchParams.has('page')).toBe(false);
    expect(requests[0].headers.authorization).toBe('Bearer caller-local-pat');
    expect(result).toEqual({
      posts: [{
        id: 'older-authorized-post',
        title: 'Server-selected result outside the first catalog page',
        slug: 'older-authorized-post',
        excerpt: null,
        status: 'published',
        coeName: 'Platform Engineering',
        tags: ['architecture', 'internal docs'],
        author: { id: 'author-42', name: 'Ada Lovelace' },
        updatedAt: '2026-01-02T03:04:05.000Z',
      }],
      totalCount: 37,
    });
  });

  it('uses an explicit non-page-aligned offset to reach matches beyond the default 24 results', async () => {
    const { baseUrl, requests } = await createStub((_request, response) => sendJson(response, {
      posts: [{
        id: 'result-26',
        title: 'Older needle',
        slug: 'result-26',
        excerpt: 'Found by server-side search',
        status: 'published',
        tags: ['older'],
        author: { id: 'author-26', name: 'Real Author' },
        updatedAt: '2025-02-03T00:00:00.000Z',
      }],
      pagination: {
        page: 3,
        limit: 10,
        offset: 25,
        total: 31,
        totalPages: 4,
        hasNextPage: false,
      },
    }));
    const client = new ApiClient({ baseUrl, defaultToken: 'pat', actor: actor(['posts:read']) });

    const result = await client.searchPosts({ query: 'needle', limit: 10, offset: 25 });

    const requestUrl = new URL(requests[0].url!, 'http://stub.test');
    expect(requestUrl.searchParams.get('offset')).toBe('25');
    expect(requestUrl.searchParams.get('limit')).toBe('10');
    expect(requestUrl.searchParams.has('page')).toBe(false);
    expect(result.posts.map((post: any) => post.id)).toEqual(['result-26']);
    expect(result.totalCount).toBe(31);
  });

  it.each([
    ['omitted', undefined], ['empty', ''], ['text', '  Publisher notes\n'], ['limit', 'n'.repeat(2000)],
  ])('loads one approved active pin and publishes precisely it with %s notes and the caller-local scope alias', async (_case, notes) => {
    const postId = '11111111-1111-4111-8111-111111111111';
    const pin = '22222222-2222-4222-8222-222222222222';
    const publication = { post: { id: postId, status: 'published', publishedVersionId: pin,
      publishedAt: '2026-11-01T12:00:00.000Z' } };
    const { baseUrl, requests } = await createStub((request, response) => {
      if (request.method === 'GET') {
        sendJson(response, { post: { id: postId, status: 'approved', submittedVersionId: pin } });
      } else {
        sendJson(response, publication);
      }
    });
    const client = new ApiClient({
      baseUrl,
      defaultToken: 'publisher-pat',
      actor: actor(['post:publish']),
    });

    const result = await client.publishPost(postId, notes);

    expect(requests).toHaveLength(2);
    expect(requests[0].method).toBe('GET');
    expect(requests[0].url).toBe(`/api/v1/posts/${postId}/publication-checkpoint`);
    expect(requests[0].headers.authorization).toBe('Bearer publisher-pat');
    expect(requests[1].method).toBe('POST');
    expect(requests[1].url).toBe(`/api/v1/posts/${postId}/publish`);
    expect(requests[1].headers.authorization).toBe('Bearer publisher-pat');
    expect(requests[1].headers['content-type']).toBe('application/json');
    expect(JSON.parse(requests[1].body)).toEqual({ submittedVersionId: pin, ...(notes !== undefined ? { notes } : {}) });
    expect(result).toEqual(publication);
  });

  it.each([
    ['omitted', undefined], ['empty', ''], ['label', '  **Visible Heading**  '],
  ])('sends the %s anchorHeading on the comment HTTP body without requiring post-read scope', async (_case, anchorHeading) => {
    const { baseUrl, requests } = await createStub((_request, response) => sendJson(response, { comment: { id: 'comment-1' } }, 201));
    const client = new ApiClient({ baseUrl, defaultToken: 'commenter-pat', actor: actor(['comment:write']) });

    expect(await client.addComment('post-1', { content: 'Question', parentId: 'parent-1', anchorHeading })).toEqual({ comment: { id: 'comment-1' } });

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('POST');
    expect(requests[0].url).toBe('/api/v1/posts/post-1/comments');
    expect(requests[0].headers.authorization).toBe('Bearer commenter-pat');
    expect(JSON.parse(requests[0].body)).toEqual({ content: 'Question', parentId: 'parent-1',
      ...(anchorHeading !== undefined ? { anchorHeading } : {}) });
  });

  it('does not let heading or notes arguments bypass caller-local write scopes', async () => {
    const { baseUrl, requests } = await createStub((_request, response) => sendJson(response, {}));
    const client = new ApiClient({ baseUrl, actor: actor(['posts:read']) });
    await expect(client.addComment('post-1', { content: 'Question', anchorHeading: 'Heading' })).rejects.toMatchObject({ status: 403 });
    await expect(client.publishPost('post-1', 'Notes')).rejects.toMatchObject({ status: 403 });
    expect(requests).toHaveLength(0);
  });

  it.each([
    ['missing pin', { id: '11111111-1111-4111-8111-111111111111', status: 'approved' }],
    ['null pin', { id: '11111111-1111-4111-8111-111111111111', status: 'approved', submittedVersionId: null }],
    ['invalid pin', { id: '11111111-1111-4111-8111-111111111111', status: 'approved', submittedVersionId: 'latest' }],
    ['invalid post ID', { id: 'not-a-uuid', status: 'approved',
      submittedVersionId: '22222222-2222-4222-8222-222222222222' }],
    ['not approved', { id: '11111111-1111-4111-8111-111111111111', status: 'in_review',
      submittedVersionId: '22222222-2222-4222-8222-222222222222' }],
  ])('fails closed on %s without attempting publication', async (_case, post) => {
    const { baseUrl, requests } = await createStub((_request, response) => sendJson(response, { post }));
    const client = new ApiClient({ baseUrl, actor: actor(['posts:publish']) });

    await expect(client.publishPost(post.id)).rejects.toMatchObject({ code: 'APPROVED_CHECKPOINT_UNAVAILABLE' });

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('GET');
    expect(requests[0].url).toBe(`/api/v1/posts/${post.id}/publication-checkpoint`);
  });

  it('does not refetch or retry when the exact pin is stale at publication time', async () => {
    const postId = '11111111-1111-4111-8111-111111111111';
    const pin = '22222222-2222-4222-8222-222222222222';
    const { baseUrl, requests } = await createStub((request, response) => {
      if (request.method === 'GET') {
        sendJson(response, { post: { id: postId, status: 'approved', submittedVersionId: pin } });
      } else {
        sendJson(response, { error: 'Conflict', message: 'Approved review checkpoint changed or unavailable' }, 409);
      }
    });
    const client = new ApiClient({ baseUrl, actor: actor(['posts:publish']) });

    await expect(client.publishPost(postId, 'Stale attempt notes')).rejects.toThrow('Approved review checkpoint changed or unavailable');

    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ['GET', `/api/v1/posts/${postId}/publication-checkpoint`],
      ['POST', `/api/v1/posts/${postId}/publish`],
    ]);
    expect(JSON.parse(requests[1].body)).toEqual({ submittedVersionId: pin, notes: 'Stale attempt notes' });
  });

  it('rejects a substituted or incomplete minimal publication receipt without retrying', async () => {
    const postId = '11111111-1111-4111-8111-111111111111';
    const pin = '22222222-2222-4222-8222-222222222222';
    const { baseUrl, requests } = await createStub((request, response) => sendJson(response,
      request.method === 'GET'
        ? { post: { id: postId, status: 'approved', submittedVersionId: pin } }
        : { post: { id: postId, status: 'published', publishedVersionId: '33333333-3333-4333-8333-333333333333' } }));
    const client = new ApiClient({ baseUrl, actor: actor(['posts:publish']) });

    await expect(client.publishPost(postId)).rejects.toMatchObject({ code: 'INVALID_API_RESPONSE' });
    expect(requests.map((request) => request.method)).toEqual(['GET', 'POST']);
  });
});
