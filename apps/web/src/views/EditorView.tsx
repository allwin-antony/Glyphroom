import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { CollaborativeEditor } from '../components/Editor.js';
import { OutlineRail } from '../components/editor/OutlineRail.js';
import { SaveStatusBadge } from '../components/editor/SaveStatusBadge.js';
import { AgentPresenceChip } from '../components/editor/AgentPresenceChip.js';
import { WordCountIndicator } from '../components/editor/WordCountIndicator.js';
import { SubmitReviewButton } from '../components/editor/SubmitReviewButton.js';
import { DrawerPanel } from '../components/editor/DrawerPanel.js';
import { api, ApiError } from '../lib/api.js';
import { waitForCollabSync } from '../lib/collab-sync.js';
import { useAuth } from '../context/AuthContext.js';
import { getCollaboratorColor } from '../components/AwarenessBar.js';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  PanelRightOpen,
  PanelRightClose,
  Eye,
  Edit3,
} from 'lucide-react';

type PendingTitle = { postId: string; userId: string; title: string };

export const EditorView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [postMetadata, setPostMetadata] = useState<any>(null);
  const [title, setTitle] = useState('');
  const [postStatus, setPostStatus] = useState<'draft' | 'in_review' | 'approved' | 'published' | 'changes_requested'>('draft');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Editor instance, view mode, and provider state
  const [viewMode, setViewMode] = useState<'document' | 'block' | 'preview'>(() => {
    return (localStorage.getItem('glyphroom_view_mode') as 'document' | 'block' | 'preview') || 'document';
  });
  const [editor, setEditor] = useState<any | null>(null);
  const [editAccess, setEditAccess] = useState<{ routeId: string; userId: string; post: any } | null>(null);
  const [collaboration, setCollaboration] = useState<{
    access: NonNullable<typeof editAccess>; doc: Y.Doc; provider: HocuspocusProvider;
  } | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [suggestionCount, setSuggestionCount] = useState(0);

  // Title debounce auto-save ref
  const titleTimerRef = useRef<any>(null);
  const pendingTitleRef = useRef<PendingTitle | null>(null);
  const titleSaveRef = useRef<{ pending: PendingTitle; promise: Promise<void> } | null>(null);
  const userIdRef = useRef(user?.userId);
  userIdRef.current = user?.userId;
  const savePendingTitle = useCallback(async (expectedPostId?: string) => {
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    const inScope = (entry: PendingTitle) => !expectedPostId
      || (entry.postId === expectedPostId && entry.userId === userIdRef.current);
    const pending = pendingTitleRef.current && inScope(pendingTitleRef.current) ? pendingTitleRef.current : null;
    const previous = titleSaveRef.current && inScope(titleSaveRef.current.pending) ? titleSaveRef.current : null;
    if (!pending) return previous?.promise;
    if (pending.userId !== userIdRef.current) {
      pendingTitleRef.current = null;
      return;
    }
    if (previous?.pending === pending) return previous.promise;
    // Serialize title writes and reuse an already-dispatched save as a barrier.
    // A failure keeps the latest title pending so preparation can retry it.
    const persist = async () => {
      if (pending.userId !== userIdRef.current) return;
      await api.patch(`/posts/${pending.postId}`, { title: pending.title });
      if (pendingTitleRef.current === pending) pendingTitleRef.current = null;
    };
    const sameDocument = previous?.pending.postId === pending.postId && previous.pending.userId === pending.userId;
    const promise = sameDocument ? previous!.promise.catch(() => {}).then(persist) : persist();
    const save = { pending, promise };
    titleSaveRef.current = save;
    try {
      await promise;
    } finally {
      if (titleSaveRef.current === save) titleSaveRef.current = null;
    }
  }, []);

  const activeCollaboration = collaboration?.access === editAccess && editAccess?.routeId === id
    && editAccess?.userId === user?.userId ? collaboration : null;
  const provider = activeCollaboration?.provider ?? null;
  const ydoc = activeCollaboration?.doc;
  const postId = activeCollaboration?.access.post.id as string | undefined;

  // 2. Fetch post metadata from REST API
  useEffect(() => {
    if (!id) return;
    let isMounted = true;

    async function fetchPost() {
      try {
        setIsLoading(true);
        setLoadError(null);
        setEditAccess(null);
        setPostMetadata(null);
        const res = await api.get<{ post: any; userPermission: string }>(`/posts/${id}`);
        if (isMounted && res?.post) {
          if (!user || !['admin', 'edit'].includes(res.userPermission)) {
            setLoadError('Editing access is required. Open this post in the reader.');
            return;
          }
          // A navigation save may finish independently, but the new editor must
          // never await or retry a different document's title operation.
          if (pendingTitleRef.current?.postId !== res.post.id || pendingTitleRef.current?.userId !== user.userId) pendingTitleRef.current = null;
          if (titleSaveRef.current?.pending.postId !== res.post.id || titleSaveRef.current?.pending.userId !== user.userId) titleSaveRef.current = null;
          setPostMetadata(res.post);
          setTitle(pendingTitleRef.current?.title ?? res.post.title ?? 'Untitled Post');
          setPostStatus(res.post.status || 'draft');
          setEditAccess({ routeId: id!, userId: user.userId, post: res.post });
        } else if (isMounted) {
          setLoadError('Failed to load post.');
        }
      } catch (err: any) {
        if (isMounted) {
          if (err instanceof ApiError && err.status === 404) {
            setLoadError('Post not found.');
          } else if (err instanceof ApiError && err.status === 403) {
            setLoadError('You do not have permission to view or edit this post.');
          } else {
            setLoadError(err?.message || 'Failed to load post.');
          }
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    fetchPost();
    return () => {
      isMounted = false;
      // Preserve the captured post's last title on navigation; an identity
      // change is discarded by savePendingTitle rather than saved as a new user.
      void savePendingTitle().catch((err) => console.error('Failed to autosave title:', err));
    };
  }, [id, user?.userId, savePendingTitle]);

  // 3. Connect HocuspocusProvider
  useEffect(() => {
    if (!id || !user || !editAccess || editAccess.routeId !== id || editAccess.userId !== user.userId) return;
    const doc = new Y.Doc();
    try {
      const state = editAccess.post.yjsState;
      const binary = Array.isArray(state?.data) ? new Uint8Array(state.data)
        : state instanceof Uint8Array ? state
        : typeof state === 'string' && /^(?:[a-f0-9]{2})+$/i.test(state)
          ? new Uint8Array(state.match(/.{2}/g)!.map((byte: string) => parseInt(byte, 16))) : null;
      if (!binary?.length) throw new Error('Missing editor state');
      Y.applyUpdate(doc, binary);
      if (doc.store.pendingStructs || doc.store.pendingDs) throw new Error('Incomplete editor state');
    } catch {
      doc.destroy();
      setLoadError('The working document could not be loaded. Please reload before editing.');
      return;
    }

    const wsUrl = (import.meta as any).env?.VITE_COLLAB_WS_URL || `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
    let disposed = false;

    const hpProvider = new HocuspocusProvider({
      url: wsUrl,
      name: `post-${editAccess.post.id}`,
      document: doc,
      // The browser sends the HttpOnly session cookie on the WS upgrade.
      onAuthenticationFailed: () => {
        if (!disposed) {
          pendingTitleRef.current = null;
          if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
          setLoadError('Collaboration authentication failed. Please sign in again or check your edit access.');
          setEditAccess(null);
        }
      },
    });

    // Awareness local user profile setup
    if (hpProvider.awareness) {
      hpProvider.awareness.setLocalStateField('user', {
        name: user.fullName || user.email || 'Author',
        color: getCollaboratorColor(hpProvider.awareness.clientID, false),
        role: user.role,
        status: 'editing',
      });
    }

    setCollaboration({ access: editAccess, doc, provider: hpProvider });

    return () => {
      disposed = true;
      hpProvider.destroy();
      doc.destroy();
    };
  }, [id, user?.userId, editAccess]);

  // 4. Scan suggestion count for drawer badge
  const updateSuggestionCount = useCallback(() => {
    if (!editor || !editor.state) return;
    const seenIds = new Set<string>();
    editor.state.doc.descendants((node: any) => {
      if (!node.isText) return;
      const insertMark = node.marks.find((m: any) => m.type.name === 'suggestion_insert');
      const deleteMark = node.marks.find((m: any) => m.type.name === 'suggestion_delete');
      if (insertMark && insertMark.attrs.id) seenIds.add(insertMark.attrs.id);
      if (deleteMark && deleteMark.attrs.id) seenIds.add(deleteMark.attrs.id);
    });
    setSuggestionCount(seenIds.size);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    updateSuggestionCount();
    editor.on('update', updateSuggestionCount);
    return () => {
      editor.off('update', updateSuggestionCount);
    };
  }, [editor, updateSuggestionCount]);

  // 5. Handle Title Editing with debounced PATCH
  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    if (!postId || !user) return;
    pendingTitleRef.current = { postId, userId: user.userId, title: newTitle };
    titleTimerRef.current = setTimeout(() => {
      void savePendingTitle().catch((err) => console.error('Failed to autosave title:', err));
    }, 800);
  };

  const currentUser = useMemo(() => ({
    userId: user?.userId || 'unknown-user',
    fullName: user?.fullName || user?.email || 'Author',
    name: user?.fullName || user?.email || 'Author',
    email: user?.email,
    role: user?.role || 'author',
    color: getCollaboratorColor(provider?.awareness?.clientID || 1, false),
  }), [user, provider?.awareness?.clientID]);

  if (isLoading || (!loadError && (!ydoc || !provider))) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-foreground">
        <Loader2 className="w-8 h-8 text-accent animate-spin mb-3" />
        <div className="text-sm font-semibold">Loading editor session...</div>
        <div className="text-xs text-text-muted mt-1">Establishing collaborative CRDT workspace</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-foreground p-6">
        <div className="w-full max-w-md p-6 rounded-2xl bg-surface border border-status-danger/30 shadow-md">
          <div className="flex items-center gap-3 text-status-danger mb-3">
            <AlertCircle className="w-6 h-6 shrink-0" />
            <h3 className="text-base font-bold">Error Loading Post</h3>
          </div>
          <p className="text-sm text-text-secondary mb-6">{loadError}</p>
          <button
            onClick={() => navigate('/my-work')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-canvas border border-border text-foreground font-semibold text-xs hover:bg-elevated transition-all"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to My Work</span>
          </button>
        </div>
      </div>
    );
  }

  if (!ydoc || !provider) return null;

  return (
    <div className="flex flex-col h-full bg-canvas text-foreground overflow-hidden">
      {/* Editor Sub-Header / Status Bar */}
      <header className="h-12 bg-surface border-b border-border flex items-center justify-between px-3 sm:px-6 shadow-xs shrink-0 select-none gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <button
            onClick={() => navigate('/my-work')}
            className="p-1 rounded-md text-text-muted hover:text-foreground hover:bg-canvas transition-colors shrink-0"
            aria-label="Back to My Work"
            title="Back to My Work"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <input
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            className="bg-transparent border-none text-sm font-semibold text-foreground focus:outline-none min-w-0 flex-1 max-w-xs sm:max-w-md placeholder:text-text-muted truncate"
            placeholder="Untitled Post..."
          />
        </div>

        <div className="flex items-center gap-2.5 sm:gap-3">
          {/* Edit / Reader Preview Mode Toggle */}
          <div className="flex items-center rounded-lg border border-border p-0.5 bg-canvas">
            <button
              onClick={() => setViewMode(viewMode === 'preview' ? 'document' : 'preview')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                viewMode === 'preview'
                  ? 'bg-accent text-white shadow-xs'
                  : 'text-text-secondary hover:text-foreground hover:bg-elevated'
              }`}
               title={viewMode === 'preview' ? "Switch to Edit mode" : "Preview current edits"}
               aria-label={viewMode === 'preview' ? "Switch to Edit mode" : "Preview current edits"}
            >
              {viewMode === 'preview' ? <Edit3 size={13} /> : <Eye size={13} />}
              <span>{viewMode === 'preview' ? 'Edit' : 'Preview'}</span>
            </button>
          </div>

          {/* Live Dynamic Word & Character Count */}
          <WordCountIndicator editor={editor} className="hidden lg:flex" />

          {/* Real-time Save Status Badge */}
          <SaveStatusBadge provider={provider} />

          {/* AI Agent Presence Chip */}
          <AgentPresenceChip provider={provider} />

          {/* Submit for Review Flow */}
          {postId && (
            <SubmitReviewButton
              postId={postId}
              status={postStatus}
              submittedVersionId={postMetadata?.submittedVersionId}
              hasPriorPublication={typeof postMetadata?.publishedMarkdown === 'string'}
              prepareSubmission={async (signal) => {
                await savePendingTitle(postId);
                await waitForCollabSync(provider, { signal });
              }}
              onStatusChange={(newStatus) => {
                setPostStatus(newStatus as any);
                setPostMetadata((prev: any) => prev ? { ...prev, status: newStatus } : prev);
              }}
            />
          )}

          {/* Right Drawer Toggle Button */}
          <button
            onClick={() => setIsDrawerOpen(!isDrawerOpen)}
            className={`p-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${
              isDrawerOpen
                ? 'bg-elevated border-border text-foreground'
                : 'border-transparent text-text-muted hover:text-foreground hover:bg-elevated'
            }`}
            title={isDrawerOpen ? "Close Inspector Drawer" : "Open Inspector Drawer"}
            aria-label={isDrawerOpen ? "Close Inspector Drawer" : "Open Inspector Drawer"}
          >
            {isDrawerOpen ? (
              <PanelRightClose className="w-4 h-4" />
            ) : (
              <PanelRightOpen className="w-4 h-4" />
            )}
            {suggestionCount > 0 && !isDrawerOpen && (
              <span className="px-1 py-0.2 rounded-full text-[10px] bg-agent text-white font-bold leading-none">
                {suggestionCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Main 3-Column Workspace Layout */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Collapsible Left Outline Rail */}
        <OutlineRail editor={editor} />

        {/* Center TipTap Collaborative Canvas */}
        <main className="flex-1 overflow-hidden flex flex-col bg-canvas min-w-0">
          <CollaborativeEditor
            ydoc={ydoc}
            provider={provider || undefined}
            user={currentUser}
            onEditorReady={setEditor}
            hideSidebar={true}
            onDocChange={() => {}}
            postId={postId}
            title={title}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        </main>

        {/* Tabbed Right Drawer Panel */}
        {postId && (
          <DrawerPanel
            isOpen={isDrawerOpen}
            onClose={() => setIsDrawerOpen(false)}
            postId={postId}
            ydoc={ydoc}
            editor={editor}
            currentUser={currentUser}
            postMetadata={postMetadata}
            onMetadataUpdate={(updated) => {
              setPostMetadata(updated);
              if (updated?.title) setTitle(updated.title);
            }}
            pendingSuggestionsCount={suggestionCount}
          />
        )}
      </div>
    </div>
  );
};
