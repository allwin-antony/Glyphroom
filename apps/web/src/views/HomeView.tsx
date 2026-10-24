import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../lib/api.js';
import {
  BookOpen,
  Sparkles,
  Clock,
  TrendingUp,
  ArrowRight,
  Plus,
  FileText,
  User,
} from 'lucide-react';
import type { CatalogPost } from './CatalogView.js';

export const HomeView: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [posts, setPosts] = useState<CatalogPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCurrent = true;
    api
      .get<{ posts: CatalogPost[] }>('/posts')
      .then((res) => {
        if (isCurrent && res.posts) {
          setPosts(res.posts);
        }
      })
      .catch((err) => {
        console.warn('Could not load home posts:', err);
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const publishedPosts = posts.filter((p) => p.status === 'published');
  const inReviewPosts = posts.filter((p) => p.status === 'in_review');
  const draftPosts = posts.filter((p) => p.status === 'draft');

  const featuredPosts = publishedPosts.length > 0 ? publishedPosts.slice(0, 3) : posts.slice(0, 3);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8">
      {/* Welcome Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-accent-bg via-surface to-accent-bg/40 border border-border p-8 shadow-sm">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-accent-bg text-accent-main border border-accent-main/20 mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Glyphroom</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            Welcome back, {user?.fullName || 'Friend'}
          </h1>
          <p className="mt-2 text-sm text-text-secondary leading-relaxed">
            A calm, focused space for reading, writing, and collaboration.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {user && user.role !== 'reader' && (
              <button
                onClick={() => navigate('/posts/new')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary hover:opacity-90 text-primary-foreground font-semibold text-xs shadow-sm transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>Write Story</span>
              </button>
            )}
            <button
              onClick={() => navigate('/catalog')}
              className="px-4 py-2 rounded-lg bg-surface hover:bg-elevated text-foreground font-medium text-xs border border-border transition-all shadow-sm"
            >
              Browse Articles
            </button>
          </div>
        </div>
      </div>

      {/* Metrics Row - 3 Clean Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          {
            label: 'Published Stories',
            value: `${publishedPosts.length || 0} Stories`,
            icon: BookOpen,
            color: 'text-accent-main',
          },
          {
            label: 'In Review',
            value: `${inReviewPosts.length || 0} Pending`,
            icon: Clock,
            color: 'text-status-warning',
          },
          {
            label: 'Your Drafts',
            value: `${draftPosts.length || 0} Drafts`,
            icon: FileText,
            color: 'text-agent',
          },
        ].map((metric) => {
          const Icon = metric.icon;
          return (
            <div
              key={metric.label}
              className="p-5 rounded-xl bg-surface border border-border shadow-sm flex items-center justify-between"
            >
              <div>
                <div className="text-xs text-text-muted font-medium">{metric.label}</div>
                <div className="text-xl font-bold text-foreground mt-1">{metric.value}</div>
              </div>
              <div className={`p-3 rounded-lg bg-canvas border border-border ${metric.color}`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Grid: Featured Stories & Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Featured Stories */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-accent-main" />
              <span>Recent Stories</span>
            </h2>
            <button
              onClick={() => navigate('/catalog')}
              className="text-xs text-accent-main hover:underline flex items-center gap-1 font-semibold"
            >
              <span>View all</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-3">
            {isLoading ? (
              [1, 2].map((n) => (
                <div key={n} className="p-5 rounded-xl bg-surface border border-border animate-pulse space-y-3">
                  <div className="h-4 w-24 bg-border rounded" />
                  <div className="h-5 w-2/3 bg-border rounded" />
                  <div className="h-4 w-full bg-border rounded" />
                </div>
              ))
            ) : featuredPosts.length === 0 ? (
              <div className="p-8 rounded-xl bg-surface border border-border text-center space-y-2">
                <p className="text-xs text-text-secondary">No stories published yet.</p>
                {user && user.role !== 'reader' && (
                  <button
                    onClick={() => navigate('/posts/new')}
                    className="text-xs text-accent-main font-semibold hover:underline"
                  >
                    Start your first story →
                  </button>
                )}
              </div>
            ) : (
              featuredPosts.map((post) => (
                <div
                  key={post.id}
                  onClick={() => navigate(`/posts/${post.slug || post.id}`)}
                  className="p-5 rounded-xl bg-surface border border-border hover:border-accent-main cursor-pointer transition-all hover:bg-elevated/40 shadow-sm group"
                >
                  <div className="flex items-center gap-2 mb-2">
                    {post.coeName && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-accent-bg text-accent-main border border-accent-main/20">
                        {post.coeName}
                      </span>
                    )}
                    <span className="text-xs text-text-muted">
                      {new Date(post.publishedAt || post.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-foreground group-hover:text-accent-main transition-colors">
                    {post.title}
                  </h3>
                  <p className="text-xs text-text-secondary mt-1 line-clamp-2 leading-relaxed">
                    {post.excerpt || 'No description provided.'}
                  </p>
                  <div className="mt-3 flex items-center justify-between text-xs text-text-muted pt-3 border-t border-border">
                    <span className="flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-text-secondary" />
                      <span>By {post.authorName || 'Author'}</span>
                    </span>
                    <span className="text-accent-main font-semibold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                      Read <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Quick Workspace Widget */}
        <div className="space-y-4">
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Clock className="w-4 h-4 text-status-warning" />
            <span>Workspace</span>
          </h2>

          <div className="p-5 rounded-xl bg-surface border border-border shadow-sm space-y-4">
            <div className="p-3.5 rounded-lg bg-canvas border border-border">
              <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-accent-main" />
                <span>Your Drafts & Ideas</span>
              </div>
              <div className="text-[11px] text-text-secondary mt-1 leading-relaxed">
                Pick up right where you left off, review suggestions, or start drafting your next story.
              </div>
              <button
                onClick={() => navigate('/my-work')}
                className="mt-2 text-[11px] text-accent-main hover:underline font-semibold block"
              >
                Go to My Work →
              </button>
            </div>

            {['moderator', 'admin'].includes(user?.role || '') && (
              <div className="p-3.5 rounded-lg bg-canvas border border-border">
                <div className="text-xs font-semibold text-status-warning flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Review Queue ({inReviewPosts.length})</span>
                </div>
                <div className="text-[11px] text-text-secondary mt-1">
                  {inReviewPosts.length > 0
                    ? `${inReviewPosts.length} story submission(s) waiting for editorial review.`
                    : 'All submitted stories have been reviewed.'}
                </div>
                <button
                  onClick={() => navigate('/reviews')}
                  className="mt-2 text-[11px] text-status-warning hover:underline font-semibold block"
                >
                  Open Review Queue →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
