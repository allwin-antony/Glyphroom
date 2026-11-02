import React, { useState, useEffect, useRef } from 'react';
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
  Loader2,
  X,
  ExternalLink,
  BookOpen,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import type { CatalogPost } from './CatalogView.js';

function reviewCheckpoint(post?: CatalogPost) {
  const version = post?.submittedVersion;
  return post && ['in_review', 'approved'].includes(post.status) && version
    && typeof version.id === 'string' && version.id.length > 0 && version.id === post.submittedVersionId
    && version.triggerReason === 'review_submission' && typeof version.markdownSnapshot === 'string'
    && Number.isInteger(version.versionNumber) && version.versionNumber > 0 ? version : null;
}

export const ReviewQueueView: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [posts, setPosts] = useState<CatalogPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [queuePage, setQueuePage] = useState(1);
  const [queuePagination, setQueuePagination] = useState<{ page: number; limit: number; total: number; totalPages: number; hasNextPage: boolean } | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const queueRequest = useRef<AbortController | null>(null);
  const queueSequence = useRef(0);
  const REVIEW_LIMIT = 24;
  const [activeReviewPost, setActiveReviewPost] = useState<CatalogPost | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [reviewDetails, setReviewDetails] = useState<{ post: CatalogPost; permission: string } | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const detailSequence = useRef(0);
  const detailRequest = useRef<AbortController | null>(null);
  const decisionRequest = useRef<AbortController | null>(null);
  const checkpoint = reviewCheckpoint(reviewDetails?.post);
  const canDecide = Boolean(checkpoint && reviewDetails?.post.status === 'in_review'
    && reviewDetails.post.authorId !== user?.userId && ['admin', 'review'].includes(reviewDetails.permission));
  const canPublish = Boolean(checkpoint && reviewDetails?.post.status === 'approved'
    && (reviewDetails.permission === 'admin' || user?.role === 'admin'
      || (user?.role === 'moderator' && reviewDetails.post.authorId !== user.userId)));

  const closeReviewModal = () => {
    detailSequence.current++;
    detailRequest.current?.abort();
    decisionRequest.current?.abort();
    decisionRequest.current = null;
    setActiveReviewPost(null);
    setReviewDetails(null);
    setIsLoadingDetails(false);
    setIsSubmitting(false);
  };

  const openReviewModal = async (post: CatalogPost) => {
    const sequence = ++detailSequence.current;
    detailRequest.current?.abort();
    decisionRequest.current?.abort();
    decisionRequest.current = null;
    const controller = new AbortController();
    detailRequest.current = controller;
    setActiveReviewPost(post);
    setReviewDetails(null);
    setDetailError(null);
    setReviewNotes('');
    setIsLoadingDetails(true);
    setIsSubmitting(false);
    try {
      const res = await api.get<{ post: CatalogPost; userPermission: string }>(`/posts/${post.id}`, { signal: controller.signal });
      if (controller.signal.aborted || sequence !== detailSequence.current) return;
      if (res?.post?.id !== post.id || !reviewCheckpoint(res.post)) throw new Error('The submitted checkpoint is unavailable. Reload before reviewing.');
      setActiveReviewPost(res.post);
      setReviewDetails({ post: res.post, permission: res.userPermission });
    } catch (err: any) {
      if (!controller.signal.aborted && sequence === detailSequence.current) {
        setDetailError(err?.message || 'Unable to load the submitted checkpoint.');
      }
    } finally {
      if (sequence === detailSequence.current) setIsLoadingDetails(false);
    }
  };

  const buildReviewQueueUrl = (page: number) => {
    const params = new URLSearchParams();
    params.append('status', 'in_review');
    params.append('status', 'approved');
    params.set('page', String(page));
    params.set('limit', String(REVIEW_LIMIT));
    return `/posts?${params.toString()}`;
  };

  const fetchReviewQueue = (page = queuePage, clamped = false) => {
    setIsLoading(true);
    setQueueError(null);
    queueRequest.current?.abort();
    const sequence = ++queueSequence.current;
    const controller = new AbortController();
    queueRequest.current = controller;

    api.get<{ posts: CatalogPost[]; pagination?: { page: number; limit: number; total: number; totalPages: number; hasNextPage: boolean } }>(buildReviewQueueUrl(page), { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted || sequence !== queueSequence.current) return;
        const received = res.posts || [];
        setPosts(received);
        setQueuePagination(res.pagination || null);
        // If concurrent decisions removed whole pages, jump directly to the server's valid last page once.
        const validLastPage = Math.max(1, res.pagination?.totalPages ?? 1);
        if (page > validLastPage && received.length === 0 && !clamped) {
          setQueuePage(validLastPage);
          fetchReviewQueue(validLastPage, true);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted || sequence !== queueSequence.current) return;
        setQueueError(err.message || 'Unable to load the review queue.');
      })
      .finally(() => {
        if (controller.signal.aborted || sequence !== queueSequence.current) return;
        setIsLoading(false);
      });
  };

  const goToQueuePage = (page: number) => {
    const totalPages = queuePagination?.totalPages ?? 1;
    if (page < 1 || page > totalPages || page === queuePage) return;
    setQueuePage(page);
    fetchReviewQueue(page);
  };

  useEffect(() => {
    fetchReviewQueue();
    return () => {
      queueRequest.current?.abort();
      detailSequence.current++;
      detailRequest.current?.abort();
      decisionRequest.current?.abort();
    };
  }, []);

  const handleReviewDecision = async (decision: 'approved' | 'changes_requested') => {
    if (!reviewDetails || !checkpoint || !canDecide || decisionRequest.current) return;
    const sequence = detailSequence.current;
    const controller = new AbortController();
    decisionRequest.current = controller;
    const post = reviewDetails.post;
    setIsSubmitting(true);
    setFeedbackMessage(null);

    try {
      await api.post(`/posts/${post.id}/reviews`, {
        decision,
        notes: reviewNotes.trim() || undefined,
        submittedVersionId: checkpoint.id,
      }, { signal: controller.signal });
      if (controller.signal.aborted || sequence !== detailSequence.current) return;

      setFeedbackMessage({
        type: 'success',
        text: `Successfully ${decision === 'approved' ? 'approved' : 'requested changes on'} "${post.title}".`,
      });
      closeReviewModal();
      setReviewNotes('');
      fetchReviewQueue();
    } catch (err: any) {
      if (controller.signal.aborted || sequence !== detailSequence.current) return;
      setReviewDetails(null);
      setDetailError(err.message || 'Unable to submit review decision. Reload the checkpoint before trying again.');
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Unable to submit review decision.',
      });
    } finally {
      if (decisionRequest.current === controller) {
        decisionRequest.current = null;
        setIsSubmitting(false);
      }
    }
  };

  const handlePublishPost = async (postId: string) => {
    if (!reviewDetails || !checkpoint || !canPublish || reviewDetails.post.id !== postId || decisionRequest.current) return;
    const sequence = detailSequence.current;
    const controller = new AbortController();
    decisionRequest.current = controller;
    setIsSubmitting(true);
    setFeedbackMessage(null);
    try {
      await api.post(`/posts/${postId}/publish`, { submittedVersionId: checkpoint.id }, { signal: controller.signal });
      if (controller.signal.aborted || sequence !== detailSequence.current) return;
      setFeedbackMessage({
        type: 'success',
        text: 'Post published successfully to the knowledge catalog!',
      });
      if (activeReviewPost?.id === postId) {
        closeReviewModal();
      }
      fetchReviewQueue();
    } catch (err: any) {
      if (controller.signal.aborted || sequence !== detailSequence.current) return;
      setReviewDetails(null);
      setDetailError(err.message || 'Unable to publish. Reload the checkpoint before trying again.');
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Unable to publish post.',
      });
    } finally {
      if (decisionRequest.current === controller) {
        decisionRequest.current = null;
        setIsSubmitting(false);
      }
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
        ) : queueError ? (
          <div className="p-12 text-center space-y-3">
            <AlertCircle className="w-10 h-10 mx-auto text-status-danger" />
            <h3 className="text-sm font-bold text-foreground">Unable to load review queue</h3>
            <p className="text-xs text-text-secondary max-w-sm mx-auto">{queueError}</p>
            <button
              onClick={() => fetchReviewQueue(queuePage)}
              className="px-3.5 py-1.5 rounded-lg bg-surface border border-border text-xs font-semibold text-foreground hover:bg-elevated transition-colors"
            >
              Try again
            </button>
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
                      onClick={() => openReviewModal(post)}
                      className="px-3 py-1 rounded bg-primary text-primary-foreground font-semibold text-xs shadow-sm hover:opacity-90 transition-all inline-flex items-center gap-1.5"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Review Post</span>
                    </button>

                    {post.status === 'approved' && (
                      <button
                        onClick={() => openReviewModal(post)}
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

      {!isLoading && !queueError && queuePagination && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-t border-border bg-canvas/50">
          <div className="text-xs text-text-secondary">
            {queuePagination.total} submission{queuePagination.total !== 1 ? 's' : ''} &bull;{' '}
            page {queuePagination.page} of {queuePagination.totalPages}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => goToQueuePage(queuePage - 1)}
              disabled={queuePage === 1 || isLoading}
              aria-label="Previous page"
              className="px-3 py-1 rounded bg-surface border border-border text-xs font-semibold text-foreground hover:bg-elevated disabled:opacity-50 disabled:pointer-events-none transition-colors"
            >
              Prev
            </button>
            <button
              onClick={() => goToQueuePage(queuePage + 1)}
              disabled={!queuePagination.hasNextPage || isLoading}
              aria-label="Next page"
              className="px-3 py-1 rounded bg-surface border border-border text-xs font-semibold text-foreground hover:bg-elevated disabled:opacity-50 disabled:pointer-events-none transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Review Workspace Modal */}
      {activeReviewPost && (
        <div role="dialog" aria-modal="true" aria-labelledby="review-post-title" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-border flex items-center justify-between bg-canvas/40">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-accent-main">
                  Editorial Review Workspace
                </div>
                <h2 id="review-post-title" className="text-base font-bold text-foreground mt-0.5">
                  {activeReviewPost.title}
                </h2>
                <div className="text-xs text-text-secondary mt-0.5">
                  Authored by <strong className="text-foreground">{activeReviewPost.authorName || 'Author'}</strong>
                  {activeReviewPost.coeName && ` • ${activeReviewPost.coeName}`}
                </div>
              </div>
              <button
                onClick={closeReviewModal}
                className="p-1 rounded-lg text-text-muted hover:text-foreground hover:bg-canvas transition-colors"
                aria-label="Close review modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content / Preview */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              {checkpoint && (
                  <div className="p-3 rounded-xl bg-status-warning/10 border border-status-warning/30 text-status-warning flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <div className="font-semibold text-foreground">
                         Reviewing Submitted Snapshot v{checkpoint.versionNumber}
                      </div>
                      <div className="text-[11px] text-text-secondary leading-relaxed">
                        Decisions apply to this immutable submitted checkpoint. Subsequent working edits are not included.
                      </div>
                    </div>
                  </div>
                )}

              <div className="space-y-2">
                <div className="font-semibold text-foreground flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span>Document Snapshot</span>
                    {checkpoint && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-accent/10 text-accent border border-accent/20">
                        v{checkpoint.versionNumber} checkpoint
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => navigate(`/posts/${activeReviewPost.slug || activeReviewPost.id}`)}
                    className="text-accent-main hover:underline flex items-center gap-1 text-[11px]"
                  >
                    <span>Open Full Reader View</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
                {isLoadingDetails ? (
                  <div role="status" className="p-4 text-text-muted">Loading submitted checkpoint...</div>
                ) : detailError ? (
                  <div role="alert" className="p-4 rounded-xl border border-status-danger/30 text-status-danger">
                    <p>{detailError}</p>
                    <button className="mt-2 underline" onClick={() => openReviewModal(activeReviewPost)}>Reload checkpoint</button>
                  </div>
                ) : checkpoint ? (
                  <div data-testid="review-checkpoint" className="p-4 rounded-xl bg-canvas border border-border max-h-60 overflow-y-auto font-mono text-[11px] text-text-secondary leading-relaxed whitespace-pre-wrap">
                    {checkpoint.markdownSnapshot === '' ? 'This submitted checkpoint is empty.' : checkpoint.markdownSnapshot}
                  </div>
                ) : null}
              </div>

              {/* Reviewer Feedback Notes */}
              <div className="space-y-2">
                <label className="block font-semibold text-foreground">
                  Review Notes & Editorial Guidance
                </label>
                  <textarea
                    disabled={isSubmitting || !canDecide}
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
                onClick={closeReviewModal}
                className="px-3.5 py-1.5 rounded-lg border border-border bg-surface text-text-secondary hover:text-foreground text-xs font-semibold transition-colors"
              >
                Cancel
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleReviewDecision('changes_requested')}
                  disabled={isSubmitting || !canDecide || isLoadingDetails || Boolean(detailError)}
                  className="px-3.5 py-1.5 rounded-lg border border-status-danger/30 bg-status-danger/10 text-status-danger hover:bg-status-danger/20 text-xs font-semibold transition-colors inline-flex items-center gap-1.5"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Request Changes</span>
                </button>

                <button
                  onClick={() => handleReviewDecision('approved')}
                  disabled={isSubmitting || !canDecide || isLoadingDetails || Boolean(detailError)}
                  className="px-3.5 py-1.5 rounded-lg bg-status-success text-white text-xs font-semibold shadow-sm hover:opacity-90 transition-all inline-flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Approve Submission</span>
                </button>

                <button
                  onClick={() => handlePublishPost(activeReviewPost.id)}
                  disabled={isSubmitting || !canPublish || isLoadingDetails || Boolean(detailError)}
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
