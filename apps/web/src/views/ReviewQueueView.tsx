import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldAlert,
  Clock,
  CheckCircle2,
  XCircle,
  FileText,
  Send,
  Eye,
  AlertCircle,
  X,
  ExternalLink,
  BookOpen,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import type { CatalogPost } from './CatalogView.js';

export const ReviewQueueView: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [posts, setPosts] = useState<CatalogPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeReviewPost, setActiveReviewPost] = useState<CatalogPost | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchReviewQueue = () => {
    setIsLoading(true);
    api
      .get<{ posts: CatalogPost[] }>('/posts')
      .then((res) => {
        if (res.posts) {
          // Review queue focuses on in_review and approved posts
          const queue = res.posts.filter((p) => p.status === 'in_review' || p.status === 'approved');
          setPosts(queue);
        }
      })
      .catch((err) => {
        console.error('Failed to load review queue:', err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  useEffect(() => {
    fetchReviewQueue();
  }, []);

  const handleReviewDecision = async (decision: 'approved' | 'changes_requested') => {
    if (!activeReviewPost) return;
    setIsSubmitting(true);
    setFeedbackMessage(null);

    try {
      await api.post(`/posts/${activeReviewPost.id}/reviews`, {
        decision,
        notes: reviewNotes.trim() || undefined,
      });

      setFeedbackMessage({
        type: 'success',
        text: `Successfully ${decision === 'approved' ? 'approved' : 'requested changes on'} "${activeReviewPost.title}".`,
      });
      setActiveReviewPost(null);
      setReviewNotes('');
      fetchReviewQueue();
    } catch (err: any) {
      console.error('Review decision failed:', err);
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Unable to submit review decision.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePublishPost = async (postId: string) => {
    setIsSubmitting(true);
    setFeedbackMessage(null);
    try {
      await api.post(`/posts/${postId}/publish`);
      setFeedbackMessage({
        type: 'success',
        text: 'Post published successfully to the knowledge catalog!',
      });
      if (activeReviewPost?.id === postId) {
        setActiveReviewPost(null);
      }
      fetchReviewQueue();
    } catch (err: any) {
      console.error('Publish failed:', err);
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Unable to publish post.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Recently';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-status-warning" />
            <span>Moderator Review Queue</span>
          </h1>
          <p className="text-xs text-text-secondary mt-1">
            Review pending submissions, inspect snapshot diffs, and approve or request changes before publication.
          </p>
        </div>
      </div>

      {feedbackMessage && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
            feedbackMessage.type === 'success'
              ? 'bg-status-success/10 border-status-success/30 text-status-success'
              : 'bg-status-danger/10 border-status-danger/30 text-status-danger'
          }`}
        >
          {feedbackMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{feedbackMessage.text}</span>
        </div>
      )}

      {/* Review Queue Table */}
      <div className="rounded-xl bg-surface border border-border shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-text-muted animate-pulse">
            Loading editorial review queue...
          </div>
        ) : posts.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full bg-status-success/10 text-status-success flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-foreground">Review Queue is Clear!</h3>
            <p className="text-xs text-text-secondary max-w-sm mx-auto">
              There are currently no articles waiting for moderator review or publication approval.
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-canvas border-b border-border text-text-muted font-semibold uppercase text-[10px]">
              <tr>
                <th className="px-5 py-3">Title</th>
                <th className="px-5 py-3">Author</th>
                <th className="px-5 py-3">COE Guild</th>
                <th className="px-5 py-3">Submitted</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-text-secondary">
              {posts.map((post) => (
                <tr key={post.id} className="hover:bg-canvas/50 transition-colors">
                  <td className="px-5 py-4 font-semibold text-foreground">
                    <div>{post.title}</div>
                    {post.slug && (
                      <div className="text-[10px] text-text-muted font-mono mt-0.5">/{post.slug}</div>
                    )}
                  </td>
                  <td className="px-5 py-4">{post.authorName || 'Author'}</td>
                  <td className="px-5 py-4">
                    {post.coeName ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-accent-bg text-accent-main border border-accent-main/20">
                        {post.coeName}
                      </span>
                    ) : (
                      <span className="text-text-muted italic text-[11px]">Unassigned</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-text-muted text-[11px]">
                    {formatDate(post.updatedAt || post.createdAt)}
                  </td>
                  <td className="px-5 py-4">
                    {post.status === 'in_review' ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-status-warning/15 text-status-warning border border-status-warning/30">
                        In Review
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-accent-bg text-accent-main border border-accent-main/30">
                        Approved
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-right space-x-2">
                    <button
                      onClick={() => {
                        setActiveReviewPost(post);
                        setReviewNotes('');
                      }}
                      className="px-3 py-1 rounded bg-primary text-primary-foreground font-semibold text-xs shadow-sm hover:opacity-90 transition-all inline-flex items-center gap-1.5"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Review Post</span>
                    </button>

                    {post.status === 'approved' && (
                      <button
                        onClick={() => handlePublishPost(post.id)}
                        disabled={isSubmitting}
                        className="px-3 py-1 rounded bg-status-success text-white font-semibold text-xs shadow-sm hover:opacity-90 transition-all"
                      >
                        Publish
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Review Workspace Modal */}
      {activeReviewPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-border flex items-center justify-between bg-canvas/40">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-accent-main">
                  Editorial Review Workspace
                </div>
                <h2 className="text-base font-bold text-foreground mt-0.5">
                  {activeReviewPost.title}
                </h2>
                <div className="text-xs text-text-secondary mt-0.5">
                  Authored by <strong className="text-foreground">{activeReviewPost.authorName || 'Author'}</strong>
                  {activeReviewPost.coeName && ` • ${activeReviewPost.coeName}`}
                </div>
              </div>
              <button
                onClick={() => setActiveReviewPost(null)}
                className="p-1 rounded-lg text-text-muted hover:text-foreground hover:bg-canvas transition-colors"
                aria-label="Close review modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content / Preview */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              <div className="space-y-2">
                <div className="font-semibold text-foreground flex items-center justify-between">
                  <span>Document Snapshot</span>
                  <button
                    onClick={() => navigate(`/posts/${activeReviewPost.slug || activeReviewPost.id}`)}
                    className="text-accent-main hover:underline flex items-center gap-1 text-[11px]"
                  >
                    <span>Open Full Reader View</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
                <div className="p-4 rounded-xl bg-canvas border border-border max-h-60 overflow-y-auto font-mono text-[11px] text-text-secondary leading-relaxed whitespace-pre-wrap">
                  {activeReviewPost.workingMarkdown ||
                    activeReviewPost.publishedMarkdown ||
                    activeReviewPost.excerpt ||
                    '# ' + activeReviewPost.title}
                </div>
              </div>

              {/* Reviewer Feedback Notes */}
              <div className="space-y-2">
                <label className="block font-semibold text-foreground">
                  Review Notes & Editorial Guidance
                </label>
                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Provide constructive feedback for the author or state your reasoning for approval..."
                  rows={3}
                  className="w-full p-3 rounded-xl bg-canvas border border-border-strong text-xs text-foreground placeholder:text-text-muted focus:outline-none focus:border-accent-main resize-none"
                />
              </div>
            </div>

            {/* Modal Actions */}
            <div className="p-4 border-t border-border flex flex-wrap items-center justify-between gap-3 bg-canvas/40">
              <button
                onClick={() => setActiveReviewPost(null)}
                className="px-3.5 py-1.5 rounded-lg border border-border bg-surface text-text-secondary hover:text-foreground text-xs font-semibold transition-colors"
              >
                Cancel
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleReviewDecision('changes_requested')}
                  disabled={isSubmitting}
                  className="px-3.5 py-1.5 rounded-lg border border-status-danger/30 bg-status-danger/10 text-status-danger hover:bg-status-danger/20 text-xs font-semibold transition-colors inline-flex items-center gap-1.5"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Request Changes</span>
                </button>

                <button
                  onClick={() => handleReviewDecision('approved')}
                  disabled={isSubmitting}
                  className="px-3.5 py-1.5 rounded-lg bg-status-success text-white text-xs font-semibold shadow-sm hover:opacity-90 transition-all inline-flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Approve Submission</span>
                </button>

                <button
                  onClick={() => handlePublishPost(activeReviewPost.id)}
                  disabled={isSubmitting}
                  className="px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold shadow-sm hover:opacity-90 transition-all inline-flex items-center gap-1.5"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Publish to Catalog</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
