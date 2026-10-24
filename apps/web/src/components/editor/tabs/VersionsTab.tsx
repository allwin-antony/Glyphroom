import React, { useState, useEffect, useCallback } from 'react';
import { 
  History, 
  Globe, 
  FileCheck, 
  Save, 
  Clock, 
  Loader2, 
  RefreshCw,
  Calendar,
  RotateCcw,
  Eye,
  CheckCircle2,
  AlertTriangle,
  X
} from 'lucide-react';
import { api, ApiError } from '../../../lib/api.js';

export interface PostVersion {
  id: string;
  postId: string;
  versionNumber: number;
  triggerReason: 'manual_save' | 'review_submission' | 'publication' | 'hourly_checkpoint';
  createdAt: string;
  createdBy: string;
  authorName?: string | null;
  markdownSnapshot?: string;
}

export interface VersionsTabProps {
  postId: string;
}

export const VersionsTab: React.FC<VersionsTabProps> = ({ postId }) => {
  const [versions, setVersions] = useState<PostVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<PostVersion | null>(null);
  const [snapshotContent, setSnapshotContent] = useState<string | null>(null);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);
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

  // View specific version snapshot
  const handleSelectVersion = async (v: PostVersion) => {
    setSelectedVersion(v);
    setIsLoadingSnapshot(true);
    setRestoreSuccess(null);
    try {
      const res = await api.get<{ version: PostVersion }>(`/posts/${postId}/versions/${v.id}`);
      setSnapshotContent(res.version?.markdownSnapshot || 'No markdown snapshot available.');
    } catch (err: any) {
      setSnapshotContent('Failed to load version snapshot.');
    } finally {
      setIsLoadingSnapshot(false);
    }
  };

  // Restore historical version
  const handleRestoreVersion = async (versionId: string, versionNumber: number) => {
    if (!window.confirm(`Are you sure you want to restore version v${versionNumber}? A safety checkpoint of your current draft will be created automatically.`)) {
      return;
    }

    setIsRestoring(true);
    try {
      await api.post(`/posts/${postId}/versions/${versionId}/restore`);
      setRestoreSuccess(`Restored v${versionNumber}! Reloading draft...`);
      await fetchVersions();
      setTimeout(() => {
        window.location.reload();
      }, 1200);
    } catch (err: any) {
      alert(err?.message || 'Failed to restore version.');
    } finally {
      setIsRestoring(false);
    }
  };

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
          icon: <FileCheck className="w-3.5 h-3.5 text-accent shrink-0" />,
          classes: 'bg-accent/10 text-accent border-accent/30',
        };
      case 'hourly_checkpoint':
        return {
          label: 'Safety Snapshot',
          icon: <Clock className="w-3.5 h-3.5 text-agent shrink-0" />,
          classes: 'bg-agent/10 text-agent border-agent/30',
        };
      case 'manual_save':
      default:
        return {
          label: 'Draft Checkpoint',
          icon: <Save className="w-3.5 h-3.5 text-text-muted shrink-0" />,
          classes: 'bg-elevated text-text-secondary border-border',
        };
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface text-foreground">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between bg-surface-muted/30">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
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

      {restoreSuccess && (
        <div className="m-3 p-2.5 rounded-lg bg-status-success/10 border border-status-success/30 text-status-success text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{restoreSuccess}</span>
        </div>
      )}

      {/* Snapshot Preview Drawer Modal */}
      {selectedVersion && (
        <div className="p-3 border-b border-border bg-canvas text-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-bold text-foreground">
              <Eye className="w-3.5 h-3.5 text-accent" />
              <span>Snapshot Preview (v{selectedVersion.versionNumber})</span>
            </div>
            <button
              onClick={() => setSelectedVersion(null)}
              className="p-0.5 rounded hover:bg-elevated text-text-muted hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {isLoadingSnapshot ? (
            <div className="py-4 text-center text-text-muted flex items-center justify-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Loading snapshot...</span>
            </div>
          ) : (
            <>
              <div className="max-h-40 overflow-y-auto p-2 bg-surface rounded-lg border border-border font-mono text-[11px] whitespace-pre-wrap">
                {snapshotContent}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleRestoreVersion(selectedVersion.id, selectedVersion.versionNumber)}
                  disabled={isRestoring}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white font-semibold text-xs shadow-xs hover:opacity-95"
                >
                  <RotateCcw className={`w-3 h-3 ${isRestoring ? 'animate-spin' : ''}`} />
                  <span>Restore v{selectedVersion.versionNumber}</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Version list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 text-xs">
        {isLoading && versions.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-text-muted">
            <Loader2 className="w-5 h-5 animate-spin mb-2 text-accent" />
            <span>Loading version history...</span>
          </div>
        ) : error ? (
          <div className="p-3 rounded-lg bg-status-danger/10 border border-status-danger/30 text-status-danger">
            {error}
          </div>
        ) : versions.length === 0 ? (
          <div className="py-12 text-center text-text-muted">
            <History className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <div className="font-semibold">No version snapshots yet</div>
            <div className="text-[11px] mt-1">
              Snapshots are automatically recorded during manual draft checkpoints, review submissions, and publications.
            </div>
          </div>
        ) : (
          versions.map((v) => {
            const config = getReasonConfig(v.triggerReason);
            const isSelected = selectedVersion?.id === v.id;
            return (
              <div
                key={v.id}
                onClick={() => handleSelectVersion(v)}
                className={`p-3 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'border-accent bg-accent-bg/40 shadow-xs'
                    : 'border-border bg-canvas hover:border-accent/40 hover:bg-elevated'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-foreground">
                    <span className="font-mono text-accent">v{v.versionNumber}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 font-semibold ${config.classes}`}>
                      {config.icon}
                      <span>{config.label}</span>
                    </span>
                  </div>

                  <span className="text-[10px] text-accent font-medium hover:underline flex items-center gap-0.5">
                    <Eye className="w-3 h-3" />
                    <span>View</span>
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] text-text-muted mt-1">
                  <span>Author: {v.authorName || 'System'}</span>
                  <span>{new Date(v.createdAt).toLocaleDateString()} {new Date(v.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
