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
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-slate-100 p-6">
      <div className="flex items-center gap-3 p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
        <Loader2 className="w-6 h-6 text-sky-400 animate-spin" />
        <div>
          <div className="text-sm font-semibold text-slate-200">Provisioning draft post...</div>
          <div className="text-xs text-slate-500 mt-0.5">Connecting to collaborative room</div>
        </div>
      </div>
    </div>
  );
};
