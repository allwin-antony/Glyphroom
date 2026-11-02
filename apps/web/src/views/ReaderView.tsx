import { SlotRenderer } from '../components/plugins/SlotRenderer.js';
import React, { useState, useEffect, useMemo } from 'react';
import { MarkdownRenderer } from '../components/reader/MarkdownRenderer.js';
import { parseMarkdown, type BlockNode } from '../components/reader/markdown.js';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Clock,
  Calendar,
  Download,
  SlidersHorizontal,
  Type,
  User,
  Edit3,
  MessageSquare,
  Send,
  Eye,
  CheckCircle2,
  AlertCircle,
  FileText,
  Layers,
  ListOrdered,
  ChevronRight,
  Bookmark,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';

interface PostDetails {
  id: string;
  slug: string;
  title: string;
  excerpt?: string;
  status: 'draft' | 'in_review' | 'approved' | 'published' | 'archived';
  authorId: string;
  authorName?: string;
  authorEmail?: string;
  spaceId?: string | null;
  coeId?: string;
  coeName?: string;
  publishedMarkdown?: string;
  workingMarkdown?: string;
  derivedMarkdown?: string;
  publishedAt?: string;
  /** Upcoming API A: authoritative source of the selected reader content. */
  contentSource?: 'working' | 'submitted' | 'published';
  contentVersionId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CommentItem {
  id: string;
  postId: string;
  authorId: string;
  authorName?: string;
  content: string;
  createdAt: string;
}

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface BookmarkItem {
  postId: string;
  note?: string | null;
}

const TOC_LEVEL_CLASS: Record<number, string> = {
  1: 'font-semibold',
  2: 'pl-3',
  3: 'pl-6 text-[11px]',
  4: 'pl-9 text-[11px]',
  5: 'pl-12 text-[11px]',
  6: 'pl-14 text-[11px]',
};

export const ReaderView: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [post, setPost] = useState<PostDetails | null>(null);
  const [userPermission, setUserPermission] = useState<string>('view');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isBookmarking, setIsBookmarking] = useState(false);

  // Comments state
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  // Reader Comfort Preferences
  const [fontFamily, setFontFamily] = useState<'sans' | 'serif'>('sans');
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg'>('base');
  const [isSepia, setIsSepia] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [showToc, setShowToc] = useState(false);

  // Reader View Mode: 'flow' (continuous) vs 'block' (notebook cards)
  const [readerViewMode, setReaderViewMode] = useState<'flow' | 'block'>(() => {
    return (localStorage.getItem('glyphroom_reader_view_mode') as 'flow' | 'block') || 'block';
  });

  const handleToggleReaderViewMode = (mode: 'flow' | 'block') => {
    setReaderViewMode(mode);
    try {
      localStorage.setItem('glyphroom_reader_view_mode', mode);
    } catch {
      // ignore
    }
  };

  // Bridge window.scrollY and window.scrollTo to the scrollable <main> container
  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    const origScrollTo = window.scrollTo.bind(window);
    window.scrollTo = (optionsOrX: any, y?: any) => {
      if (typeof optionsOrX === 'object') {
        main.scrollTo(optionsOrX);
      } else if (typeof optionsOrX === 'number' && typeof y === 'number') {
        main.scrollTo(optionsOrX, y);
      } else {
        origScrollTo(optionsOrX, y);
      }
    };
    try {
      Object.defineProperty(window, 'scrollY', {
        configurable: true,
        get: () => main.scrollTop,
      });
      Object.defineProperty(window, 'pageYOffset', {
        configurable: true,
        get: () => main.scrollTop,
      });
    } catch {}
    return () => {
      window.scrollTo = origScrollTo;
    };
  }, []);

  // 1. Fetch Post Data
  useEffect(() => {
    if (!slug) return;
    let isCurrent = true;
    setIsLoading(true);
    setError(null);
    setIsBookmarked(false);

    api
      .get<{ post: PostDetails; userPermission: string }>(`/posts/${slug}`)
      .then((res) => {
        if (!isCurrent) return;
        setPost(res.post);
        setUserPermission(res.userPermission);

        api.get<{ bookmarks: BookmarkItem[] }>('/bookmarks')
          .then((bookmarkRes) => {
            if (isCurrent) setIsBookmarked(bookmarkRes.bookmarks.some((item) => item.postId === res.post.id));
          })
          .catch(() => {});

        // Fetch comments for post
        return api
          .get<{ comments: CommentItem[] }>(`/posts/${res.post.id}/comments`)
          .then((commentRes) => {
            if (isCurrent && commentRes.comments) {
              setComments(commentRes.comments);
            }
          })
          .catch((cErr) => {
            console.warn('Could not load comments:', cErr);
          });
      })
      .catch((err: any) => {
        if (isCurrent) {
          console.error('Failed to load post for reader:', err);
          setError(err.message || 'Post not found or access denied.');
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [slug]);

  const handleToggleBookmark = async () => {
    if (!post || isBookmarking) return;
    setIsBookmarking(true);
    try {
      if (isBookmarked) {
        await api.delete(`/bookmarks/${post.id}`);
        setIsBookmarked(false);
      } else {
        await api.post('/bookmarks', { postId: post.id });
        setIsBookmarked(true);
      }
    } catch (err) {
      console.error('Failed to update bookmark:', err);
    } finally {
      setIsBookmarking(false);
    }
  };

  const rawMarkdown = useMemo(() => {
    if (!post) return '';
    // derivedMarkdown is the authoritative selected reader content (API A).
    // Empty derived Markdown stays empty: do not fall back to published or
    // working sources, since the API redacts working content for readers.
    return post.derivedMarkdown ?? '';
  }, [post]);

  // Source label derived from the authoritative contentSource field (API A),
  // not just the workflow status. Backwards-compatible fallback only when the
  // field is genuinely absent; never exposes working content to a reader.
  const sourceLabel = useMemo(() => {
    if (!post) return '';
    if (post.contentSource === 'working') return 'Working Snapshot';
    if (post.contentSource === 'submitted') return 'Submitted Version';
    if (post.contentSource === 'published') return 'Published Version';
    // Field genuinely absent: fall back to workflow status without exposing
    // working content (the API redacts working content for readers).
    return post.status !== 'published' ? `Working Snapshot (${post.status})` : 'Published Version';
  }, [post]);

  // Extract headings for Table of Contents (levels 1-6 aligned with MarkdownRenderer)
  const tocItems = useMemo<TocItem[]>(() => {
    if (!rawMarkdown) return [];
    const { blocks } = parseMarkdown(rawMarkdown);
    return blocks
      .filter((b): b is BlockNode & { type: 'heading'; level: number; id: string; text: string } => b.type === 'heading')
      .map((b) => ({
        id: b.id,
        text: (b.text ?? '').trim().replace(/[*_`]/g, ''),
        level: b.level ?? 1,
      }));
  }, [rawMarkdown]);

  // Handle Export Markdown download
  const handleExportMarkdown = () => {
    if (!post) return;
    const blob = new Blob([rawMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${post.slug || 'publication'}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Handle Adding a Comment
  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!post || !newComment.trim() || isSubmittingComment) return;

    setIsSubmittingComment(true);
    setCommentError(null);
    try {
      const res = await api.post<{ comment: CommentItem }>(`/posts/${post.id}/comments`, {
        content: newComment.trim(),
      });
      if (res.comment) {
        setComments((prev) => [...prev, res.comment]);
        setNewComment('');
      }
    } catch (err: any) {
      console.error('Failed to post comment:', err);
      setCommentError(err.message || 'Unable to submit comment.');
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const getEstimatedReadTime = () => {
    const wordCount = rawMarkdown.trim().split(/\s+/).length;
    const mins = Math.max(1, Math.ceil(wordCount / 200));
    return `${mins} min read`;
  };

  const canEdit = useMemo(() => {
    if (!user || !post) return false;
    if (user.role === 'admin' || user.role === 'moderator') return true;
    return post.authorId === user.userId || userPermission === 'edit';
  }, [user, post, userPermission]);

  const fontSizeClass = {
    sm: 'text-sm leading-relaxed',
    base: 'text-base leading-relaxed',
    lg: 'text-lg leading-relaxed',
  }[fontSize];

  {/* Render markdown content via the unified read-only renderer (ReaderView & ReaderPreview share it). */}
  {/* The renderer output is placed in the article canvas below. */}
  
  if (isLoading) {
    return (
      <div className="max-w-[720px] mx-auto py-12 px-4 space-y-6 animate-pulse">
        <div className="h-4 w-16 bg-border rounded" />
        <div className="h-8 w-3/4 bg-border rounded" />
        <div className="h-4 w-1/2 bg-border rounded" />
        <div className="h-64 rounded-2xl bg-surface border border-border" />
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="max-w-[600px] mx-auto py-16 px-4 text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-full bg-status-danger/10 text-status-danger flex items-center justify-center">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-foreground">Publication Not Accessible</h2>
        <p className="text-xs text-text-secondary">{error || 'This article could not be retrieved or does not exist.'}</p>
        <button
          onClick={() => navigate('/catalog')}
          className="px-4 py-2 rounded-lg bg-surface border border-border hover:bg-elevated text-xs font-semibold text-foreground transition-colors"
        >
          Browse Articles
        </button>
      </div>
    );
  }

  return (
    <div className={`min-h-full py-8 px-4 sm:px-8 transition-colors ${isSepia ? 'bg-[#F1E9D8] text-[#3B3228]' : 'bg-canvas text-foreground'}`}>
      <div className="max-w-[760px] mx-auto space-y-6">
        {/* Navigation & Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Table of Contents Toggle */}
            {tocItems.length > 0 && (
              <button
                onClick={() => setShowToc((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors shadow-sm ${
                  showToc
                    ? 'bg-accent-bg text-accent-main border-accent-main/30'
                    : 'bg-surface border-border text-text-secondary hover:text-foreground'
                }`}
                title="Table of Contents"
              >
                <ListOrdered className="w-3.5 h-3.5" />
                <span>Outline ({tocItems.length})</span>
              </button>
            )}

            {/* Save for later */}
            <button
              onClick={handleToggleBookmark}
              disabled={isBookmarking}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors shadow-sm ${
                isBookmarked
                  ? 'bg-accent-bg text-accent-main border-accent-main/30'
                  : 'bg-surface border-border text-text-secondary hover:text-foreground'
              }`}
              title={isBookmarked ? 'Remove bookmark' : 'Save this article'}
              aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark article'}
            >
              <Bookmark className={`w-3.5 h-3.5 ${isBookmarked ? 'fill-current' : ''}`} />
              <span>{isBookmarked ? 'Saved' : 'Save'}</span>
            </button>

            <SlotRenderer slot="reader:header:actions" context={{ postId: post?.id, spaceId: post?.spaceId }} />

            {/* Reader Preferences Toggle */}
            <button
              onClick={() => setShowPreferences((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors shadow-sm ${
                showPreferences
                  ? 'bg-accent-bg text-accent-main border-accent-main/30'
                  : 'bg-surface border-border text-text-secondary hover:text-foreground'
              }`}
              title="Reading Preferences"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Comfort</span>
            </button>

            {/* View Mode Switcher: Article Flow vs Notebook Blocks */}
            <div className="flex items-center rounded-lg border border-border p-0.5 bg-surface mr-1">
              <button
                onClick={() => handleToggleReaderViewMode('flow')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                  readerViewMode === 'flow'
                    ? 'bg-elevated text-foreground shadow-xs'
                    : 'text-text-muted hover:text-foreground'
                }`}
                title="Continuous Article Flow"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Flow</span>
              </button>
              <button
                onClick={() => handleToggleReaderViewMode('block')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                  readerViewMode === 'block'
                    ? 'bg-elevated text-accent shadow-xs'
                    : 'text-text-muted hover:text-foreground'
                }`}
                title="Notebook Block Cards (.ipynb Mode)"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Blocks</span>
              </button>
            </div>

            {/* Export Markdown Button */}
            <button
              onClick={handleExportMarkdown}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface hover:bg-elevated text-text-main border border-border text-xs font-semibold transition-colors shadow-sm"
              title="Download pure derived Markdown file"
            >
              <Download className="w-3.5 h-3.5 text-accent-main" />
              <span>Export Markdown</span>
            </button>

            {/* Edit in Studio (Authors & Admins) */}
            {canEdit && (
              <button
                onClick={() => navigate(`/posts/${post.id}/edit`)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-semibold text-xs shadow-sm hover:opacity-90 transition-all"
                title="Open in Collaborative Editor Studio"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit</span>
              </button>
            )}
          </div>
        </div>

        {/* Reader Preference Drawer / Bar */}
        {showPreferences && (
          <div className="p-4 rounded-xl bg-surface border border-border shadow-sm flex flex-wrap items-center justify-between gap-4 text-xs animate-in fade-in slide-in-from-top-1 duration-150">
            {/* Font Family */}
            <div className="flex items-center gap-2">
              <span className="text-text-muted flex items-center gap-1 font-medium">
                <Type className="w-3.5 h-3.5" /> Typeface:
              </span>
              <button
                onClick={() => setFontFamily('sans')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  fontFamily === 'sans'
                    ? 'bg-accent-bg text-accent-main font-semibold'
                    : 'text-text-secondary hover:text-foreground'
                }`}
              >
                Sans
              </button>
              <button
                onClick={() => setFontFamily('serif')}
                className={`px-2.5 py-1 rounded-md text-xs font-serif transition-colors ${
                  fontFamily === 'serif'
                    ? 'bg-accent-bg text-accent-main font-semibold'
                    : 'text-text-secondary hover:text-foreground'
                }`}
              >
                Serif
              </button>
            </div>

            {/* Font Size */}
            <div className="flex items-center gap-2">
              <span className="text-text-muted font-medium">Size:</span>
              {(['sm', 'base', 'lg'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFontSize(s)}
                  className={`px-2.5 py-0.5 rounded text-xs uppercase font-medium transition-colors ${
                    fontSize === s
                      ? 'bg-accent-bg text-accent-main font-semibold'
                      : 'text-text-secondary hover:text-foreground'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Sepia Mode Toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsSepia((prev) => !prev)}
                className={`px-3 py-1 rounded-lg border text-xs font-medium transition-colors ${
                  isSepia
                    ? 'bg-[#E5DAC0] text-[#3B3228] border-[#CFC0A4] font-semibold'
                    : 'bg-canvas text-text-secondary border-border hover:text-foreground'
                }`}
              >
                {isSepia ? 'Sepia Active' : 'Sepia Paper'}
              </button>
            </div>
          </div>
        )}

        {/* Collapsible Table of Contents Rail */}
        {showToc && tocItems.length > 0 && (
          <div className="p-4 rounded-xl bg-surface border border-border shadow-sm space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
            <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
              Table of Contents
            </div>
            <div className="space-y-1">
              {tocItems.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className={`block text-xs text-text-secondary hover:text-accent-main transition-colors py-1 truncate ${
                    TOC_LEVEL_CLASS[item.level] || 'pl-6 text-[11px]'
                  }`}
                >
                  {item.text}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Reader Paper Article Canvas */}
        <div
          className={`transition-colors ${
            readerViewMode === 'block'
              ? 'space-y-4'
              : 'rounded-2xl border p-8 sm:p-12 shadow-sm space-y-8 ' + (isSepia ? 'bg-[#F7F0E0] border-[#E4D8BE] text-[#3B3228]' : 'bg-surface border-border text-foreground')
          } ${fontFamily === 'serif' ? 'font-serif' : 'font-sans'}`}
        >
          {/* Article Capsule Header */}
          <div className={`space-y-4 ${
            readerViewMode === 'block'
              ? 'rounded-2xl border border-border bg-surface p-6 sm:p-8 shadow-xs mb-4'
              : 'border-b border-border pb-8'
          }`}>
            <div className="flex items-center gap-2 flex-wrap">
              {post.coeName && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-accent-bg text-accent-main border border-accent-main/20">
                  {post.coeName}
                </div>
              )}
              {(post.contentSource !== undefined || post.status !== 'published') && (
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-status-warning/15 text-status-warning border border-status-warning/30">
                  {sourceLabel}
                </div>
              )}
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">
              {post.title}
            </h1>

            <div className="flex flex-wrap items-center gap-3 text-xs text-text-secondary">
              <span className="flex items-center gap-1.5 font-medium">
                <User className="w-3.5 h-3.5 text-text-muted" />
                <span>By <strong className="text-foreground">{post.authorName || 'Staff Author'}</strong></span>
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-text-muted" />
                <span>
                  {new Date(post.publishedAt || post.createdAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-text-muted" />
                <span>{getEstimatedReadTime()}</span>
              </span>
              {post.slug && (
                <>
                  <span>•</span>
                  <span className="font-mono text-text-muted">/{post.slug}</span>
                </>
              )}
            </div>
          </div>

          {/* Reader Prose Content */}
          <article className={`space-y-4 ${fontSizeClass}`}>
            <MarkdownRenderer markdown={rawMarkdown} mode={readerViewMode} />
          </article>
        </div>

        {/* Reader Comments Section */}
        <div className="rounded-2xl bg-surface border border-border p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-accent-main" />
              <span>Discussion & Peer Notes ({comments.length})</span>
            </h3>
          </div>

          {/* Comment submission form */}
          {user ? (
            <form onSubmit={handleAddComment} className="space-y-3">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Leave feedback, architectural questions, or reading notes..."
                rows={3}
                className="w-full p-3 rounded-xl bg-canvas border border-border-strong text-xs text-foreground placeholder:text-text-muted focus:outline-none focus:border-accent-main resize-none"
              />
              {commentError && (
                <div className="text-xs text-status-danger">{commentError}</div>
              )}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={!newComment.trim() || isSubmittingComment}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground font-semibold text-xs shadow-sm hover:opacity-90 disabled:opacity-50 transition-all"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSubmittingComment ? 'Posting...' : 'Post Note'}</span>
                </button>
              </div>
            </form>
          ) : (
            <div className="p-4 rounded-xl bg-canvas text-center text-xs text-text-secondary">
              Sign in to participate in the peer commentary on this article.
            </div>
          )}

          {/* Comments list */}
          <div className="space-y-4">
            {comments.length === 0 ? (
              <div className="text-xs text-text-muted py-4 text-center italic">
                No discussion notes posted yet. Be the first to start the conversation!
              </div>
            ) : (
              comments.map((comment) => (
                <div key={comment.id} className="p-4 rounded-xl bg-canvas border border-border space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-text-muted">
                    <span className="font-semibold text-foreground">
                      {comment.authorName || 'Peer Reviewer'}
                    </span>
                    <span>
                      {new Date(comment.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    {comment.content}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
