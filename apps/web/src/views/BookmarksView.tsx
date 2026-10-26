import React, { useEffect, useState } from 'react';
import { Bookmark, ExternalLink, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

interface BookmarkItem {
  postId: string;
  bookmarkedAt: string;
  note?: string | null;
  post: { slug: string; title: string; excerpt?: string | null; authorName?: string | null };
}

export const BookmarksView: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<BookmarkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = () => {
    setIsLoading(true);
    api.get<{ bookmarks: BookmarkItem[] }>('/bookmarks')
      .then((res) => setItems(res.bookmarks || []))
      .catch(() => setItems([]))
      .finally(() => setIsLoading(false));
  };

  useEffect(load, []);

  const remove = async (postId: string) => {
    await api.delete(`/bookmarks/${postId}`);
    setItems((current) => current.filter((item) => item.postId !== postId));
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Bookmark className="w-6 h-6 text-accent-main" /> Saved Reading
        </h1>
        <p className="text-xs text-text-secondary mt-1">Articles you saved for later.</p>
      </div>

      {isLoading ? (
        <div className="p-10 text-center text-xs text-text-muted animate-pulse">Loading saved articles...</div>
      ) : items.length === 0 ? (
        <div className="p-12 text-center rounded-xl bg-surface border border-border border-dashed space-y-3">
          <Bookmark className="w-8 h-8 mx-auto text-text-muted" />
          <p className="text-sm font-semibold text-foreground">No saved articles yet</p>
          <p className="text-xs text-text-secondary">Use Save while reading an article to keep it here.</p>
          <button onClick={() => navigate('/catalog')} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold">Browse Catalog</button>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <article key={item.postId} className="p-5 rounded-xl bg-surface border border-border flex items-start justify-between gap-4">
              <button onClick={() => navigate(`/posts/${item.post.slug}`)} className="text-left min-w-0 flex-1 group">
                <h2 className="text-sm font-bold text-foreground group-hover:text-accent-main">{item.post.title}</h2>
                <p className="text-xs text-text-secondary mt-1 line-clamp-2">{item.post.excerpt || 'No description provided.'}</p>
                <p className="text-[11px] text-text-muted mt-2">By {item.post.authorName || 'Staff Author'} · Saved {new Date(item.bookmarkedAt).toLocaleDateString()}</p>
                {item.note && <p className="text-xs text-text-secondary mt-2 italic">{item.note}</p>}
              </button>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => navigate(`/posts/${item.post.slug}`)} className="p-2 rounded-lg text-accent-main hover:bg-accent-bg" title="Read article" aria-label="Read article"><ExternalLink className="w-4 h-4" /></button>
                <button onClick={() => remove(item.postId)} className="p-2 rounded-lg text-status-danger hover:bg-status-danger/10" title="Remove bookmark" aria-label="Remove bookmark"><Trash2 className="w-4 h-4" /></button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};
