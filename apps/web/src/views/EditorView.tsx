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
import { useAuth } from '../context/AuthContext.js';
import { getCollaboratorColor } from '../components/AwarenessBar.js';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  PanelRightOpen,
  PanelRightClose,
} from 'lucide-react';

export const EditorView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [postMetadata, setPostMetadata] = useState<any>(null);
  const [title, setTitle] = useState('');
  const [postStatus, setPostStatus] = useState<'draft' | 'in_review' | 'published' | 'changes_requested'>('draft');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Editor instance and provider state
  const [editor, setEditor] = useState<any | null>(null);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [suggestionCount, setSuggestionCount] = useState(0);

  // Title debounce auto-save ref
  const titleTimerRef = useRef<any>(null);

  // 1. Stable Y.Doc per post ID
  const ydoc = useMemo(() => new Y.Doc(), [id]);
  const isWsSyncedRef = useRef(false);

  // 2. Fetch post metadata from REST API
  useEffect(() => {
    if (!id) return;
    let isMounted = true;

    async function fetchPost() {
      try {
        setIsLoading(true);
        setLoadError(null);
        const res = await api.get<{ post: any; userPermission: string }>(`/posts/${id}`);
        if (isMounted && res?.post) {
          setPostMetadata(res.post);
          setTitle(res.post.title || 'Untitled Post');
          setPostStatus(res.post.status || 'draft');

          if (res.post.yjsState) {
            try {
              let binary: Uint8Array | null = null;
              if (res.post.yjsState.data && Array.isArray(res.post.yjsState.data)) {
                binary = new Uint8Array(res.post.yjsState.data);
              } else if (typeof res.post.yjsState === 'string') {
                binary = new Uint8Array(res.post.yjsState.match(/.{1,2}/g)?.map((b: string) => parseInt(b, 16)) || []);
              } else if (res.post.yjsState instanceof Uint8Array) {
                binary = res.post.yjsState;
              }
              if (binary && binary.length > 0 && !isWsSyncedRef.current && ydoc.share.size === 0) {
                Y.applyUpdate(ydoc, binary);
              }
            } catch (yErr) {
              console.warn('Failed to hydrate initial Yjs document state:', yErr);
            }
          }
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
    };
  }, [id]);

  // 3. Connect HocuspocusProvider
  useEffect(() => {
    if (!id || !user) return;

    const wsUrl = (import.meta as any).env?.VITE_COLLAB_WS_URL || 'ws://localhost:4000';
    const roomName = `post-${id}`;
    const token = `token-${user.role}-${user.userId}`;

    const hpProvider = new HocuspocusProvider({
      url: wsUrl,
      name: roomName,
      document: ydoc,
      token,
      onSynced: (data) => {
        if (data.state) {
          isWsSyncedRef.current = true;
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

    setProvider(hpProvider);

    return () => {
      hpProvider.destroy();
      ydoc.destroy();
    };
  }, [id, user, ydoc]);

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
    titleTimerRef.current = setTimeout(async () => {
      if (!id) return;
      try {
        await api.patch(`/posts/${id}`, { title: newTitle });
      } catch (err) {
        console.error('Failed to autosave title:', err);
      }
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

  if (isLoading) {
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
          {/* Live Dynamic Word & Character Count */}
          <WordCountIndicator editor={editor} className="hidden lg:flex" />

          {/* Real-time Save Status Badge */}
          <SaveStatusBadge provider={provider} />

          {/* AI Agent Presence Chip */}
          <AgentPresenceChip provider={provider} />

          {/* Submit for Review Flow */}
          {id && (
            <SubmitReviewButton
              postId={id}
              status={postStatus}
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
            postId={id}
          />
        </main>

        {/* Tabbed Right Drawer Panel */}
        {id && (
          <DrawerPanel
            isOpen={isDrawerOpen}
            onClose={() => setIsDrawerOpen(false)}
            postId={id}
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
