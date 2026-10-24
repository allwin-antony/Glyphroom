import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

export const NewPostView: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Provision draft post via REST API POST /api/v1/posts or forward to editor
    const timeout = setTimeout(() => {
      // Temporary simulated ID until Milestone M2 REST integration completes
      const draftId = 'draft-' + Date.now();
      navigate(`/posts/${draftId}/edit`, { replace: true });
    }, 600);

    return () => clearTimeout(timeout);
  }, [navigate]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-foreground p-6">
      <div className="flex items-center gap-3 p-6 rounded-2xl bg-surface border border-border shadow-sm">
        <Loader2 className="w-6 h-6 text-accent-main animate-spin" />
        <div>
          <div className="text-sm font-semibold text-foreground">Provisioning draft post...</div>
          <div className="text-xs text-text-muted mt-0.5">Connecting to collaborative room</div>
        </div>
      </div>
    </div>
  );
};
