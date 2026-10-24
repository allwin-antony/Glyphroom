import React, { useState, useRef, useEffect } from 'react';
import { 
  FileCheck, 
  Loader2, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  ChevronDown,
  Save,
  Check,
  UploadCloud
} from 'lucide-react';
import { Button } from '../ui/button.js';
import { Badge } from '../ui/badge.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '../ui/dialog.js';
import { api, ApiError } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';

export interface SubmitReviewButtonProps {
  postId: string;
  status: string; // 'draft' | 'in_review' | 'published' | 'changes_requested'
  onStatusChange?: (newStatus: string) => void;
  className?: string;
}

export const SubmitReviewButton: React.FC<SubmitReviewButtonProps> = ({
  postId,
  status,
  onStatusChange,
  className,
}) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isRepublishOpen, setIsRepublishOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [draftSavedFeedback, setDraftSavedFeedback] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [changeSummary, setChangeSummary] = useState('');

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleConfirmSubmit = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await api.post<{ post: { status: string } }>(
        `/posts/${postId}/submit-review`
      );
      onStatusChange?.(response?.post?.status || 'in_review');
      setIsDialogOpen(false);
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setErrorMessage('You do not have permission to submit this post for review.');
        } else if (err.status === 404) {
          setErrorMessage('Post not found.');
        } else {
          setErrorMessage(err.message || 'Submission failed.');
        }
      } else {
        setErrorMessage('Failed to connect to review service. Please verify your connection.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    setIsDropdownOpen(false);
    setIsSavingDraft(true);
    try {
      await api.patch(`/posts/${postId}`, { status: 'draft' });
      setDraftSavedFeedback(true);
      onStatusChange?.('draft');
      setTimeout(() => setDraftSavedFeedback(false), 2500);
    } catch (err) {
      console.warn('Failed to save draft explicitly:', err);
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleRepublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changeSummary.trim() || changeSummary.trim().length < 3) {
      setErrorMessage('Please provide a meaningful change summary (minimum 3 characters).');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await api.post(`/posts/${postId}/republish`, {
        changeSummary: changeSummary.trim(),
      });
      setIsRepublishOpen(false);
      setChangeSummary('');
      setDraftSavedFeedback(true);
      setTimeout(() => setDraftSavedFeedback(false), 3000);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to republish changes.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // If already in review, display descriptive badge
  if (status === 'in_review') {
    return (
      <Badge variant="in_review" className={cn("gap-1.5 py-1 px-3 text-xs font-semibold", className)}>
        <Clock className="w-3.5 h-3.5" />
        <span>In Review</span>
      </Badge>
    );
  }

  // If published: display Published badge PLUS Republish action
  if (status === 'published') {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Badge variant="published" className="gap-1.5 py-1 px-3 text-xs font-semibold">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Published</span>
        </Badge>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setErrorMessage(null);
            setIsRepublishOpen(true);
          }}
          className="gap-1.5 text-xs font-semibold border-accent text-accent hover:bg-accent hover:text-white transition-colors"
        >
          <UploadCloud className="w-3.5 h-3.5" />
          <span>Republish Changes</span>
        </Button>

        {draftSavedFeedback && (
          <span className="text-[11px] text-status-success font-semibold flex items-center gap-1 animate-in fade-in-50">
            <Check className="w-3 h-3" />
            <span>Republished ✓</span>
          </span>
        )}

        {/* Republish Modal */}
        <Dialog open={isRepublishOpen} onOpenChange={setIsRepublishOpen}>
          <DialogContent className="sm:max-w-md">
            <form onSubmit={handleRepublish}>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <UploadCloud className="w-5 h-5 text-accent" />
                  <span>Republish Post with Changes</span>
                </DialogTitle>
                <DialogDescription className="pt-2 text-xs text-text-secondary leading-relaxed">
                  Readers currently view the previous published version. To deploy your working revisions, enter a brief change summary for the audit trail.
                </DialogDescription>
              </DialogHeader>

              {errorMessage && (
                <div className="my-3 p-3 rounded-lg bg-status-danger/10 border border-status-danger/30 text-status-danger text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <div className="my-3 space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Change Summary / Changelog <span className="text-status-danger">*</span>
                </label>
                <textarea
                  value={changeSummary}
                  onChange={(e) => setChangeSummary(e.target.value)}
                  placeholder="e.g. Updated architecture diagram and clarified Phase 2 requirements..."
                  rows={3}
                  required
                  className="w-full text-xs px-3 py-2 rounded-lg bg-canvas border border-border text-foreground focus:outline-none focus:border-accent resize-none"
                />
              </div>

              <DialogFooter className="gap-2 sm:gap-0 pt-2">
                <DialogClose asChild>
                  <Button variant="outline" size="sm" disabled={isSubmitting}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  type="submit"
                  variant="default"
                  size="sm"
                  disabled={isSubmitting || !changeSummary.trim()}
                  className="gap-1.5 bg-accent text-white hover:opacity-95"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Deploying...</span>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="w-3.5 h-3.5" />
                      <span>Deploy Revisions</span>
                    </>
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className={cn("relative inline-flex items-center", className)} ref={dropdownRef}>
      {/* Split Button Group */}
      <div className="inline-flex rounded-lg shadow-xs overflow-hidden border border-accent divide-x divide-white/20">
        <Button
          variant="default"
          size="sm"
          onClick={() => {
            setErrorMessage(null);
            setIsDialogOpen(true);
          }}
          className="rounded-none gap-1.5 text-xs font-semibold bg-accent text-white hover:opacity-95 px-3 py-1.5"
        >
          <FileCheck className="w-3.5 h-3.5" />
          <span>Submit for Review</span>
        </Button>

        {/* Dropdown trigger arrow */}
        <button
          type="button"
          onClick={() => setIsDropdownOpen((prev) => !prev)}
          className="px-2 bg-accent text-white hover:bg-accent-dark transition-colors flex items-center justify-center focus:outline-none"
          title="Publishing options & Draft actions"
          aria-label="Publishing options & Draft actions"
        >
          {isSavingDraft ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : draftSavedFeedback ? (
            <Check className="w-3.5 h-3.5 text-status-success animate-in zoom-in-75" />
          ) : (
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
          )}
        </button>
      </div>

      {/* Draft Saved Transient Pill */}
      {draftSavedFeedback && (
        <span className="absolute -bottom-6 left-0 right-0 text-center text-[10px] text-status-success font-semibold flex items-center justify-center gap-1">
          <Check className="w-3 h-3" />
          <span>Draft Saved</span>
        </span>
      )}

      {/* Dropdown Menu */}
      {isDropdownOpen && (
        <div className="absolute right-0 top-full mt-1.5 w-48 rounded-xl bg-elevated border border-border shadow-xl z-50 p-1 animate-in fade-in-50 zoom-in-95 text-foreground">
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={isSavingDraft}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg hover:bg-canvas text-left transition-colors cursor-pointer"
          >
            <Save className="w-3.5 h-3.5 text-accent" />
            <div>
              <div className="font-semibold text-foreground">Save as Draft</div>
              <div className="text-[10px] text-text-muted">Explicitly save current changes</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsDropdownOpen(false);
              setErrorMessage(null);
              setIsDialogOpen(true);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg hover:bg-canvas text-left transition-colors border-t border-border mt-1 pt-2 cursor-pointer"
          >
            <FileCheck className="w-3.5 h-3.5 text-accent" />
            <div>
              <div className="font-semibold text-foreground">Submit for Review</div>
              <div className="text-[10px] text-text-muted">Send to editorial queue</div>
            </div>
          </button>
        </div>
      )}

      {/* Confirmation Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-accent" />
              <span>Submit Post for Review</span>
            </DialogTitle>
            <DialogDescription className="pt-2 text-xs text-text-secondary leading-relaxed">
              Submitting this post locks standard author editing and places it into the 
              <strong> Moderator Review Queue</strong>. Editorial reviewers and administrators 
              will review your content, inspect suggestion diffs, and approve it for organization-wide publication.
            </DialogDescription>
          </DialogHeader>

          {errorMessage && (
            <div className="p-3 rounded-lg bg-status-danger/10 border border-status-danger/30 text-status-danger text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <DialogClose asChild>
              <Button variant="outline" size="sm" disabled={isSubmitting}>
                Keep in Draft
              </Button>
            </DialogClose>
            <Button
              variant="default"
              size="sm"
              onClick={handleConfirmSubmit}
              disabled={isSubmitting}
              className="gap-1.5 bg-accent text-white hover:opacity-95"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <FileCheck className="w-3.5 h-3.5" />
                  <span>Confirm & Submit</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
