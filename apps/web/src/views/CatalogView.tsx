import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  LayoutGrid,
  List,
  User,
  Calendar,
  Clock,
  Edit3,
  BookOpen,
  Plus,
  ArrowUpDown,
  Filter,
  CheckCircle2,
  AlertCircle,
  FileText,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';

export interface CatalogPost {
  id: string;
  slug: string;
  title: string;
  excerpt?: string;
  status: 'draft' | 'in_review' | 'approved' | 'published' | 'archived';
  authorId: string;
  authorName?: string;
  authorEmail?: string;
  coeId?: string;
  coeName?: string;
  publishedMarkdown?: string;
  workingMarkdown?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface CatalogPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
}

interface CatalogResponse {
  posts: CatalogPost[];
  pagination?: CatalogPagination;
}

export const CatalogView: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [posts, setPosts] = useState<CatalogPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [pagination, setPagination] = useState<CatalogPagination | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filters & Controls
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCoe, setSelectedCoe] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'title'>('newest');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    return (localStorage.getItem('glyphroom_catalog_view') as 'grid' | 'list') || 'grid';
  });

  const handleViewModeChange = (mode: 'grid' | 'list') => {
    setViewMode(mode);
    localStorage.setItem('glyphroom_catalog_view', mode);
  };

  const buildCatalogUrl = (page: number) => {
    const params = new URLSearchParams();
    if (searchTerm.trim()) params.set('search', searchTerm.trim());
    if (selectedCoe !== 'all') params.set('coe', selectedCoe);
    if (selectedStatus !== 'all') params.set('status', selectedStatus);
    if (sortBy !== 'newest') params.set('sort', sortBy);
    if (page > 1) params.set('page', String(page));
    return params.toString() ? `/posts?${params.toString()}` : '/posts';
  };

  // Fetch one server-filtered page from the API. The debounce keeps live search responsive.
  useEffect(() => {
    let isCurrent = true;
    const fetchTimer = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      setPagination(null);
      try {
        const res = await api.get<CatalogResponse>(buildCatalogUrl(1));
        if (isCurrent) {
          setPosts(res.posts || []);
          // Older API-shaped mocks remain usable while the server always returns this metadata.
          setPagination(res.pagination || null);
        }
      } catch (err: any) {
        if (isCurrent) {
          console.error('Failed to load posts catalog:', err);
          setError(err.message || 'Unable to retrieve knowledge catalog.');
        }
      } finally {
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    }, 250); // 250ms debounce for live search

    return () => {
      isCurrent = false;
      clearTimeout(fetchTimer);
    };
  }, [searchTerm, selectedCoe, selectedStatus, sortBy]);

  const loadMore = async () => {
    if (!pagination?.hasNextPage || isLoadingMore) return;
    setIsLoadingMore(true);
    setError(null);
    try {
      const res = await api.get<CatalogResponse>(buildCatalogUrl(pagination.page + 1));
      setPosts((current) => [...current, ...(res.posts || [])]);
      setPagination(res.pagination || {
        ...pagination,
        page: pagination.page + 1,
        hasNextPage: false,
      });
    } catch (err: any) {
      console.error('Failed to load more catalog posts:', err);
      setError(err.message || 'Unable to retrieve more catalog posts.');
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Extract distinct COEs for filter dropdown
  const coeOptions = useMemo(() => {
    const set = new Set<string>();
    ['Architecture', 'Engineering', 'Security', 'DevOps & SRE', 'Cloud Platform'].forEach((c) => set.add(c));
    posts.forEach((p) => {
      if (p.coeName) set.add(p.coeName);
    });
    return Array.from(set).sort();
  }, [posts]);

  const canEditPost = (post: CatalogPost) => {
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'moderator') return true;
    return post.authorId === user.userId;
  };

  const getEstimatedReadTime = (post: CatalogPost) => {
    const text = post.publishedMarkdown || post.workingMarkdown || post.excerpt || '';
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 200;
    const mins = Math.max(1, Math.ceil(wordCount / 200));
    return `${mins} min read`;
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Recently';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const getStatusBadge = (status: CatalogPost['status']) => {
    switch (status) {
      case 'published':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-status-success/15 text-status-success border border-status-success/30">
            <CheckCircle2 className="w-2.5 h-2.5" /> Published
          </span>
        );
      case 'in_review':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-status-warning/15 text-status-warning border border-status-warning/30">
            <Clock className="w-2.5 h-2.5" /> In Review
          </span>
        );
      case 'draft':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-border text-text-secondary border border-border-strong">
            <FileText className="w-2.5 h-2.5" /> Draft
          </span>
        );
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-accent-main" />
            <span>Catalog</span>
          </h1>
          <p className="text-xs text-text-secondary mt-1">
            Browse, search, and discover articles and perspectives across topics.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* New Post Button */}
          {user && user.role !== 'reader' && (
            <button
              onClick={() => navigate('/posts/new')}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground font-semibold text-xs shadow-sm hover:opacity-90 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Draft Post</span>
            </button>
          )}

          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-surface border border-border shadow-sm">
            <button
              onClick={() => handleViewModeChange('grid')}
              className={`p-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'grid'
                  ? 'bg-accent-bg text-accent-main'
                  : 'text-text-muted hover:text-foreground'
              }`}
              aria-label="Grid view"
              title="Grid View"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleViewModeChange('list')}
              className={`p-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'list'
                  ? 'bg-accent-bg text-accent-main'
                  : 'text-text-muted hover:text-foreground'
              }`}
              aria-label="List view"
              title="List View"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 p-4 rounded-xl bg-surface border border-border shadow-sm">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by title, excerpt, author, or content..."
            className="w-full pl-9 pr-4 py-2 rounded-lg bg-canvas border border-border-strong text-xs text-foreground placeholder:text-text-muted focus:outline-none focus:border-accent-main"
          />
        </div>

        {/* COE Filter */}
        <select
          value={selectedCoe}
          onChange={(e) => setSelectedCoe(e.target.value)}
          className="px-3 py-2 rounded-lg bg-canvas border border-border-strong text-xs text-foreground focus:outline-none focus:border-accent-main"
        >
          <option value="all">All Topics</option>
          {coeOptions.map((coe) => (
            <option key={coe} value={coe}>
              {coe}
            </option>
          ))}
        </select>

        {/* Status Filter (Authors & Admins) */}
        {user && user.role !== 'reader' && (
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-2 rounded-lg bg-canvas border border-border-strong text-xs text-foreground focus:outline-none focus:border-accent-main"
          >
            <option value="all">All Statuses</option>
            <option value="published">Published</option>
            <option value="in_review">In Review</option>
            <option value="draft">Drafts</option>
          </select>
        )}

        {/* Sort Dropdown */}
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-canvas border border-border-strong text-xs text-text-secondary">
          <ArrowUpDown className="w-3.5 h-3.5 text-text-muted" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="bg-transparent text-foreground text-xs focus:outline-none cursor-pointer"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="title">Alphabetical (A–Z)</option>
          </select>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl bg-status-danger/10 border border-status-danger/30 text-status-danger text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading && (
        <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5' : 'space-y-3'}>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div
              key={n}
              className="p-5 rounded-xl bg-surface border border-border animate-pulse space-y-3"
            >
              <div className="flex justify-between items-center">
                <div className="h-4 w-20 bg-border rounded" />
                <div className="h-3 w-14 bg-border rounded" />
              </div>
              <div className="h-5 w-3/4 bg-border rounded" />
              <div className="h-4 w-full bg-border rounded" />
              <div className="h-4 w-2/3 bg-border rounded" />
              <div className="pt-3 border-t border-border flex justify-between">
                <div className="h-3 w-24 bg-border rounded" />
                <div className="h-3 w-16 bg-border rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && posts.length === 0 && (
        <div className="text-center py-16 px-4 rounded-2xl bg-surface border border-border border-dashed space-y-4">
          <div className="w-12 h-12 mx-auto rounded-full bg-accent-bg flex items-center justify-center text-accent-main">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">No matching publications found</h3>
            <p className="text-xs text-text-secondary mt-1 max-w-sm mx-auto">
              {searchTerm || selectedCoe !== 'all' || selectedStatus !== 'all'
                ? 'Try broadening your search term or resetting your filter criteria.'
                : 'The catalog is currently empty. Be the first to write and share an article!'}
            </p>
          </div>
          <div className="flex justify-center gap-3 pt-2">
            {(searchTerm || selectedCoe !== 'all' || selectedStatus !== 'all') ? (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setSelectedCoe('all');
                  setSelectedStatus('all');
                }}
                className="px-3.5 py-1.5 rounded-lg bg-surface border border-border text-xs font-semibold text-foreground hover:bg-elevated transition-colors"
              >
                Clear Filters
              </button>
            ) : user && user.role !== 'reader' ? (
              <button
                onClick={() => navigate('/posts/new')}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold shadow-sm hover:opacity-90 transition-all"
              >
                Draft New Post
              </button>
            ) : null}
          </div>
        </div>
      )}

      {/* Catalog Posts Grid / List */}
      {!isLoading && posts.length > 0 && (
        <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5' : 'space-y-3'}>
          {posts.map((post) => {
            const readTime = getEstimatedReadTime(post);
            const dateDisplay = formatDate(post.publishedAt || post.createdAt);
            const isAuthorOrAdmin = canEditPost(post);

            if (viewMode === 'list') {
              return (
                <div
                  key={post.id}
                  className="p-4 rounded-xl bg-surface border border-border hover:border-accent-main transition-all hover:bg-elevated/40 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 group"
                >
                  <div
                    onClick={() => navigate(`/posts/${post.slug || post.id}`)}
                    className="flex-1 cursor-pointer space-y-1"
                  >
                    <div className="flex items-center gap-2 text-xs">
                      {getStatusBadge(post.status)}
                      {post.coeName && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-accent-bg text-accent-main border border-accent-main/20">
                          {post.coeName}
                        </span>
                      )}
                      <span className="text-text-muted text-[11px]">• {readTime}</span>
                    </div>
                    <h3 className="text-sm font-bold text-foreground group-hover:text-accent-main transition-colors">
                      {post.title}
                    </h3>
                    {post.excerpt && (
                      <p className="text-xs text-text-secondary line-clamp-1 leading-relaxed">
                        {post.excerpt}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 text-[11px] text-text-muted shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border">
                    <span className="flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-text-secondary" />
                      <span>{post.authorName || 'Staff Author'}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-text-secondary" />
                      <span>{dateDisplay}</span>
                    </span>

                    <div className="flex items-center gap-1 pl-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/posts/${post.slug || post.id}`);
                        }}
                        className="px-2.5 py-1 rounded bg-canvas border border-border hover:border-accent-main text-text-main font-semibold text-xs transition-colors"
                      >
                        Read
                      </button>
                      {isAuthorOrAdmin && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/posts/${post.id}/edit`);
                          }}
                          className="p-1 rounded bg-canvas border border-border hover:border-accent-main text-accent-main transition-colors"
                          title="Edit in Studio"
                          aria-label="Edit post"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            // Grid Card View
            return (
              <div
                key={post.id}
                onClick={() => navigate(`/posts/${post.slug || post.id}`)}
                className="p-5 rounded-xl bg-surface border border-border hover:border-accent-main cursor-pointer transition-all hover:bg-elevated/40 shadow-sm group flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between text-xs mb-2.5 gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {getStatusBadge(post.status)}
                      {post.coeName && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-accent-bg text-accent-main border border-accent-main/20">
                          {post.coeName}
                        </span>
                      )}
                    </div>
                    <span className="text-text-muted text-[11px] shrink-0">{readTime}</span>
                  </div>

                  <h3 className="text-sm font-bold text-foreground group-hover:text-accent-main transition-colors line-clamp-2">
                    {post.title}
                  </h3>

                  <p className="text-xs text-text-secondary mt-2 line-clamp-3 leading-relaxed">
                    {post.excerpt || 'No description provided for this publication.'}
                  </p>
                </div>

                <div className="mt-5 pt-3 border-t border-border flex items-center justify-between text-[11px] text-text-muted">
                  <div className="flex items-center gap-1.5 truncate mr-2">
                    <div className="w-5 h-5 rounded-full bg-accent-bg text-accent-main font-bold flex items-center justify-center text-[10px] shrink-0">
                      {(post.authorName || 'A')[0].toUpperCase()}
                    </div>
                    <span className="truncate">{post.authorName || 'Staff Author'}</span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-text-secondary" />
                      <span>{dateDisplay}</span>
                    </span>
                    {isAuthorOrAdmin && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/posts/${post.id}/edit`);
                        }}
                        className="p-1 rounded bg-canvas border border-border hover:border-accent-main text-accent-main transition-colors"
                        title="Edit in Studio"
                        aria-label="Edit post"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && pagination?.hasNextPage && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={loadMore}
            disabled={isLoadingMore}
            className="px-4 py-2 rounded-lg bg-surface border border-border text-xs font-semibold text-foreground hover:bg-elevated disabled:opacity-60 transition-colors"
          >
            {isLoadingMore ? 'Loading…' : `Load more${pagination.total ? ` (${posts.length} of ${pagination.total})` : ''}`}
          </button>
        </div>
      )}
    </div>
  );
};
