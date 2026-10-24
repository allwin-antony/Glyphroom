import React, { useState, useEffect, useCallback } from 'react';
import { 
  History, 
  Globe, 
  FileCheck, 
  Save, 
  Clock, 
  Loader2, 
  RefreshCw,
  Calendar
} from 'lucide-react';
import { api } from '../../../lib/api.js';

export interface PostVersion {
  id: string;
  postId: string;
  versionNumber: number;
  triggerReason: 'manual_save' | 'review_submission' | 'publication' | 'hourly_checkpoint';
  createdAt: string;
  createdBy: string;
  authorName?: string | null;
}

export interface VersionsTabProps {
  postId: string;
}

export const VersionsTab: React.FC<VersionsTabProps> = ({ postId }) => {
  const [versions, setVersions] = useState<PostVersion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchVersions = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await api.get<{ versions: PostVersion[] }>(`/posts/${postId}/versions`);
      setVersions(res.versions || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load version history.');
    } finally {
      setIsLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  const getReasonConfig = (reason: string) => {
    switch (reason) {
      case 'publication':
        return {
          label: 'Published Snapshot',
          icon: <Globe className="w-3.5 h-3.5 text-status-success shrink-0" />,
          classes: 'bg-status-success/10 text-status-success border-status-success/30',
        };
      case 'review_submission':
        return {
          label: 'Review Submission',
          icon: <FileCheck className="w-3.5 h-3.5 text-status-info shrink-0" />,
          classes: 'bg-status-info/10 text-status-info border-status-info/30',
        };
      case 'hourly_checkpoint':
        return {
          label: 'Auto Snapshot',
          icon: <Clock className="w-3.5 h-3.5 text-agent shrink-0" />,
          classes: 'bg-agent/10 text-agent border-agent/30',
        };
      case 'manual_save':
      default:
        return {
          label: 'Manual Checkpoint',
          icon: <Save className="w-3.5 h-3.5 text-text-muted shrink-0" />,
          classes: 'bg-elevated text-text-secondary border-border',
        };
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between bg-surface-muted/30">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
          <History className="w-4 h-4 text-amber-500" />
          <span>Milestone Versions</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-elevated border border-border text-text-muted">
            {versions.length}
          </span>
        </div>

        <button
          onClick={fetchVersions}
          disabled={isLoading}
          className="p-1 rounded text-text-muted hover:text-foreground hover:bg-elevated transition-colors"
          title="Refresh Versions"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Timeline Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted text-xs">
            <Loader2 className="w-5 h-5 animate-spin mb-2" />
            <span>Loading milestone timeline...</span>
          </div>
        ) : error ? (
          <div className="p-3 rounded-lg bg-status-danger/10 border border-status-danger/30 text-status-danger text-xs">
            {error}
          </div>
        ) : versions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-text-muted px-4">
            <div className="w-10 h-10 rounded-full bg-elevated border border-border flex items-center justify-center mb-3 text-amber-500">
              <History className="w-5 h-5" />
            </div>
            <div className="text-xs font-semibold text-text">No milestone snapshots yet</div>
            <p className="text-[11px] text-text-muted mt-1 max-w-[220px]">
              Immutable snapshot checkpoints are created automatically when a post is submitted for review or approved and published.
            </p>
          </div>
        ) : (
          <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
            {versions.map((ver, idx) => {
              const config = getReasonConfig(ver.triggerReason);
              const isLatest = idx === 0;

              return (
                <div key={ver.id} className="relative group">
                  {/* Timeline Node Marker */}
                  <div className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-surface border-2 border-primary ring-4 ring-canvas flex items-center justify-center" />

                  {/* Version Card */}
                  <div className="p-3 rounded-xl border border-border bg-surface hover:border-accent transition-all shadow-xs space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 font-bold text-foreground">
                        <span>v{ver.versionNumber}.0</span>
                        {isLatest && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] bg-primary/10 text-primary font-semibold">
                            Latest
                          </span>
                        )}
                      </div>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${config.classes}`}>
                        {config.icon}
                        <span>{config.label}</span>
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-text-muted pt-1 border-t border-border/40">
                      <span>{ver.authorName || 'Author'}</span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(ver.createdAt).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
