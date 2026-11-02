import React from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SubmitReviewButton } from '../src/components/editor/SubmitReviewButton.js';
import { EditorView } from '../src/views/EditorView.js';
import { api, ApiError } from '../src/lib/api.js';

vi.mock('../src/lib/api.js', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/api.js')>('../src/lib/api.js');
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: vi.fn() }));
vi.mock('../src/context/AuthContext.js', () => ({ useAuth: () => ({ user: {
  userId: 'author', fullName: 'Author', role: 'author', email: 'author@example.com',
} }) }));
vi.mock('../src/components/Editor.js', () => ({ CollaborativeEditor: () => <div data-testid="editor" /> }));
vi.mock('../src/components/editor/OutlineRail.js', () => ({ OutlineRail: () => null }));
vi.mock('../src/components/editor/SaveStatusBadge.js', () => ({ SaveStatusBadge: () => null }));
vi.mock('../src/components/editor/AgentPresenceChip.js', () => ({ AgentPresenceChip: () => null }));
vi.mock('../src/components/editor/WordCountIndicator.js', () => ({ WordCountIndicator: () => null }));
vi.mock('../src/components/editor/DrawerPanel.js', () => ({ DrawerPanel: () => null }));

const postId = '11111111-1111-4111-8111-111111111111';
const pin = '22222222-2222-4222-8222-222222222222';
const replacementPin = '33333333-3333-4333-8333-333333333333';
const receipt = { post: {
  id: postId,
  status: 'published',
  publishedVersionId: pin,
  publishedAt: '2026-11-01T12:00:00.000Z',
} };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('approved publication checkpoint UI', () => {
  it('sends the exact displayed approved pin and accepts the minimal publication receipt', async () => {
    vi.mocked(api.post).mockResolvedValue(receipt);
    const onStatusChange = vi.fn();
    render(<SubmitReviewButton postId={postId} status="approved" submittedVersionId={pin}
      onStatusChange={onStatusChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/posts/${postId}/publish`,
      { submittedVersionId: pin }, expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(onStatusChange).toHaveBeenCalledWith('published');
  });

  it.each([undefined, '', 'not-a-uuid', '22222222-2222-2222-2222-222222222222'])(
    'fails closed without a valid displayed pin (%s)', async (submittedVersionId) => {
      render(<SubmitReviewButton postId={postId} status="approved" submittedVersionId={submittedVersionId} />);
      fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(/approved checkpoint is unavailable/i);
      expect(api.post).not.toHaveBeenCalled();
    }
  );

  it('does not refetch, substitute, or retry a stale checkpoint pin', async () => {
    vi.mocked(api.post).mockRejectedValue(new ApiError(409, 'Conflict', undefined, 'Approved checkpoint changed.'));
    render(<SubmitReviewButton postId={postId} status="approved" submittedVersionId={pin} />);

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Approved checkpoint changed.');
    expect(api.post).toHaveBeenCalledOnce();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('cancels a pending publication when the displayed checkpoint changes', async () => {
    const pending = deferred<typeof receipt>();
    vi.mocked(api.post).mockReturnValue(pending.promise);
    const onStatusChange = vi.fn();
    const rendered = render(<SubmitReviewButton postId={postId} status="approved" submittedVersionId={pin}
      onStatusChange={onStatusChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    const signal = vi.mocked(api.post).mock.calls[0][2]!.signal!;

    rendered.rerender(<SubmitReviewButton postId={postId} status="approved" submittedVersionId={replacementPin}
      onStatusChange={onStatusChange} />);
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(receipt));
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('submits published working edits through synchronized review instead of direct republish', async () => {
    vi.mocked(api.post).mockResolvedValue({ post: { status: 'in_review' } });
    const prepareSubmission = vi.fn().mockResolvedValue(undefined);
    render(<SubmitReviewButton postId={postId} status="published" hasPriorPublication
      prepareSubmission={prepareSubmission} />);

    fireEvent.click(screen.getByRole('button', { name: 'Submit Changes for Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Submit' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/posts/${postId}/submit-review`, undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(prepareSubmission).toHaveBeenCalledOnce();
    expect(vi.mocked(api.post).mock.calls.some(([url]) => url.includes('/republish'))).toBe(false);
  });

  it('uses the canonical post and republish alias for an exact empty checkpoint', async () => {
    const doc = new Y.Doc();
    vi.mocked(api.get).mockResolvedValue({ userPermission: 'edit', post: {
      id: postId,
      title: 'Approved revision',
      status: 'approved',
      submittedVersionId: pin,
      submittedVersion: { id: pin, versionNumber: 2, triggerReason: 'review_submission',
        markdownSnapshot: '', createdAt: '2026-11-01T11:00:00.000Z' },
      publishedMarkdown: '',
      yjsState: { data: [...Y.encodeStateAsUpdate(doc)] },
    } });
    doc.destroy();
    vi.mocked(HocuspocusProvider).mockImplementation(() => ({
      awareness: { clientID: 1, setLocalStateField: vi.fn() },
      destroy: vi.fn(),
    }) as any);
    vi.mocked(api.post).mockResolvedValue(receipt);

    render(<MemoryRouter initialEntries={['/posts/editor-slug/edit']}><Routes>
      <Route path="/posts/:id/edit" element={<EditorView />} />
    </Routes></MemoryRouter>);
    await screen.findByTestId('editor');
    fireEvent.click(screen.getByRole('button', { name: 'Republish' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/posts/${postId}/republish`,
      { submittedVersionId: pin }, expect.objectContaining({ signal: expect.any(AbortSignal) })));
  });
});
