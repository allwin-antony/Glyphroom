export interface ApiClientOptions {
  baseUrl: string;
  defaultUserId?: string;
  defaultToken?: string;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly defaultUserId: string;
  private readonly defaultToken?: string;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.defaultUserId = options.defaultUserId || '00000000-0000-0000-0000-000000000001';
    this.defaultToken = options.defaultToken;
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
    const res = await fetch(`${this.baseUrl}/api/v1/posts/${postId}`, {
      method: 'GET',
      headers: this.buildHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Post not found or access denied: ${res.statusText}`);
    }
    const data: any = await res.json();
    const post = data.post;
    return {
      id: post.id,
      title: post.title,
      slug: post.slug,
      status: post.status,
      author: { id: post.authorId, name: 'Author' },
      content: post.workingMarkdown || post.publishedMarkdown || `# ${post.title}\n\nDraft content.`,
      format: 'markdown' as const,
      headings: [post.title],
      tags: [],
      publishedAt: post.publishedAt,
      updatedAt: post.updatedAt || new Date().toISOString(),
    };
  }

  async createPost(params: { title: string; slug: string; excerpt?: string }): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/v1/posts`, {
      method: 'POST',
      headers: this.buildHeaders({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        title: params.title,
        slug: params.slug,
        excerpt: params.excerpt,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Failed to create post (${res.status} ${res.statusText}): ${errBody}`);
    }
    return res.json();
  }

  async addComment(postId: string, params: { content: string; parentId?: string }): Promise<any> {
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
