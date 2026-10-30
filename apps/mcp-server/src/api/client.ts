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

  private async getPostDocument(postId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/posts/${postId}`, { headers: this.buildHeaders(), signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw Object.assign(new Error(`Post not found or access denied: ${res.statusText}`), { status: res.status });
    return res.json();
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

  async searchPosts(params: { query: string; limit?: number; offset?: number }): Promise<any> {
    this.requireScope('posts:read');
    const res = await fetch(`${this.baseUrl}/api/v1/posts`, {
      method: 'GET',
      headers: this.buildHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to search posts: ${res.statusText}`);
    }
    const data: any = await res.json();
    const queryLower = params.query.toLowerCase();
    const filtered = (data.posts || []).filter((p: any) =>
      p.title.toLowerCase().includes(queryLower) || (p.excerpt && p.excerpt.toLowerCase().includes(queryLower))
    );
    return {
      posts: filtered.map((p: any) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        excerpt: p.excerpt,
        status: p.status,
        tags: [],
        author: { id: p.authorId, name: 'Author' },
        updatedAt: p.updatedAt || new Date().toISOString(),
      })),
      totalCount: filtered.length,
    };
  }

  async getPost(postId: string): Promise<any> {
    this.requireScope('posts:read');
    const data = await this.getPostDocument(postId);
    const post = data.post;
    return {
      id: post.id,
      title: post.title,
      slug: post.slug,
      status: post.status,
      author: { id: post.authorId, name: post.authorName || 'Author' },
      content: post.derivedMarkdown || post.publishedMarkdown || post.workingMarkdown || `# ${post.title}\n\nDraft content.`,
      format: 'markdown' as const,
      headings: [post.title],
      tags: post.tags || [],
      publishedAt: post.publishedAt,
      updatedAt: post.updatedAt || new Date().toISOString(),
    };
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

  async addComment(postId: string, params: { content: string; parentId?: string }): Promise<any> {
    this.requireScope('comments:write');
    const res = await fetch(`${this.baseUrl}/api/v1/posts/${postId}/comments`, {
      method: 'POST',
      headers: this.buildHeaders({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        content: params.content,
        parentId: params.parentId,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Failed to add comment (${res.status} ${res.statusText}): ${errBody}`);
    }
    return res.json();
  }

  async publishPost(postId: string): Promise<any> {
    this.requireScope('posts:publish');
    const res = await fetch(`${this.baseUrl}/api/v1/posts/${postId}/publish`, {
      method: 'POST',
      headers: this.buildHeaders({
        'Content-Type': 'application/json',
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Failed to publish post (${res.status} ${res.statusText}): ${errBody}`);
    }
    return res.json();
  }
}
