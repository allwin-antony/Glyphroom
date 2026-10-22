import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CollabGatewayClient } from '../src/gateway/client.js';
import { CollabGatewayError } from '../src/gateway/types.js';

describe('CollabGatewayClient Suite', () => {
  const defaultOptions = {
    gatewayUrl: 'http://127.0.0.1:4000/internal/agent-gateway/edit',
    gatewaySecret: 'test-secret-key-32bytes',
    defaultUserId: 'user-default-1',
    defaultAgentId: 'agent-default-1',
    defaultTokenId: 'token-default-1',
    timeoutMs: 1000,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes gateway URL by ensuring /internal/agent-gateway/edit path', () => {
    const client = new CollabGatewayClient({
      ...defaultOptions,
      gatewayUrl: 'http://collab:4000',
    });
    expect((client as any).gatewayUrl).toBe('http://collab:4000/internal/agent-gateway/edit');
  });

  it('sends valid append_section request with correct headers and returns parsed response', async () => {
    const client = new CollabGatewayClient(defaultOptions);

    const mockResponse = {
      success: true,
      operation: 'append_section',
      documentId: 'post-100',
      appliedAt: 1729680000000,
      changesSummary: { insertions: 15, deletions: 0, hunksApplied: 1 },
      suggestionIds: ['sug-1'],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockResponse),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await client.sendEdit({
      operation: 'append_section',
      documentId: 'post-100',
      heading: 'New Heading',
      content: 'Appended content',
    });

    expect(res).toEqual(mockResponse);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:4000/internal/agent-gateway/edit');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Gateway-Secret']).toBe('test-secret-key-32bytes');
    expect(init.headers['X-User-Id']).toBe('user-default-1');
    expect(init.headers['X-Agent-Id']).toBe('agent-default-1');
    expect(init.headers['X-Token-Id']).toBe('token-default-1');
  });

  it('supports identity overrides per request', async () => {
    const client = new CollabGatewayClient(defaultOptions);

    const mockResponse = {
      success: true,
      operation: 'append_section',
      documentId: 'post-101',
      appliedAt: 1729680000000,
      changesSummary: { insertions: 10, deletions: 0 },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockResponse),
    });
    vi.stubGlobal('fetch', fetchMock);

    await client.sendEdit(
      {
        operation: 'append_section',
        documentId: 'post-101',
        content: 'Override content',
      },
      {
        userId: 'custom-user',
        agentId: 'custom-agent',
        tokenId: 'custom-token',
      }
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['X-User-Id']).toBe('custom-user');
    expect(init.headers['X-Agent-Id']).toBe('custom-agent');
    expect(init.headers['X-Token-Id']).toBe('custom-token');
  });

  it('rejects invalid payload upfront with VALIDATION_FAILED error', async () => {
    const client = new CollabGatewayClient(defaultOptions);

    await expect(
      client.sendEdit({
        operation: 'suggest_edit_section',
        documentId: 'post-102',
        // missing targetHeading and content
      } as any)
    ).rejects.toThrowError(CollabGatewayError);
  });

  it('handles gateway error responses with typed CollabGatewayError', async () => {
    const client = new CollabGatewayClient(defaultOptions);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () =>
        JSON.stringify({
          success: false,
          code: 'SECTION_NOT_FOUND',
          message: 'Target heading not found',
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      await client.sendEdit({
        operation: 'suggest_edit_section',
        documentId: 'post-103',
        targetHeading: 'Nonexistent',
        content: 'Replacement',
      });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(CollabGatewayError);
      expect(err.code).toBe('SECTION_NOT_FOUND');
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Target heading not found');
    }
  });

  it('handles network timeouts gracefully with TIMEOUT error code', async () => {
    const client = new CollabGatewayClient({
      ...defaultOptions,
      timeoutMs: 50,
    });

    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';

    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal('fetch', fetchMock);

    try {
      await client.sendEdit({
        operation: 'append_section',
        documentId: 'post-104',
        content: 'Timeout test',
      });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(CollabGatewayError);
      expect(err.code).toBe('TIMEOUT');
      expect(err.statusCode).toBe(504);
    }
  });

  it('handles non-JSON error responses without crashing', async () => {
    const client = new CollabGatewayClient(defaultOptions);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => '<html>Bad Gateway</html>',
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      await client.sendEdit({
        operation: 'append_section',
        documentId: 'post-105',
        content: 'HTML error test',
      });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(CollabGatewayError);
      expect(err.statusCode).toBe(502);
      expect(err.message).toContain('non-JSON response');
    }
  });
});
