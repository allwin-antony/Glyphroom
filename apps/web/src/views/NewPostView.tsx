import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';

export const NewPostView: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const provisioningRef = useRef(false);

  const provisionPost = async () => {
    setError(null);
    setIsRetrying(true);
    try {
      if (user?.role === 'reader') {
        throw new Error('Reader role does not have permission to create draft posts.');
      }

      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 7);
      const slug = `draft-${timestamp}-${randomSuffix}`;

      const res = await api.post<{ post: { id: string } }>('/posts', {
        title: 'Untitled Draft',
        slug,
      });

      if (res?.post?.id) {
        navigate(`/posts/${res.post.id}/edit`, { replace: true });
      } else {
        throw new Error('Server returned invalid post data.');
      }
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You do not have permission to create draft posts. Author, moderator, or admin role is required.');
      } else {
        setError(err?.message || 'Failed to provision draft post. Please try again.');
      }
    } finally {
      setIsRetrying(false);
    }
  };

  useEffect(() => {
    if (provisioningRef.current) return;
    provisioningRef.current = true;
    provisionPost();
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-foreground p-6">
        <div className="w-full max-w-md p-6 rounded-2xl bg-surface border border-status-danger/30 shadow-md">
          <div className="flex items-center gap-3 text-status-danger mb-3">
            <AlertCircle className="w-6 h-6 shrink-0" />
            <h3 className="text-base font-bold">Draft Provisioning Failed</h3>
          </div>
          <p className="text-sm text-text-secondary mb-6">{error}</p>
          <div className="flex items-center gap-3">
            <button
              onClick={provisionPost}
              disabled={isRetrying}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-xs hover:opacity-90 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
              <span>Retry</span>
            </button>
            <button
              onClick={() => navigate('/my-work')}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-canvas border border-border text-foreground font-semibold text-xs hover:bg-elevated transition-all"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to My Work</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-foreground p-6">
      <div className="flex items-center gap-4 p-6 rounded-2xl bg-surface border border-border shadow-sm">
        <Loader2 className="w-6 h-6 text-accent-main animate-spin" />
        <div>
          <div className="text-sm font-semibold text-foreground">Provisioning draft post...</div>
          <div className="text-xs text-text-muted mt-0.5">Initializing collaborative room & workspace</div>
        </div>
      </div>
    </div>
  );
};
