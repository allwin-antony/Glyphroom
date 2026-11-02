import React from 'react';
import { EventEmitter } from 'node:events';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { waitForCollabSync } from '../src/lib/collab-sync.js';
import { SubmitReviewButton } from '../src/components/editor/SubmitReviewButton.js';
import { api } from '../src/lib/api.js';
import { EditorView } from '../src/views/EditorView.js';

vi.mock('../src/lib/api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() }, ApiError: class extends Error {} }));
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

class Provider extends EventEmitter {
  document = { isDestroyed: false };
  configuration = { websocketProvider: { status: 'connected' } };
  isAttached = true;
  isAuthenticated = true;
  isSynced = true;
  hasUnsyncedChanges = true;
  flushPendingUpdates = vi.fn();
  destroy() { this.emit('destroy'); }
  acknowledge() { this.hasUnsyncedChanges = false; this.emit('unsyncedChanges', { number: 0 }); }
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('acknowledged collaboration update barrier', () => {
  it('waits beyond initial handshake until pending local updates are acknowledged, then removes listeners', async () => {
    const provider = new Provider();
    const done = vi.fn();
    const waiting = waitForCollabSync(provider as any).then(done);
    provider.emit('synced', { state: true });
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    expect(provider.flushPendingUpdates).toHaveBeenCalledOnce();
    provider.acknowledge();
    await waiting;
    expect(done).toHaveBeenCalledOnce();
    expect(provider.eventNames()).toEqual([]);
  });

  it.each(['disconnect', 'close', 'destroy', 'authenticationFailed'])('fails closed on %s and cleans up', async (event) => {
    const provider = new Provider();
    const waiting = waitForCollabSync(provider as any);
    provider.emit(event);
    await expect(waiting).rejects.toThrow('Reconnect before submitting');
    expect(provider.eventNames()).toEqual([]);
  });

  it('requires authentication as well as sync and fails after a bounded timeout', async () => {
    vi.useFakeTimers();
    const provider = new Provider();
    provider.hasUnsyncedChanges = false;
    provider.isAuthenticated = false;
    const waiting = waitForCollabSync(provider as any, { timeoutMs: 100 });
    const rejected = expect(waiting).rejects.toThrow('latest edits have not synced');
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(provider.eventNames()).toEqual([]);
  });

  it('cancels without waiting for the timeout', async () => {
    const provider = new Provider();
    const controller = new AbortController();
    const waiting = waitForCollabSync(provider as any, { signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toThrow('canceled');
    expect(provider.eventNames()).toEqual([]);
  });
});

describe('submit request ordering', () => {
  function confirm() {
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Submit' }));
  }

  it('sends the submission only after pending updates are acknowledged', async () => {
    const provider = new Provider();
    vi.mocked(api.post).mockResolvedValue({ post: { status: 'in_review' } });
    const onStatusChange = vi.fn();
    render(<SubmitReviewButton postId="canonical-id" status="draft" onStatusChange={onStatusChange}
      prepareSubmission={(signal) => waitForCollabSync(provider as any, { signal })} />);
    confirm();
    expect(api.post).not.toHaveBeenCalled();
    await act(async () => provider.acknowledge());
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/posts/canonical-id/submit-review', undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(onStatusChange).toHaveBeenCalledWith('in_review');
  });

  it('never submits after a connection failure or absent preparation callback', async () => {
    const provider = new Provider();
    const rendered = render(<SubmitReviewButton postId="canonical-id" status="draft"
      prepareSubmission={(signal) => waitForCollabSync(provider as any, { signal })} />);
    confirm();
    await act(async () => { provider.emit('disconnect'); });
    await screen.findByText(/Collaboration disconnected/);
    expect(api.post).not.toHaveBeenCalled();
    rendered.unmount();
    render(<SubmitReviewButton postId="canonical-id" status="draft" />);
    confirm();
    await screen.findByText(/Connect to the collaborative editor/);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('cancels pending preparation when leaving the editor', async () => {
    const provider = new Provider();
    const rendered = render(<SubmitReviewButton postId="canonical-id" status="draft"
      prepareSubmission={(signal) => waitForCollabSync(provider as any, { signal })} />);
    confirm();
    await act(async () => { rendered.unmount(); });
    provider.acknowledge();
    expect(api.post).not.toHaveBeenCalled();
    expect(provider.eventNames()).toEqual([]);
  });

  it('ignores late POST responses after navigation even if the transport ignores cancellation', async () => {
    let resolve!: (value: any) => void;
    vi.mocked(api.post).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const oldStatus = vi.fn();
    const nextStatus = vi.fn();
    const rendered = render(<SubmitReviewButton postId="old-post" status="draft" onStatusChange={oldStatus}
      prepareSubmission={async () => {}} />);
    confirm();
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    const signal = vi.mocked(api.post).mock.calls[0][2]!.signal!;
    rendered.rerender(<SubmitReviewButton postId="next-post" status="draft" onStatusChange={nextStatus}
      prepareSubmission={async () => {}} />);
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ post: { status: 'in_review' } }));
    expect(oldStatus).not.toHaveBeenCalled();
    expect(nextStatus).not.toHaveBeenCalled();
  });

  it.each([false, true])('awaits an already-dispatched title PATCH before capture (save fails: %s)', async (fail) => {
    const doc = new Y.Doc();
    vi.mocked(api.get).mockResolvedValue({ userPermission: 'edit', post: { id: 'canonical-id', title: 'Initial title',
      status: 'draft', yjsState: { data: [...Y.encodeStateAsUpdate(doc)] } } });
    doc.destroy();
    vi.mocked(HocuspocusProvider).mockImplementation((options: any) => {
      const provider = new Provider();
      provider.document = options.document;
      provider.hasUnsyncedChanges = false;
      return provider as any;
    });
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    vi.mocked(api.patch).mockReturnValueOnce(new Promise<void>((done, failed) => { resolve = done; reject = failed; }));
    vi.mocked(api.post).mockResolvedValue({ post: { status: 'in_review' } });
    const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<MemoryRouter initialEntries={['/posts/canonical-id/edit']}><Routes>
      <Route path="/posts/:id/edit" element={<EditorView />} />
    </Routes></MemoryRouter>);
    await screen.findByTestId('editor');
    vi.useFakeTimers();
    fireEvent.change(screen.getByPlaceholderText('Untitled Post...'), { target: { value: 'Pending title' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(api.patch).toHaveBeenCalledOnce();
    confirm();
    await act(async () => {});
    expect(api.post).not.toHaveBeenCalled();
    await act(async () => { if (fail) reject(new Error('Title save failed')); else resolve(); });
    if (fail) {
      expect(screen.getByText('Title save failed')).toBeDefined();
      expect(api.post).not.toHaveBeenCalled();
    } else {
      expect(api.post).toHaveBeenCalledOnce();
    }
    warning.mockRestore();
  });

  it('does not let a previous post’s deferred or failed title save block the next editor’s submission', async () => {
    vi.mocked(api.get).mockImplementation(async (url) => ({ userPermission: 'edit', post: {
      id: url.includes('post-b') ? 'post-b' : 'post-a', title: url.includes('post-b') ? 'Title B' : 'Title A',
      status: 'draft', yjsState: { data: [0, 0] },
    } }));
    vi.mocked(HocuspocusProvider).mockImplementation((options: any) => {
      const provider = new Provider();
      provider.document = options.document;
      provider.hasUnsyncedChanges = false;
      return provider as any;
    });
    let reject!: (error: Error) => void;
    vi.mocked(api.patch).mockReturnValueOnce(new Promise((_done, failed) => { reject = failed; }));
    vi.mocked(api.post).mockResolvedValue({ post: { status: 'in_review' } });
    const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
    function NavigateToB() {
      const navigate = useNavigate();
      return <button onClick={() => navigate('/posts/post-b/edit')}>Go to B</button>;
    }
    render(<MemoryRouter initialEntries={['/posts/post-a/edit']}><NavigateToB /><Routes>
      <Route path="/posts/:id/edit" element={<EditorView />} />
    </Routes></MemoryRouter>);
    await screen.findByTestId('editor');
    vi.useFakeTimers();
    fireEvent.change(screen.getByPlaceholderText('Untitled Post...'), { target: { value: 'Pending A' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(api.patch).toHaveBeenCalledOnce();
    await act(async () => fireEvent.click(screen.getByText('Go to B')));
    expect((screen.getByPlaceholderText('Untitled Post...') as HTMLInputElement).value).toBe('Title B');
    confirm();
    await act(async () => {});
    expect(api.post).toHaveBeenCalledWith('/posts/post-b/submit-review', undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await act(async () => reject(new Error('A is no longer editable')));
    expect(screen.queryByText('A is no longer editable')).toBeNull();
    expect(screen.getByText('In Review')).toBeDefined();
    expect(api.patch).toHaveBeenCalledOnce();
    warning.mockRestore();
  });
});
