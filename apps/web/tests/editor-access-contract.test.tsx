import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import * as Y from 'yjs';
import { EditorView } from '../src/views/EditorView.js';
import { api } from '../src/lib/api.js';

const mocks = vi.hoisted(() => ({ connections: [] as any[], user: {
  userId: 'user-1', fullName: 'Author', email: 'author@example.com', role: 'author',
} }));
vi.mock('../src/context/AuthContext.js', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../src/lib/api.js', () => ({ api: { get: vi.fn(), patch: vi.fn() }, ApiError: class extends Error {} }));
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: class {
  awareness = { clientID: 1, setLocalStateField: vi.fn() };
  destroy = vi.fn();
  constructor(public options: any) { mocks.connections.push(this); }
} }));
vi.mock('../src/components/Editor.js', () => ({ CollaborativeEditor: ({ ydoc }: { ydoc: Y.Doc }) =>
  <div data-testid="editor">{ydoc.getText('fixture').toString()}</div> }));
vi.mock('../src/components/editor/OutlineRail.js', () => ({ OutlineRail: () => null }));
vi.mock('../src/components/editor/SaveStatusBadge.js', () => ({ SaveStatusBadge: () => null }));
vi.mock('../src/components/editor/AgentPresenceChip.js', () => ({ AgentPresenceChip: () => null }));
vi.mock('../src/components/editor/WordCountIndicator.js', () => ({ WordCountIndicator: () => null }));
vi.mock('../src/components/editor/SubmitReviewButton.js', () => ({ SubmitReviewButton: () => null }));
vi.mock('../src/components/editor/DrawerPanel.js', () => ({ DrawerPanel: () => null }));

function response(permission = 'edit') {
  const doc = new Y.Doc();
  doc.getText('fixture').insert(0, 'Persisted editor document');
  const data = [...Y.encodeStateAsUpdate(doc)];
  doc.destroy();
  return { userPermission: permission, post: { id: '11111111-2222-3333-4444-555555555555', slug: 'slug-route',
    title: 'Editor contract', status: 'draft', yjsState: { type: 'Buffer', data } } };
}

function view() {
  return <MemoryRouter initialEntries={['/posts/slug-route/edit']}><Routes>
    <Route path="/posts/:id/edit" element={<EditorView />} />
  </Routes></MemoryRouter>;
}

describe('editor credential and capability contract', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.connections.length = 0; });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('waits for edit authorization, hydrates raw state, and connects to the canonical room using the session cookie', async () => {
    let resolve!: (value: any) => void;
    vi.mocked(api.get).mockReturnValue(new Promise((done) => { resolve = done; }));
    const rendered = render(view());
    expect(mocks.connections).toHaveLength(0);
    await act(async () => resolve(response()));
    await waitFor(() => expect(screen.getByTestId('editor').textContent).toBe('Persisted editor document'));
    const connection = mocks.connections[0];
    expect(connection.options.name).toBe('post-11111111-2222-3333-4444-555555555555');
    expect(connection.options).not.toHaveProperty('token');
    expect(connection.options.url).toMatch(/^ws.*\/ws$/);
    rendered.unmount();
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.options.document.isDestroyed).toBe(true);
  });

  it.each(['view', 'review', 'none'])('does not create a provider or mutable editor for %s permission', async (permission) => {
    vi.mocked(api.get).mockResolvedValue(response(permission));
    render(view());
    await screen.findByText(/Editing access is required/);
    expect(mocks.connections).toHaveLength(0);
    expect(screen.queryByTestId('editor')).toBeNull();
  });

  it('fails closed when collaboration authentication is rejected', async () => {
    vi.mocked(api.get).mockResolvedValue(response());
    render(view());
    await screen.findByTestId('editor');
    const connection = mocks.connections[0];
    fireEvent.change(screen.getByPlaceholderText('Untitled Post...'), { target: { value: 'Unauthorized pending title' } });
    act(() => connection.options.onAuthenticationFailed());
    await screen.findByText(/Collaboration authentication failed/);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('editor')).toBeNull();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('saves a pending title to its captured canonical post when navigating before the debounce fires', async () => {
    vi.mocked(api.get).mockResolvedValue(response());
    const rendered = render(view());
    await screen.findByTestId('editor');
    vi.useFakeTimers();
    fireEvent.change(screen.getByPlaceholderText('Untitled Post...'), { target: { value: 'Last title edit' } });
    expect(api.patch).not.toHaveBeenCalled();
    rendered.unmount();
    expect(api.patch).toHaveBeenCalledWith('/posts/11111111-2222-3333-4444-555555555555', { title: 'Last title edit' });
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it('does not open a room with corrupt or incomplete persisted editor state', async () => {
    const invalid = response();
    invalid.post.yjsState.data = [1];
    vi.mocked(api.get).mockResolvedValue(invalid);
    render(view());
    await screen.findByText(/working document could not be loaded/);
    expect(mocks.connections).toHaveLength(0);
  });
});
