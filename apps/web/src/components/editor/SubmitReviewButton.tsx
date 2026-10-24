import React, { useState } from 'react';
import { 
  FileCheck, 
  Loader2, 
  Clock, 
  CheckCircle2, 
  AlertCircle 
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // If already in review or published, display descriptive badge
  if (status === 'in_review') {
    return (
      <Badge variant="in_review" className={cn("gap-1.5 py-1 px-3 text-xs font-semibold", className)}>
        <Clock className="w-3.5 h-3.5" />
        <span>In Review</span>
      </Badge>
    );
  }

  if (status === 'published') {
    return (
      <Badge variant="published" className={cn("gap-1.5 py-1 px-3 text-xs font-semibold", className)}>
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span>Published</span>
      </Badge>
    );
  }

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

  return (
    <>
      <Button
        variant="default"
        size="sm"
        onClick={() => {
          setErrorMessage(null);
          setIsDialogOpen(true);
        }}
        className={cn("gap-1.5 text-xs font-semibold shadow-xs", className)}
      >
        <FileCheck className="w-3.5 h-3.5" />
        <span>Submit for Review</span>
      </Button>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-primary" />
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
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="default"
              size="sm"
              onClick={handleConfirmSubmit}
              disabled={isSubmitting}
              className="gap-1.5"
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
    </>
  );
};
