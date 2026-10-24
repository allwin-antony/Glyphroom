import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PlusCircle,
  Clock,
  CheckCircle2,
  FileText,
  Sparkles,
  Edit3,
  Eye,
  Send,
  AlertCircle,
  Calendar,
  Trash2,
  Loader2,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../components/ui/dialog.js';
import type { CatalogPost } from './CatalogView.js';

export const MyWorkView: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<'drafts' | 'in_review' | 'published' | 'suggestions'>('drafts');
  const [posts, setPosts] = useState<CatalogPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submittingPostId, setSubmittingPostId] = useState<string | null>(null);

  // Post Deletion state
  const [postToDelete, setPostToDelete] = useState<CatalogPost | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchMyPosts = () => {
    setIsLoading(true);
    setActionError(null);
    api
      .get<{ posts: CatalogPost[] }>('/posts')
      .then((res) => {
        if (res.posts) {
          setPosts(res.posts);
        }
      })
      .catch((err) => {
        console.error('Failed to load my work posts:', err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  useEffect(() => {
    fetchMyPosts();
  }, []);

  // Filter posts by user ownership if author
  const myPosts = posts.filter((p) => {
    if (!user) return true;
    if (user.role === 'admin') return true;
    return p.authorId === user.userId;
  });

  const drafts = myPosts.filter((p) => p.status === 'draft');
  const inReview = myPosts.filter((p) => p.status === 'in_review');
  const published = myPosts.filter((p) => p.status === 'published');
  const suggestions = myPosts.filter((p) => p.status === 'draft' || p.status === 'in_review');

  const currentTabPosts = {
    drafts,
    in_review: inReview,
    published,
    suggestions,
  }[activeTab];

  const handleSubmitForReview = async (postId: string) => {
    setSubmittingPostId(postId);
    setActionError(null);
    try {
      await api.post(`/posts/${postId}/submit-review`);
      fetchMyPosts();
    } catch (err: any) {
      console.error('Failed to submit post for review:', err);
      setActionError(err.message || 'Unable to submit post for review.');
    } finally {
      setSubmittingPostId(null);
    }
  };

  const handleDeletePost = async () => {
    if (!postToDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`/posts/${postToDelete.id}`);
      setPostToDelete(null);
      fetchMyPosts();
    } catch (err: any) {
      console.error('Failed to delete post:', err);
      setDeleteError(err.message || 'Unable to delete post. Author or Admin permission required.');
    } finally {
      setIsDeleting(false);
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
          <h1 className="text-2xl font-bold text-foreground">My Work Dashboard</h1>
          <p className="text-xs text-text-secondary mt-1">
            Track your ongoing drafts, editorial review submissions, and AI agent suggestions.
          </p>
        </div>
        <button
          onClick={() => navigate('/posts/new')}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:opacity-90 text-primary-foreground font-semibold text-xs shadow-sm self-start sm:self-auto transition-all"
        >
          <PlusCircle className="w-4 h-4" />
          <span>New Article</span>
        </button>
      </div>

      {actionError && (
        <div className="p-3.5 rounded-xl bg-status-danger/10 border border-status-danger/30 text-status-danger text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Segmented Tabs */}
      <div className="flex border-b border-border gap-2 overflow-x-auto">
        {[
          { id: 'drafts', label: `Drafts (${drafts.length})`, icon: FileText },
          { id: 'in_review', label: `In Review (${inReview.length})`, icon: Clock },
          { id: 'published', label: `Published (${published.length})`, icon: CheckCircle2 },
          { id: 'suggestions', label: `Suggestions Waiting (${suggestions.length})`, icon: Sparkles },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`pb-3 px-3 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 shrink-0 ${
                activeTab === tab.id
                  ? 'border-accent-main text-accent-main'
                  : 'border-transparent text-text-muted hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content Table */}
      <div className="rounded-xl bg-surface border border-border shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-text-muted animate-pulse">
            Loading your workspace documents...
          </div>
        ) : currentTabPosts.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full bg-accent-bg flex items-center justify-center text-accent-main">
              <FileText className="w-5 h-5" />
            </div>
            <div className="text-xs text-text-secondary">
              No articles found in this category.
            </div>
            <button
              onClick={() => navigate('/posts/new')}
              className="px-3.5 py-1.5 rounded-lg bg-surface border border-border text-xs font-semibold text-foreground hover:bg-elevated transition-colors"
            >
              Create Draft
            </button>
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-canvas border-b border-border text-text-muted font-semibold uppercase text-[10px]">
              <tr>
                <th className="px-5 py-3">Title</th>
                <th className="px-5 py-3">COE Guild</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Last Modified</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-text-secondary">
              {currentTabPosts.map((post) => (
                <tr key={post.id} className="hover:bg-canvas/50 transition-colors">
                  <td className="px-5 py-4 font-medium text-foreground">
                    <div className="font-semibold">{post.title}</div>
                    {post.slug && (
                      <div className="text-[10px] text-text-muted font-mono mt-0.5">/{post.slug}</div>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    {post.coeName ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-accent-bg text-accent-main border border-accent-main/20">
                        {post.coeName}
                      </span>
                    ) : (
                      <span className="text-text-muted italic text-[11px]">Unassigned</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    {post.status === 'published' ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-status-success/15 text-status-success border border-status-success/30">
                        Published
                      </span>
                    ) : post.status === 'in_review' ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-status-warning/15 text-status-warning border border-status-warning/30">
                        In Review
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-border text-text-secondary border border-border-strong">
                        Draft
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-text-muted text-[11px]">
                    {formatDate(post.updatedAt || post.createdAt)}
                  </td>
                  <td className="px-5 py-4 text-right space-x-2">
                    <button
                      onClick={() => navigate(`/posts/${post.id}/edit`)}
                      className="px-2.5 py-1 rounded bg-canvas hover:bg-elevated text-foreground text-[11px] font-medium border border-border transition-colors inline-flex items-center gap-1"
                    >
                      <Edit3 className="w-3 h-3 text-accent-main" />
                      <span>Edit</span>
                    </button>

                    <button
                      onClick={() => navigate(`/posts/${post.slug || post.id}`)}
                      className="px-2.5 py-1 rounded bg-accent-bg text-accent-main hover:opacity-80 text-[11px] font-semibold transition-colors inline-flex items-center gap-1"
                    >
                      <Eye className="w-3 h-3" />
                      <span>View</span>
                    </button>

                    {post.status === 'draft' && (
                      <button
                        onClick={() => handleSubmitForReview(post.id)}
                        disabled={submittingPostId === post.id}
                        className="px-2.5 py-1 rounded bg-status-warning/15 text-status-warning border border-status-warning/30 hover:bg-status-warning/25 text-[11px] font-semibold transition-colors inline-flex items-center gap-1"
                      >
                        <Send className="w-3 h-3" />
                        <span>{submittingPostId === post.id ? 'Submitting...' : 'Submit'}</span>
                      </button>
                    )}

                    <button
                      onClick={() => setPostToDelete(post)}
                      className="px-2.5 py-1 rounded bg-status-danger/10 text-status-danger border border-status-danger/25 hover:bg-status-danger/20 text-[11px] font-semibold transition-colors inline-flex items-center gap-1"
                      title="Delete Post"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Delete</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Delete Post Confirmation Dialog */}
      <Dialog open={!!postToDelete} onOpenChange={(open) => !open && setPostToDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-status-danger">
              <Trash2 className="w-4 h-4" />
              <span>Delete Document</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-text-secondary mt-1">
              Are you sure you want to delete <strong className="text-foreground">{postToDelete?.title}</strong>? This will permanently delete the post, all version history, and attachments. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteError && (
            <div className="p-3 rounded-lg bg-status-danger/10 text-status-danger border border-status-danger/30 text-xs">
              {deleteError}
            </div>
          )}

          <DialogFooter className="flex items-center gap-2 pt-2">
            <button
              onClick={() => setPostToDelete(null)}
              disabled={isDeleting}
              className="px-3 py-1.5 rounded-lg border border-border bg-canvas text-xs font-semibold text-foreground hover:bg-elevated transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDeletePost}
              disabled={isDeleting}
              className="px-3 py-1.5 rounded-lg bg-status-danger text-white text-xs font-semibold hover:opacity-90 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Deleting...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Confirm Delete</span>
                </>
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
