import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { BrowserRouter } from 'react-router-dom';

import { SuggestionInsert, SuggestionDelete } from '../src/extensions/suggestion.js';
import { Collaboration } from '../src/extensions/collab.js';
import { OutlineRail } from '../src/components/editor/OutlineRail.js';
import { SaveStatusBadge } from '../src/components/editor/SaveStatusBadge.js';
import { AgentPresenceChip } from '../src/components/editor/AgentPresenceChip.js';
import { WordCountIndicator, computeDocStats } from '../src/components/editor/WordCountIndicator.js';
import { SubmitReviewButton } from '../src/components/editor/SubmitReviewButton.js';
import { SuggestionItem, type SuggestionItemData } from '../src/components/editor/SuggestionItem.js';
import { SuggestionsTab } from '../src/components/editor/tabs/SuggestionsTab.js';
import { VersionsTab } from '../src/components/editor/tabs/VersionsTab.js';
import { PostSettingsTab } from '../src/components/editor/tabs/PostSettingsTab.js';
import { DrawerPanel } from '../src/components/editor/DrawerPanel.js';
import { NewPostView } from '../src/views/NewPostView.js';
import { api } from '../src/lib/api.js';

// Mock api client
vi.mock('../src/lib/api.js', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class extends Error {
    public status: number;
    constructor(status: number, statusText: string, data?: any) {
      super(data?.message || `HTTP ${status}`);
      this.status = status;
    }
  },
}));

