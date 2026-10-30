export interface CollabFlushResult {
  inMemory: boolean;
  yjsState?: Uint8Array;
  workingMarkdown?: string;
}

export class CollabService {
  private readonly collabUrl: string;
  private readonly gatewaySecret: string;

  constructor(options: { collabUrl?: string; gatewaySecret?: string } = {}) {
    this.collabUrl = (
      options.collabUrl ||
      process.env.COLLAB_URL ||
      'http://127.0.0.1:4000'
    ).replace(/\/+$/, '');

    this.gatewaySecret =
      options.gatewaySecret ||
      process.env.COLLAB_GATEWAY_SECRET ||
      process.env.GATEWAY_SECRET ||
      'REPLACE_WITH_STRONG_GATEWAY_SECRET';
  }

  async flushDocument(postId: string): Promise<CollabFlushResult> {
    const docName = postId.startsWith('post-') ? postId : `post-${postId}`;
    try {
      const res = await fetch(`${this.collabUrl}/internal/documents/${docName}/flush`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gateway-secret': this.gatewaySecret,
        },
      });
      if (!res.ok) {
        return { inMemory: false };
      }
      const data: any = await res.json();
      if (data.inMemory && data.yjsState) {
        return {
          inMemory: true,
          yjsState: new Uint8Array(Buffer.from(data.yjsState, 'base64')),
          workingMarkdown: data.workingMarkdown,
        };
      }
      return { inMemory: false };
    } catch {
      // Graceful degradation if collab service is offline or in isolated test
      return { inMemory: false };
    }
  }

  async restoreDocument(postId: string, yjsStateSnapshot: Uint8Array): Promise<boolean> {
    const docName = postId.startsWith('post-') ? postId : `post-${postId}`;
    try {
      const res = await fetch(`${this.collabUrl}/internal/documents/${docName}/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gateway-secret': this.gatewaySecret,
        },
        body: JSON.stringify({
          yjsState: Buffer.from(yjsStateSnapshot).toString('base64'),
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async tombstoneDocument(postId: string): Promise<boolean> {
    const docName = postId.startsWith('post-') ? postId : `post-${postId}`;
    try {
      const res = await fetch(`${this.collabUrl}/internal/documents/${docName}/tombstone`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gateway-secret': this.gatewaySecret,
        },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
