import {
  formatPostForRead,
  type ReadPostOptions,
} from './read-formats.js';

export interface AuthenticatedActor {
  userId: string;
  tokenId: string;
  fullName: string;
  scopes: string[];
}

export function hasScope(scopes: string[], scope: string): boolean {
  const aliases: Record<string, string[]> = {
    'posts:read': ['post:read'],
    'posts:draft': ['posts:write', 'post:draft'],
    'posts:suggest': ['posts:write', 'post:suggest'],
    'comments:write': ['comment:write'],
    'posts:publish': ['post:publish'],
  };
  return [scope, ...(aliases[scope] || [])].some((value) => scopes.includes(value));
}

export interface ApiClientOptions {
  baseUrl: string;
  defaultUserId?: string;
  defaultToken?: string;
  actor?: AuthenticatedActor | null;
}

export interface PublicationReceipt {
  post: {
    id: string;
    status: 'published';
    publishedVersionId: string;
    publishedAt: string;
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ApiClient {
  private readonly baseUrl: string;
  private readonly defaultUserId: string;
  private readonly defaultToken?: string;
  private readonly actor?: AuthenticatedActor | null;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
    this.defaultUserId = options.defaultUserId || '00000000-0000-0000-0000-000000000001';
    this.defaultToken = options.defaultToken;
    this.actor = options.actor;
  }

  requireScope(scope: string): void {
    // Explicitly injected test/service clients can omit actor; runtime clients always set it.
    if (this.actor === undefined) return;
    if (!this.actor) throw Object.assign(new Error('Authentication required: configure a Glyphroom PAT in your MCP client.'), { status: 401, code: 'UNAUTHORIZED' });
    if (!hasScope(this.actor.scopes, scope)) {
      throw Object.assign(new Error(`Personal Access Token lacks "${scope}" scope.`), { status: 403, code: 'FORBIDDEN' });
    }
  }

  async getAuthContext(): Promise<AuthenticatedActor> {
    const res = await fetch(`${this.baseUrl}/api/v1/auth/me`, {
      headers: this.buildHeaders(), signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw Object.assign(new Error('Glyphroom PAT authentication failed.'), { status: res.status });
    const data: any = await res.json();
    if (data.auth?.type !== 'pat' || !data.auth.tokenId || !data.user?.userId || !Array.isArray(data.auth.scopes)) {
      throw Object.assign(new Error('Glyphroom API did not return PAT context. Update the API alongside the MCP server.'), { status: 502 });
    }
    return { userId: data.user.userId, tokenId: data.auth.tokenId, fullName: data.user.fullName, scopes: data.auth.scopes };
  }

  async resolveEditablePost(postId: string): Promise<string> {
    this.requireScope('posts:suggest');
    const data = await this.getPostDocument(postId);
    if (!['edit', 'admin'].includes(data.userPermission)) {
      throw Object.assign(new Error('You do not have permission to edit this post.'), { code: 'FORBIDDEN', status: 403 });
    }
    return data.post.id;
  }

  private async getPostDocument(postId: string, options: ReadPostOptions = {}): Promise<any> {
    const query = new URLSearchParams();
    if (options.format === 'prosemirror_json' || options.includeSuggestions) {
      query.set('format', 'prosemirror_json');
      query.set('includeSuggestions', String(options.includeSuggestions ?? false));
    }
    const queryString = query.toString();
    const res = await fetch(
      `${this.baseUrl}/api/v1/posts/${encodeURIComponent(postId)}${queryString ? `?${queryString}` : ''}`,
      { headers: this.buildHeaders(), signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) throw await this.responseError('Failed to retrieve post', res);
    return res.json();
  }

  private async responseError(prefix: string, response: Response): Promise<Error> {
    const body = await response.text().catch(() => '');
    let detail = body;
    let code: string | undefined;
    if (body) {
      try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed === 'object') {
          detail = typeof parsed.message === 'string'
            ? parsed.message
            : typeof parsed.error === 'string' ? parsed.error : body;
          if (typeof parsed.code === 'string') code = parsed.code;
        }
      } catch {
        // Preserve non-JSON API error text.
      }
    }
    const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    return Object.assign(
      new Error(`${prefix} (${status})${detail ? `: ${detail}` : ''}`),
      { status: response.status, ...(code ? { code } : {}) }
    );
  }

  private buildHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      ...customHeaders,
    };
    if (this.defaultToken) {
      headers['Authorization'] = `Bearer ${this.defaultToken}`;
    }
    return headers;
  }

