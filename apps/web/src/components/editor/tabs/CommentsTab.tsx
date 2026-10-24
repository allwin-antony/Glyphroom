import React, { useState, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { 
  absolutePositionToRelativePosition, 
  relativePositionToAbsolutePosition, 
  ySyncPluginKey 
} from 'y-prosemirror';
import { 
  MessageSquare, 
  CornerDownRight, 
  CheckCircle, 
  Send, 
  Loader2, 
  Quote, 
  AlertCircle,
  Filter
} from 'lucide-react';
import { api, ApiError } from '../../../lib/api.js';

export interface CommentData {
  id: string;
  postId: string;
  parentId: string | null;
  authorId: string;
  authorName?: string;
  content: string;
  status: 'open' | 'resolved';
  yjsAnchorStart?: any;
  yjsAnchorEnd?: any;
  isReviewComment?: boolean;
  createdAt: string;
}

export interface CommentsTabProps {
  postId: string;
  ydoc: Y.Doc;
  editor: any | null;
  currentUser: {
    userId: string;
    fullName?: string;
    name?: string;
  };
}

export const CommentsTab: React.FC<CommentsTabProps> = ({
  postId,
  ydoc,
  editor,
  currentUser,
}) => {
  const [comments, setComments] = useState<CommentData[]>([]);
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const [isLoading, setIsLoading] = useState(true);
  const [newCommentText, setNewCommentText] = useState('');
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected text preview if editor has an active selection
  const [selectedText, setSelectedText] = useState<string | null>(null);

  const fetchComments = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await api.get<{ comments: CommentData[] }>(`/posts/${postId}/comments`);
      setComments(res.comments || []);
    } catch (err: any) {
      console.error('Failed to load comments:', err);
    } finally {
      setIsLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Update selected text preview when editor selection changes
  useEffect(() => {
    if (!editor) return;

    const handleSelection = () => {
      const { from, to, empty } = editor.state.selection;
      if (!empty) {
        const text = editor.state.doc.textBetween(from, to, ' ').trim();
        setSelectedText(text.length > 0 ? text : null);
      } else {
        setSelectedText(null);
      }
    };

    editor.on('selectionUpdate', handleSelection);
    return () => {
      editor.off('selectionUpdate', handleSelection);
    };
  }, [editor]);

  // Create new top-level comment
  const handleCreateComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    let yjsAnchorStart: any = null;
    let yjsAnchorEnd: any = null;

    if (editor && !editor.state.selection.empty) {
      const { from, to } = editor.state.selection;
      try {
        const syncState = ySyncPluginKey.getState(editor.state);
        if (syncState?.binding) {
          const relStart = absolutePositionToRelativePosition(
            from,
            syncState.binding.type,
            syncState.binding.mapping
          );
          const relEnd = absolutePositionToRelativePosition(
            to,
            syncState.binding.type,
            syncState.binding.mapping
          );
          yjsAnchorStart = Y.relativePositionToJSON(relStart);
          yjsAnchorEnd = Y.relativePositionToJSON(relEnd);
        }
      } catch (err) {
        console.warn('Could not encode relative positions:', err);
      }
    }

    try {
      const res = await api.post<{ comment: CommentData }>(`/posts/${postId}/comments`, {
        content: newCommentText.trim(),
        parentId: null,
        yjsAnchorStart,
        yjsAnchorEnd,
        isReviewComment: false,
      });

      if (res?.comment) {
        setComments((prev) => [...prev, res.comment]);
        setNewCommentText('');
        setSelectedText(null);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to post comment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Create reply to a top-level comment
  const handleCreateReply = async (parentId: string) => {
    if (!replyText.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const res = await api.post<{ comment: CommentData }>(`/posts/${postId}/comments`, {
        content: replyText.trim(),
        parentId,
        isReviewComment: false,
      });

      if (res?.comment) {
        setComments((prev) => [...prev, res.comment]);
        setReplyText('');
        setReplyingToId(null);
      }
    } catch (err: any) {
      alert(err?.message || 'Failed to submit reply.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Resolve comment
  const handleResolve = async (commentId: string) => {
    try {
      await api.patch(`/posts/${postId}/comments/${commentId}/resolve`, {});
      setComments((prev) =>
        prev.map((c) => (c.id === commentId ? { ...c, status: 'resolved' as const } : c))
      );
    } catch (err: any) {
      alert(err?.message || 'Failed to resolve comment.');
    }
  };

  // Jump to anchored text in editor
  const handleJumpToAnchor = (comment: CommentData) => {
    if (!editor || !comment.yjsAnchorStart || !comment.yjsAnchorEnd) return;

    try {
      const syncState = ySyncPluginKey.getState(editor.state);
      if (!syncState?.binding) return;

      const relStart = Y.createRelativePositionFromJSON(comment.yjsAnchorStart);
      const relEnd = Y.createRelativePositionFromJSON(comment.yjsAnchorEnd);

      const from = relativePositionToAbsolutePosition(
        ydoc,
        syncState.binding.type,
        relStart,
        syncState.binding.mapping
      );
      const to = relativePositionToAbsolutePosition(
        ydoc,
        syncState.binding.type,
        relEnd,
        syncState.binding.mapping
      );

      if (from !== null && to !== null) {
        const docSize = editor.state.doc.content.size;
        const safeFrom = Math.min(Math.max(0, from), docSize);
        const safeTo = Math.min(Math.max(safeFrom, to), docSize);
        editor.chain().focus().setTextSelection({ from: safeFrom, to: safeTo }).scrollIntoView().run();
      }
    } catch (err) {
      console.warn('Could not resolve comment relative position:', err);
    }
  };

  // Filter top-level comments
  const topLevelComments = comments.filter((c) => c.parentId === null);
  const replies = comments.filter((c) => c.parentId !== null);

  const filteredComments = topLevelComments.filter((c) => {
    if (filter === 'all') return true;
    return c.status === filter;
  });

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Filter and Count Header */}
      <div className="p-3 border-b border-border flex items-center justify-between bg-surface-muted/30">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
          <MessageSquare className="w-4 h-4 text-blue-500" />
          <span>Comments</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-elevated border border-border text-text-muted">
            {comments.filter((c) => c.status === 'open').length} open
          </span>
        </div>

        <div className="flex items-center bg-elevated border border-border rounded-lg p-0.5 text-[11px]">
          <button
            onClick={() => setFilter('open')}
            className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
              filter === 'open' ? 'bg-primary text-primary-foreground font-semibold' : 'text-text-muted hover:text-foreground'
            }`}
          >
            Open
          </button>
          <button
            onClick={() => setFilter('resolved')}
            className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
              filter === 'resolved' ? 'bg-primary text-primary-foreground font-semibold' : 'text-text-muted hover:text-foreground'
            }`}
          >
            Resolved
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-2 py-0.5 rounded-md font-medium transition-colors ${
              filter === 'all' ? 'bg-primary text-primary-foreground font-semibold' : 'text-text-muted hover:text-foreground'
            }`}
          >
            All
          </button>
        </div>
      </div>

      {/* New Comment Input Box */}
      <form onSubmit={handleCreateComment} className="p-3 border-b border-border bg-canvas/40 space-y-2">
        {selectedText && (
          <div className="p-2 rounded-lg bg-surface border border-accent/30 text-xs flex items-start gap-1.5 text-text-secondary">
            <Quote className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
            <span className="italic line-clamp-2 break-all">"{selectedText}"</span>
          </div>
        )}

        <div className="flex gap-2">
          <textarea
            value={newCommentText}
            onChange={(e) => setNewCommentText(e.target.value)}
            placeholder={selectedText ? "Add a comment on selection..." : "Add a comment on post..."}
            className="w-full text-xs p-2 rounded-lg bg-surface border border-border focus:outline-none focus:border-accent text-foreground resize-none h-16 placeholder:text-text-muted"
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-text-muted">
            {selectedText ? 'Anchored to selected text' : 'Unanchored note'}
          </span>
          <button
            type="submit"
            disabled={!newCommentText.trim() || isSubmitting}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-primary text-primary-foreground font-semibold text-xs hover:opacity-90 transition-all disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Send className="w-3 h-3" />
            )}
            <span>Comment</span>
          </button>
        </div>

        {error && (
          <div className="text-[11px] text-status-danger flex items-center gap-1 pt-1">
            <AlertCircle className="w-3 h-3" />
            <span>{error}</span>
          </div>
        )}
      </form>

      {/* Comment Thread List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-10 text-text-muted text-xs">
            <Loader2 className="w-5 h-5 animate-spin mb-2" />
            <span>Loading comments...</span>
          </div>
        ) : filteredComments.length === 0 ? (
          <div className="py-10 text-center text-text-muted text-xs">
            No {filter !== 'all' ? filter : ''} comments.
          </div>
        ) : (
          filteredComments.map((thread) => {
            const threadReplies = replies.filter((r) => r.parentId === thread.id);
            const isResolved = thread.status === 'resolved';

            return (
              <div
                key={thread.id}
                className={`p-3 rounded-xl border transition-all text-xs space-y-2.5 ${
                  isResolved
                    ? 'border-border/60 bg-surface/50 opacity-75'
                    : 'border-border bg-surface hover:border-border-strong shadow-xs'
                }`}
              >
                {/* Author & Status Header */}
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-foreground">
                    {thread.authorName || 'Author'}
                  </span>
                  <span className="text-text-muted">
                    {new Date(thread.createdAt).toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                {/* Anchored jump link */}
                {thread.yjsAnchorStart && (
                  <button
                    onClick={() => handleJumpToAnchor(thread)}
                    className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline text-left"
                    title="Jump to anchored document location"
                  >
                    <Quote className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate max-w-[200px]">Jump to anchored text</span>
                  </button>
                )}

                {/* Comment Content */}
                <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                  {thread.content}
                </p>

                {/* Action Buttons */}
                <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[11px]">
                  <button
                    onClick={() => setReplyingToId(replyingToId === thread.id ? null : thread.id)}
                    className="text-text-muted hover:text-foreground inline-flex items-center gap-1 font-medium"
                  >
                    <CornerDownRight className="w-3 h-3" />
                    <span>Reply ({threadReplies.length})</span>
                  </button>

                  {!isResolved && (
                    <button
                      onClick={() => handleResolve(thread.id)}
                      className="text-status-success hover:bg-status-success/10 px-1.5 py-0.5 rounded inline-flex items-center gap-1 font-medium transition-colors"
                      title="Mark thread as resolved"
                    >
                      <CheckCircle className="w-3 h-3" />
                      <span>Resolve</span>
                    </button>
                  )}
                </div>

                {/* Indented Replies List */}
                {threadReplies.length > 0 && (
                  <div className="pl-3 border-l-2 border-border/70 space-y-2 mt-2 pt-1">
                    {threadReplies.map((r) => (
                      <div key={r.id} className="text-xs space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-text-muted">
                          <span className="font-semibold text-foreground">{r.authorName || 'User'}</span>
                          <span>{new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p className="text-foreground whitespace-pre-wrap">{r.content}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reply Form */}
                {replyingToId === thread.id && (
                  <div className="pt-2 flex gap-2">
                    <input
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Write a reply..."
                      className="flex-1 text-xs px-2.5 py-1 rounded-md bg-canvas border border-border focus:outline-none focus:border-accent text-foreground"
                    />
                    <button
                      onClick={() => handleCreateReply(thread.id)}
                      disabled={!replyText.trim() || isSubmitting}
                      className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground font-semibold text-xs hover:opacity-90 disabled:opacity-50"
                    >
                      Reply
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
