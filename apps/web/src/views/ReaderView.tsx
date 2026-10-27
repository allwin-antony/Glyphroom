import { SlotRenderer } from '../components/plugins/SlotRenderer.js';
import React, { useState, useEffect, useMemo } from 'react';
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
    return post.derivedMarkdown || post.publishedMarkdown || post.workingMarkdown || `# ${post.title}\n\n${post.excerpt || ''}`;
  }, [post]);

  // Extract headings for Table of Contents
  const tocItems = useMemo<TocItem[]>(() => {
    if (!rawMarkdown) return [];
    const lines = rawMarkdown.split('\n');
    const items: TocItem[] = [];
    let headingIdx = 0;

    for (const line of lines) {
      const match = line.match(/^(#{1,3})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2].trim().replace(/[*_`]/g, '');
        items.push({
          id: `heading-${headingIdx++}`,
          text,
          level,
        });
      }
    }
    return items;
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

  // Render markdown line-by-line helper
  const renderMarkdownContent = () => {
    const lines = rawMarkdown.split('\n');
    const elements: React.ReactNode[] = [];
    let headingCounter = 0;
    let inCodeBlock = false;
    let codeBlockContent: string[] = [];
    let inList = false;
    let listItems: string[] = [];

    const flushList = (key: string) => {
      if (listItems.length > 0) {
        const listEl = (
          <ul className="list-disc pl-6 space-y-1.5 text-text-secondary">
            {listItems.map((item, idx) => (
              <li key={idx} dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
            ))}
          </ul>
        );
        if (readerViewMode === 'block') {
          elements.push(
            <div key={key} className="rounded-xl border border-border bg-surface p-5 shadow-xs my-3">
              <div className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-2 font-bold">
                List Cell
              </div>
              {listEl}
            </div>
          );
        } else {
          elements.push(<div key={key} className="my-3">{listEl}</div>);
        }
        listItems = [];
        inList = false;
      }
    };

    const flushCodeBlock = (key: string) => {
      if (codeBlockContent.length > 0) {
        const preEl = (
          <pre className="p-3.5 rounded-lg bg-code-bg border border-border text-xs font-mono overflow-x-auto text-foreground">
            <code>{codeBlockContent.join('\n')}</code>
          </pre>
        );
        if (readerViewMode === 'block') {
          elements.push(
            <div key={key} className="rounded-xl border border-border bg-surface p-4 shadow-xs my-3">
              <div className="text-[10px] font-mono text-accent font-semibold uppercase tracking-wider mb-2">
                Code Cell
              </div>
              {preEl}
            </div>
          );
        } else {
          elements.push(<div key={key} className="my-4">{preEl}</div>);
        }
        codeBlockContent = [];
        inCodeBlock = false;
      }
    };

    const formatInline = (text: string) => {
      return text
        .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-code-bg font-mono text-[13px] border border-border">$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>');
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code blocks
      if (line.startsWith('```')) {
        if (inCodeBlock) {
          flushCodeBlock(`code-${i}`);
        } else {
          flushList(`list-before-code-${i}`);
          inCodeBlock = true;
          codeBlockContent = [];
        }
        continue;
      }
      if (inCodeBlock) {
        codeBlockContent.push(line);
        continue;
      }

      // Lists
      if (line.startsWith('- ') || line.startsWith('* ')) {
        inList = true;
        listItems.push(line.replace(/^[-*]\s+/, ''));
        continue;
      } else if (inList) {
        flushList(`list-${i}`);
      }

      // Alerts: > [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION]
      if (line.startsWith('> [!')) {
        const alertType = line.match(/> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i)?.[1]?.toLowerCase() || 'note';
        const alertBody: string[] = [];
        let j = i + 1;
        while (j < lines.length && lines[j].startsWith('>')) {
          alertBody.push(lines[j].replace(/^>\s?/, ''));
          j++;
        }
        i = j - 1;

        elements.push(
          <div key={`alert-${i}`} className={`enterprise-alert enterprise-alert-${alertType} my-4`}>
            <div dangerouslySetInnerHTML={{ __html: formatInline(alertBody.join(' ')) }} />
          </div>
        );
        continue;
      }

      // Headings
      if (line.startsWith('# ')) {
        const id = `heading-${headingCounter++}`;
        if (readerViewMode === 'block') {
          elements.push(
            <div key={id} id={id} className="pt-8 pb-2 scroll-mt-20">
              <div className="inline-block px-2 py-0.5 mb-2 rounded bg-accent-bg text-accent text-[10px] font-extrabold uppercase tracking-wider">
                Block Title
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground border-b-2 border-border pb-2">
                {line.replace(/^#\s+/, '')}
              </h1>
            </div>
          );
        } else {
          elements.push(
            <h1 key={id} id={id} className="text-2xl sm:text-3xl font-extrabold text-foreground pt-6 pb-2 scroll-mt-20">
              {line.replace(/^#\s+/, '')}
            </h1>
          );
        }
        continue;
      }
      if (line.startsWith('## ')) {
        const id = `heading-${headingCounter++}`;
        elements.push(
          <h2 key={id} id={id} className="text-xl sm:text-2xl font-bold text-foreground border-b border-border pb-2 pt-6 scroll-mt-20">
            {line.replace(/^##\s+/, '')}
          </h2>
        );
        continue;
      }
      if (line.startsWith('### ')) {
        const id = `heading-${headingCounter++}`;
        elements.push(
          <h3 key={id} id={id} className="text-base sm:text-lg font-bold text-foreground pt-4 scroll-mt-20">
            {line.replace(/^###\s+/, '')}
          </h3>
        );
        continue;
      }

      // Empty line
      if (!line.trim()) {
        continue;
      }

      // Paragraph / Prose card
      if (readerViewMode === 'block') {
        elements.push(
          <div key={`card-${i}`} className="rounded-xl border border-border bg-surface p-5 shadow-xs my-3">
            <div className="text-[10px] font-mono text-text-muted uppercase tracking-wider mb-2 font-bold">
              Text Cell
            </div>
            <p
              className="text-foreground leading-relaxed"
              dangerouslySetInnerHTML={{ __html: formatInline(line) }}
            />
          </div>
        );
      } else {
        elements.push(
          <p
            key={`p-${i}`}
            className="text-text-main leading-relaxed my-2"
            dangerouslySetInnerHTML={{ __html: formatInline(line) }}
          />
        );
      }
    }

    if (inList) flushList('list-end');
    if (inCodeBlock) flushCodeBlock('code-end');

    return elements;
  };

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
                    item.level === 1 ? 'font-semibold' : item.level === 2 ? 'pl-3' : 'pl-6 text-[11px]'
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
              {post.status !== 'published' && (
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-status-warning/15 text-status-warning border border-status-warning/30">
                  Working Snapshot ({post.status})
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
            {renderMarkdownContent()}
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