  async searchPosts(params: {
    query: string;
    tags?: string[];
    coeId?: string;
    limit?: number;
    offset?: number;
  }): Promise<any> {
    this.requireScope('posts:read');
    const query = new URLSearchParams();
    query.set('search', params.query);
    for (const tag of params.tags ?? []) query.append('tags', tag);
    if (params.coeId !== undefined) query.set('coeId', params.coeId);
    query.set('limit', String(params.limit ?? 10));
    query.set('offset', String(params.offset ?? 0));

    const res = await fetch(`${this.baseUrl}/api/v1/posts?${query.toString()}`, {
      method: 'GET',
      headers: this.buildHeaders(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw await this.responseError('Failed to search posts', res);
    }
    const data: any = await res.json();
    if (!Array.isArray(data.posts) || !Number.isInteger(data.pagination?.total) || data.pagination.total < 0) {
      throw Object.assign(new Error('Glyphroom API returned an invalid search response.'), {
        status: 502,
        code: 'INVALID_API_RESPONSE',
      });
    }
    return {
      posts: data.posts.map((p: any) => {
        const author = p.author && typeof p.author === 'object' ? p.author : undefined;
        const authorId = author?.id ?? p.authorId;
        const authorName = author?.name ?? p.authorName;
        if (
          typeof p.id !== 'string' || typeof p.title !== 'string' || typeof p.slug !== 'string' ||
          (p.excerpt !== null && typeof p.excerpt !== 'string') || typeof p.status !== 'string' ||
          !Array.isArray(p.tags) || p.tags.some((tag: unknown) => typeof tag !== 'string') ||
          typeof authorId !== 'string' || typeof authorName !== 'string' || typeof p.updatedAt !== 'string'
        ) {
          throw Object.assign(new Error('Glyphroom API returned invalid post search metadata.'), {
            status: 502,
            code: 'INVALID_API_RESPONSE',
          });
        }
        return {
          id: p.id,
          title: p.title,
          slug: p.slug,
          excerpt: p.excerpt,
          status: p.status,
          ...(typeof p.coeName === 'string' ? { coeName: p.coeName } : {}),
          tags: [...p.tags],
          author: { id: authorId, name: authorName },
          updatedAt: p.updatedAt,
        };
      }),
      totalCount: data.pagination.total,
    };
  }

  async getPost(postId: string, options: ReadPostOptions = {}): Promise<any> {
    this.requireScope('posts:read');
    const normalizedOptions: ReadPostOptions = {
      format: options.format ?? 'markdown',
      includeSuggestions: options.includeSuggestions ?? false,
    };
    const data = await this.getPostDocument(postId, normalizedOptions);
    return formatPostForRead(data.post, normalizedOptions);
  }

  async createPost(params: { title: string; slug: string; content?: string; tags?: string[]; coeId?: string; excerpt?: string }): Promise<any> {
    this.requireScope('posts:draft');
    const res = await fetch(`${this.baseUrl}/api/v1/posts`, {
      method: 'POST',
      headers: this.buildHeaders({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        title: params.title,
        slug: params.slug,
        excerpt: params.excerpt,
        content: params.content,
        tags: params.tags,
        coeId: params.coeId,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Failed to create post (${res.status} ${res.statusText}): ${errBody}`);
    }
    return res.json();
  }

  async addComment(postId: string, params: { content: string; parentId?: string; anchorHeading?: string }): Promise<any> {
    this.requireScope('comments:write');
    const res = await fetch(`${this.baseUrl}/api/v1/posts/${postId}/comments`, {
      method: 'POST',
      headers: this.buildHeaders({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        content: params.content,
        parentId: params.parentId,
        anchorHeading: params.anchorHeading,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Failed to add comment (${res.status} ${res.statusText}): ${errBody}`);
    }
    return res.json();
  }

  async publishPost(postId: string, notes?: string): Promise<PublicationReceipt> {
    this.requireScope('posts:publish');
    const checkpoint = await fetch(
      `${this.baseUrl}/api/v1/posts/${encodeURIComponent(postId)}/publication-checkpoint`,
      { headers: this.buildHeaders(), signal: AbortSignal.timeout(10000) }
    );
    if (!checkpoint.ok) {
      throw await this.responseError('Failed to retrieve approved publication checkpoint', checkpoint);
    }
    const metadata: any = await checkpoint.json();
    const approved = metadata?.post;
    if (approved?.status !== 'approved' || typeof approved.id !== 'string' || !UUID_PATTERN.test(approved.id)
      || typeof approved.submittedVersionId !== 'string' || !UUID_PATTERN.test(approved.submittedVersionId)) {
      throw Object.assign(new Error('Post does not expose a valid approved submitted checkpoint.'), {
        status: 409,
        code: 'APPROVED_CHECKPOINT_UNAVAILABLE',
      });
    }
    const submittedVersionId = approved.submittedVersionId;
    const res = await fetch(`${this.baseUrl}/api/v1/posts/${encodeURIComponent(approved.id)}/publish`, {
      method: 'POST',
      headers: this.buildHeaders({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ submittedVersionId, ...(notes !== undefined ? { notes } : {}) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw await this.responseError('Failed to publish approved checkpoint', res);
    }
    const receipt: any = await res.json();
    if (receipt?.post?.id !== approved.id || receipt.post.status !== 'published'
      || receipt.post.publishedVersionId !== submittedVersionId || typeof receipt.post.publishedAt !== 'string') {
      throw Object.assign(new Error('Glyphroom API returned an invalid publication receipt.'), {
        status: 502,
        code: 'INVALID_API_RESPONSE',
      });
    }
    return receipt as PublicationReceipt;
  }
}
