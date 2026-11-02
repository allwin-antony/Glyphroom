import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReviewQueueView } from '../src/views/ReviewQueueView.js';
import { api } from '../src/lib/api.js';

vi.mock('../src/lib/api.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../src/context/AuthContext.js', () => ({ useAuth: () => ({ user: { userId: 'reviewer', role: 'moderator' } }) }));

const catalog = { id: '11111111-1111-4111-8111-111111111111', slug: 'review-target', title: 'Review target', status: 'in_review',
  authorId: 'author', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  workingMarkdown: 'WORKING_MUST_NOT_BE_REVIEWED', publishedMarkdown: 'PUBLICATION_MUST_NOT_BE_REVIEWED', excerpt: 'METADATA_IS_NOT_THE_CHECKPOINT' };
const pin = '22222222-2222-4222-8222-222222222222';
function detail(markdown = 'VALID_SUBMITTED_CHECKPOINT', id = catalog.id, versionId = pin) {
  return { userPermission: 'review', post: { ...catalog, id, submittedVersionId: versionId, derivedMarkdown: catalog.workingMarkdown,
    submittedVersion: { id: versionId, versionNumber: 1, triggerReason: 'review_submission', markdownSnapshot: markdown, createdAt: catalog.createdAt } } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function open() {
  render(<MemoryRouter><ReviewQueueView /></MemoryRouter>);
  const button = await screen.findByText('Review Post');
  await act(async () => fireEvent.click(button));
  return within(screen.getByRole('dialog'));
}
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('trusted submitted-checkpoint review UI', () => {
  it('blocks decisions while details load and preserves a valid empty submission without body fallback', async () => {
    const pending = deferred<ReturnType<typeof detail>>();
    vi.mocked(api.get).mockImplementation((url) => url.startsWith('/posts?') ? Promise.resolve({ posts: [catalog], pagination: { page: 1, limit: 24, total: 1, totalPages: 1, hasNextPage: false } }) : pending.promise);
    vi.mocked(api.post).mockResolvedValue({ review: { id: 'decision' } });
    const modal = await open();
    expect(modal.getByText('Loading submitted checkpoint...')).toBeDefined();
    expect((modal.getByText('Approve Submission').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect(modal.queryByText(catalog.workingMarkdown)).toBeNull();
    await act(async () => pending.resolve(detail('')));
    expect(modal.getByTestId('review-checkpoint').textContent).toBe('This submitted checkpoint is empty.');
    expect(modal.queryByText(catalog.publishedMarkdown)).toBeNull();
    expect(modal.queryByText(catalog.excerpt)).toBeNull();
    await act(async () => fireEvent.click(modal.getByText('Approve Submission')));
    expect(api.post).toHaveBeenCalledWith(`/posts/${catalog.id}/reviews`,
      { decision: 'approved', notes: undefined, submittedVersionId: pin }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('discards failed detail loads instead of approving the catalog object', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url.startsWith('/posts?')) return { posts: [catalog], pagination: { page: 1, limit: 24, total: 1, totalPages: 1, hasNextPage: false } };
      throw new Error('Checkpoint access denied');
    });
    const modal = await open();
    await modal.findByText('Checkpoint access denied');
    expect(modal.queryByTestId('review-checkpoint')).toBeNull();
    fireEvent.click(modal.getByText('Approve Submission'));
    expect(api.post).not.toHaveBeenCalled();
    expect((modal.getByText('Publish to Catalog').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it.each(['missing', 'mismatch', 'kind', 'wrong-post'])('rejects %s checkpoint details without fallback', async (failure) => {
    const response: any = detail();
    if (failure === 'missing') response.post.submittedVersion = null;
    if (failure === 'mismatch') response.post.submittedVersionId = 'other-id';
    if (failure === 'kind') response.post.submittedVersion.triggerReason = 'manual_save';
    if (failure === 'wrong-post') response.post.id = 'other-post';
    vi.mocked(api.get).mockImplementation(async (url) => url.startsWith('/posts?') ? { posts: [catalog], pagination: { page: 1, limit: 24, total: 1, totalPages: 1, hasNextPage: false } } : response);
    const modal = await open();
    await modal.findByText(/submitted checkpoint is unavailable/);
    expect(modal.queryByTestId('review-checkpoint')).toBeNull();
    expect(modal.queryByText(catalog.workingMarkdown)).toBeNull();
    expect((modal.getByText('Approve Submission').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('ignores a late previous detail response and binds the decision to the currently displayed post', async () => {
    const first = deferred<ReturnType<typeof detail>>();
    const other = { ...catalog, id: '33333333-3333-4333-8333-333333333333', title: 'Other target' };
    const otherPin = '44444444-4444-4444-8444-444444444444';
    vi.mocked(api.get).mockImplementation(async (url) => url.startsWith('/posts?') ? { posts: [catalog, other], pagination: { page: 1, limit: 24, total: 2, totalPages: 1, hasNextPage: false } }
      : url.includes(other.id) ? detail('SECOND_CHECKPOINT', other.id, otherPin) : first.promise);
    vi.mocked(api.post).mockResolvedValue({ review: { id: 'decision' } });
    render(<MemoryRouter><ReviewQueueView /></MemoryRouter>);
    const buttons = await screen.findAllByText('Review Post');
    fireEvent.click(buttons[0]);
    fireEvent.click(screen.getByLabelText('Close review modal'));
    fireEvent.click(buttons[1]);
    await screen.findByText('SECOND_CHECKPOINT');
    await act(async () => first.resolve(detail('STALE_FIRST_CHECKPOINT')));
    expect(screen.queryByText('STALE_FIRST_CHECKPOINT')).toBeNull();
    await act(async () => fireEvent.click(screen.getByText('Approve Submission')));
    expect(api.post).toHaveBeenCalledWith(`/posts/${other.id}/reviews`,
      { decision: 'approved', notes: undefined, submittedVersionId: otherPin }, expect.any(Object));
  });

  it('invalidates a stale decision after conflict and requires reloading the checkpoint', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => url.startsWith('/posts?') ? { posts: [catalog], pagination: { page: 1, limit: 24, total: 1, totalPages: 1, hasNextPage: false } } : detail());
    vi.mocked(api.post).mockRejectedValueOnce(new Error('Checkpoint changed. Reload before deciding.'));
    const modal = await open();
    await modal.findByText('VALID_SUBMITTED_CHECKPOINT');
    await act(async () => fireEvent.click(modal.getByText('Approve Submission')));
    expect(modal.queryByTestId('review-checkpoint')).toBeNull();
    expect(modal.getByText('Reload checkpoint')).toBeDefined();
    expect((modal.getByText('Approve Submission').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
