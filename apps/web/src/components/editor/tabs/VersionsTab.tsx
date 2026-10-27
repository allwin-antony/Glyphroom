import React, { useState, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { 
  History, 
  Globe, 
  FileCheck, 
  Save, 
  Clock, 
  Loader2, 
  RefreshCw, 
  RotateCcw, 
  Eye, 
  CheckCircle2, 
  AlertTriangle, 
  X 
} from 'lucide-react';
import { api, ApiError } from '../../../lib/api.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../ui/dialog.js';

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
  ydoc?: Y.Doc;
  editor?: any;
}

export const VersionsTab: React.FC<VersionsTabProps> = ({ postId, ydoc, editor }) => {
  const [versions, setVersions] = useState<PostVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<PostVersion | null>(null);
  const [snapshotContent, setSnapshotContent] = useState<string | null>(null);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmVersion, setConfirmVersion] = useState<PostVersion | null>(null);

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

  // Restore historical version handler
  const handleExecuteRestore = async () => {
    if (!confirmVersion) return;
    const v = confirmVersion;
    setIsRestoring(true);
    setError(null);
    try {
      const res = await api.post<{
        success: boolean;
        yjsState?: any;
        restoredVersionNumber: number;
        message?: string;
      }>(`/posts/${postId}/versions/${v.id}/restore`);

      if (ydoc && res?.yjsState) {
        try {
          let binary: Uint8Array | null = null;
          if (res.yjsState.data && Array.isArray(res.yjsState.data)) {
            binary = new Uint8Array(res.yjsState.data);
          } else if (typeof res.yjsState === 'string') {
            binary = new Uint8Array(res.yjsState.match(/.{1,2}/g)?.map((b: string) => parseInt(b, 16)) || []);
          } else if (res.yjsState instanceof Uint8Array) {
            binary = res.yjsState;
          }
          if (binary && binary.length > 0) {
            Y.applyUpdate(ydoc, binary);
          }
        } catch (yErr) {
          console.warn('Failed to apply restored Yjs update:', yErr);
        }
      }

      setRestoreSuccess(`Restored v${v.versionNumber} successfully! Draft updated.`);
      setConfirmVersion(null);
      await fetchVersions();
    } catch (err: any) {
      setError(err?.message || 'Failed to restore version.');
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

      {error && (
        <div className="m-3 p-2.5 rounded-lg bg-status-danger/10 border border-status-danger/30 text-status-danger text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
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
              <div className="max-h-56 overflow-y-auto p-3 bg-surface rounded-lg border border-border text-xs text-foreground space-y-2">
                {snapshotContent ? (
                  snapshotContent.split('\n').map((line, idx) => {
                    if (line.startsWith('# ')) {
                      return <h1 key={idx} className="text-base font-bold text-foreground border-b border-border pb-1">{line.slice(2)}</h1>;
                    }
                    if (line.startsWith('## ')) {
                      return <h2 key={idx} className="text-sm font-bold text-foreground mt-2">{line.slice(3)}</h2>;
                    }
                    if (line.startsWith('### ')) {
                      return <h3 key={idx} className="text-xs font-bold text-foreground mt-1.5">{line.slice(4)}</h3>;
                    }
                    if (line.startsWith('- ') || line.startsWith('* ')) {
                      return <li key={idx} className="ml-4 list-disc text-text-secondary">{line.slice(2)}</li>;
                    }
                    if (!line.trim()) {
                      return <div key={idx} className="h-1" />;
                    }
                    return <p key={idx} className="text-text-secondary leading-relaxed">{line}</p>;
                  })
                ) : (
                  <span className="text-text-muted italic">No content recorded.</span>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setConfirmVersion(selectedVersion)}
                  disabled={isRestoring}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white font-semibold text-xs shadow-xs hover:opacity-95"
                >
                  <RotateCcw className="w-3 h-3" />
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

      {/* Confirmation Dialog for Restore (Bug #1 & #16) */}
      <Dialog open={Boolean(confirmVersion)} onOpenChange={(open) => !open && setConfirmVersion(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <RotateCcw className="w-4 h-4 text-accent" />
              <span>Restore Version v{confirmVersion?.versionNumber}</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-text-secondary mt-1">
              Are you sure you want to restore <strong className="text-foreground">Version v{confirmVersion?.versionNumber}</strong>?
              A safety snapshot of your current draft will be automatically recorded before applying the restore.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="flex items-center justify-end gap-2 pt-3">
            <button
              type="button"
              onClick={() => setConfirmVersion(null)}
              disabled={isRestoring}
              className="px-3 py-1.5 rounded-lg border border-border bg-canvas text-xs font-semibold text-foreground hover:bg-elevated transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleExecuteRestore}
              disabled={isRestoring}
              className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:opacity-90 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {isRestoring ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Restoring...</span>
                </>
              ) : (
                <>
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Confirm Restore</span>
                </>
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