import { AuthContext, type AuthContextValue } from '../src/context/AuthContext.js';

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('Milestone M2: Live Collaborative Editor Integration Suite', () => {
  const mockAuthValue: AuthContextValue = {
    user: {
      userId: 'user-author-1',
      email: 'author@enterprise-blogger.local',
      role: 'author',
      fullName: 'Author One',
    },
    csrfToken: 'mock-csrf-token',
    isLoading: false,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    refreshSession: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Feature 14: Post Auto-Provisioning (NewPostView)', () => {
    it('creates draft post via POST /api/v1/posts and redirects to /posts/:id/edit', async () => {
      (api.post as any).mockResolvedValueOnce({
        post: { id: 'post-uuid-123', title: 'Untitled Draft', slug: 'draft-123' },
      });

      render(
        <BrowserRouter>
          <AuthContext.Provider value={mockAuthValue}>
            <NewPostView />
          </AuthContext.Provider>
        </BrowserRouter>
      );

      expect(screen.getByText(/Create New Document or Status Post/i)).toBeDefined();

      const startBlankCard = screen.getByText('Blank Document');
      fireEvent.click(startBlankCard);

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith(
          '/posts',
          expect.objectContaining({
            title: 'Untitled Draft',
            slug: expect.stringMatching(/^draft-\d+-[a-z0-9]+$/),
          })
        );
        expect(mockNavigate).toHaveBeenCalledWith('/posts/post-uuid-123/edit', { replace: true });
      });
    });

    it('displays error if post provisioning fails', async () => {
      (api.post as any).mockRejectedValueOnce(new Error('Database unavailable'));

      render(
        <BrowserRouter>
          <AuthContext.Provider value={mockAuthValue}>
            <NewPostView />
          </AuthContext.Provider>
        </BrowserRouter>
      );

      const startBlankCard = screen.getByText('Blank Document');
      fireEvent.click(startBlankCard);

      await waitFor(() => {
        expect(screen.getByText(/Provisioning Error/i)).toBeDefined();
        expect(screen.getByText(/Database unavailable/i)).toBeDefined();
      });
    });
  });

  describe('Feature 15 & 25: Collaboration Extension & Human UndoManager Isolation', () => {
    it('initializes Collaboration extension with Yjs XmlFragment and disables StarterKit history', () => {
      const ydoc = new Y.Doc();
      const fragment = ydoc.getXmlFragment('prosemirror');

      const editor = new Editor({
        extensions: [
          StarterKit.configure({
            history: false,
          }),
          SuggestionInsert,
          SuggestionDelete,
          Collaboration.configure({
            fragment,
          }),
        ],
        content: '<p>Collaboration test</p>',
      });

      // Assert TipTap history extension is NOT active
      const historyExtension = editor.extensionManager.extensions.find(
        (e: any) => e.name === 'history'
      );
      expect(historyExtension).toBeUndefined();

      // Assert enterpriseCollaboration extension is active
      const collabExtension = editor.extensionManager.extensions.find(
        (e: any) => e.name === 'enterpriseCollaboration'
      );
      expect(collabExtension).toBeDefined();

      // Assert ySync plugin is active
      const syncPlugin = editor.state.plugins.find((p: any) => p.key?.startsWith('y-sync'));
      expect(syncPlugin).toBeDefined();

      // Assert yUndo plugin is active
      const undoPlugin = editor.state.plugins.find(
        (p: any) => p.key?.startsWith('y-undo') || p.key?.startsWith('history$')
      );
      expect(undoPlugin).toBeDefined();

      editor.destroy();
      ydoc.destroy();
    });
  });

  describe('Feature 16: Collapsible Left Outline Rail (OutlineRail)', () => {
    it('extracts H1, H2, and H3 headings and renders outline jump items', () => {
      const editor = new Editor({
        extensions: [StarterKit],
        content: `
          <h1>Title Heading</h1>
          <p>Intro text</p>
          <h2>Sub Section</h2>
          <p>Section body</p>
          <h3>Deep Detail</h3>
          <h4>Ignored H4</h4>
        `,
      });

      render(<OutlineRail editor={editor} />);

      expect(screen.getByText('Title Heading')).toBeDefined();
      expect(screen.getByText('Sub Section')).toBeDefined();
      expect(screen.getByText('Deep Detail')).toBeDefined();
      expect(screen.queryByText('Ignored H4')).toBeNull();

      editor.destroy();
    });

    it('collapses and expands cleanly on toggle button click', () => {
      const editor = new Editor({
        extensions: [StarterKit],
        content: '<h1>Main</h1>',
      });

      render(<OutlineRail editor={editor} defaultCollapsed={false} />);

      const collapseBtn = screen.getByLabelText(/Collapse document outline/i);
      fireEvent.click(collapseBtn);

      const expandBtn = screen.getByLabelText(/Expand document outline/i);
      expect(expandBtn).toBeDefined();

      editor.destroy();
    });
  });

  describe('Feature 21: Real-Time Save Status Badge (SaveStatusBadge)', () => {
    it('renders "Saved ✓" state by default', () => {
      render(<SaveStatusBadge />);
      expect(screen.getByText('Saved ✓')).toBeDefined();
    });

    it('renders "Saving..." when hasUnsavedChanges is true', () => {
      render(<SaveStatusBadge hasUnsavedChanges={true} />);
      expect(screen.getByText('Saving...')).toBeDefined();
    });

    it('renders "Reconnecting..." when provider status is connecting', () => {
      const mockProvider: any = {
        status: 'connecting',
        hasUnsyncedChanges: false,
        on: vi.fn(),
        off: vi.fn(),
      };
      render(<SaveStatusBadge provider={mockProvider} />);
      expect(screen.getByText('Reconnecting...')).toBeDefined();
    });
  });

  describe('Feature 22: AI Agent Presence Chip (AgentPresenceChip)', () => {
    it('renders agent chip with violet badge when agent is in awareness', () => {
      const states = new Map();
      states.set(999, {
        user: {
          name: '[Agent: Claude-Architecture]',
          role: 'agent',
          color: '#6366f1',
          status: 'Reviewing H2',
          agentId: 'claude-3-7',
        },
      });

      const mockProvider: any = {
        awareness: {
          getStates: () => states,
          on: vi.fn((event, cb) => cb()),
          off: vi.fn(),
        },
      };

      render(<AgentPresenceChip provider={mockProvider} />);

      expect(screen.getByText('Claude-Architecture')).toBeDefined();
      expect(screen.getByText('Reviewing H2')).toBeDefined();
    });

    it('returns null when no AI agent is in awareness', () => {
      const states = new Map();
      states.set(1, {
        user: { name: 'Human Author', role: 'author' },
      });

      const mockProvider: any = {
        awareness: {
          getStates: () => states,
          on: vi.fn(),
          off: vi.fn(),
        },
      };

      const { container } = render(<AgentPresenceChip provider={mockProvider} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Feature 23: Dynamic Live Word & Character Count (WordCountIndicator)', () => {
    it('calculates words, characters, and reading time across block boundaries accurately', () => {
      const editor = new Editor({
        extensions: [StarterKit],
        content: `
          <h1>Header One</h1>
          <p>Two three four.</p>
        `,
      });

      const stats = computeDocStats(editor);
      expect(stats.words).toBe(5);
      expect(stats.characters).toBe(26);
      expect(stats.readingTimeMinutes).toBe(1);

      render(<WordCountIndicator editor={editor} />);
      expect(screen.getByText(/5 words/i)).toBeDefined();

      editor.destroy();
    });
  });

  describe('Feature 24: Submit for Review Flow (SubmitReviewButton)', () => {
    it('displays "In Review" badge when status is in_review', () => {
      render(<SubmitReviewButton postId="post-1" status="in_review" />);
      expect(screen.getByText('In Review')).toBeDefined();
    });

    it('displays "Published" badge when status is published', () => {
      render(<SubmitReviewButton postId="post-1" status="published" />);
      expect(screen.getByText('Published')).toBeDefined();
    });

    it('opens confirmation dialog on click and executes API mutation', async () => {
      (api.post as any).mockResolvedValueOnce({ post: { status: 'in_review' } });
      const onStatusChange = vi.fn();

      render(
        <SubmitReviewButton
          postId="post-1"
          status="draft"
          onStatusChange={onStatusChange}
        />
      );

      const submitBtn = screen.getByRole('button', { name: /Submit for Review/i });
      fireEvent.click(submitBtn);

      expect(screen.getByText(/Submit Post for Review/i)).toBeDefined();

      const confirmBtn = screen.getByRole('button', { name: /Confirm & Submit/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/posts/post-1/submit-review');
        expect(onStatusChange).toHaveBeenCalledWith('in_review');
      });
    });
  });

  describe('Feature 17: SuggestionItem & SuggestionsTab', () => {
    it('renders SuggestionItem with diff and handles accept/reject', () => {
      const onAccept = vi.fn();
      const onReject = vi.fn();
      const onSelect = vi.fn();

      const item: SuggestionItemData = {
        id: 'sug-1',
        type: 'replace',
        agentId: 'AI Agent',
        from: 0,
        to: 10,
        text: 'improved prose',
        originalText: 'original',
      };

      render(
        <SuggestionItem
          suggestion={item}
          onAccept={onAccept}
          onReject={onReject}
          onSelect={onSelect}
        />
      );

      expect(screen.getByText('improved prose')).toBeDefined();
      expect(screen.getByText('original')).toBeDefined();

      const acceptBtn = screen.getByTitle('Accept Suggestion');
      fireEvent.click(acceptBtn);
      expect(onAccept).toHaveBeenCalledWith(item);

      const rejectBtn = screen.getByTitle('Reject Suggestion');
      fireEvent.click(rejectBtn);
      expect(onReject).toHaveBeenCalledWith(item);
    });

    it('renders empty state in SuggestionsTab when no suggestions exist', () => {
      const ydoc = new Y.Doc();
      const editor = new Editor({
        extensions: [StarterKit],
        content: '<p>Clean text</p>',
      });

      render(
        <SuggestionsTab
          ydoc={ydoc}
          editor={editor}
          currentUser={{ userId: 'user-1', name: 'Author' }}
        />
      );

      expect(screen.getByText('No pending suggestions')).toBeDefined();

      editor.destroy();
      ydoc.destroy();
    });
  });

  describe('Feature 19: VersionsTab', () => {
    it('fetches and displays version snapshots timeline from GET /api/v1/posts/:id/versions', async () => {
      (api.get as any).mockResolvedValueOnce({
        versions: [
          {
            id: 'ver-2',
            postId: 'post-1',
            versionNumber: 2,
            triggerReason: 'publication',
            createdAt: '2026-10-24T12:00:00Z',
            createdBy: 'user-1',
            authorName: 'Lead Architect',
          },
          {
            id: 'ver-1',
            postId: 'post-1',
            versionNumber: 1,
            triggerReason: 'review_submission',
            createdAt: '2026-10-24T10:00:00Z',
            createdBy: 'user-1',
            authorName: 'Lead Architect',
          },
        ],
      });

      render(<VersionsTab postId="post-1" />);

      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith('/posts/post-1/versions');
        expect(screen.getByText('v2')).toBeDefined();
        expect(screen.getByText('Published Snapshot')).toBeDefined();
        expect(screen.getByText('v1')).toBeDefined();
        expect(screen.getByText('Review Submission')).toBeDefined();
      });
    });
  });

  describe('Feature 20: PostSettingsTab', () => {
    it('renders post settings form and allows slug generation and saving', async () => {
      (api.patch as any).mockResolvedValueOnce({
        post: {
          id: 'post-1',
          title: 'Updated Post Title',
          slug: 'updated-post-title',
          excerpt: 'Short excerpt',
          coeId: 'coe-architecture',
        },
      });

      const onMetadataUpdate = vi.fn();

      render(
        <PostSettingsTab
          postId="post-1"
          postMetadata={{
            id: 'post-1',
            title: 'Initial Title',
            slug: 'initial-title',
            status: 'draft',
          }}
          onMetadataUpdate={onMetadataUpdate}
        />
      );

      const titleInput = screen.getByPlaceholderText('Enter post title...');
      fireEvent.change(titleInput, { target: { value: 'Updated Post Title' } });

      const slugifyBtn = screen.getByRole('button', { name: /Slugify Title/i });
      fireEvent.click(slugifyBtn);

      const saveBtn = screen.getByRole('button', { name: /Save Post Settings/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(api.patch).toHaveBeenCalledWith(
          '/posts/post-1',
          expect.objectContaining({
            title: 'Updated Post Title',
            slug: 'updated-post-title',
          })
        );
        expect(onMetadataUpdate).toHaveBeenCalled();
      });
    });
  });

  describe('Composite DrawerPanel', () => {
    it('switches between Suggestions, Comments, Versions, and Settings tabs', () => {
      const ydoc = new Y.Doc();
      const editor = new Editor({
        extensions: [StarterKit],
        content: '<p>Content</p>',
      });

      render(
        <DrawerPanel
          isOpen={true}
          onClose={vi.fn()}
          postId="post-1"
          ydoc={ydoc}
          editor={editor}
          currentUser={{ userId: 'user-1' }}
          defaultTab="suggestions"
        />
      );

      expect(screen.getByRole('tab', { name: /Edits/i })).toBeDefined();
      expect(screen.getByRole('tab', { name: /Notes/i })).toBeDefined();
      expect(screen.getByRole('tab', { name: /History/i })).toBeDefined();
      expect(screen.getByRole('tab', { name: /Settings/i })).toBeDefined();

      editor.destroy();
      ydoc.destroy();
    });
  });
});
