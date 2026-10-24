import React from 'react';

export const ReviewQueueView: React.FC = () => {
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Moderator Review Queue</h1>
        <p className="text-xs text-text-secondary mt-1">
          Review pending submissions, inspect side-by-side milestone diffs, and approve or request changes.
        </p>
      </div>

      <div className="rounded-xl bg-surface border border-border shadow-sm overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-canvas border-b border-border text-text-muted font-semibold uppercase text-[10px]">
            <tr>
              <th className="px-5 py-3">Title</th>
              <th className="px-5 py-3">Author</th>
              <th className="px-5 py-3">Submitted</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-text-secondary">
            <tr className="hover:bg-canvas/50 transition-colors">
              <td className="px-5 py-4 font-semibold text-foreground">
                Turnkey Docker Production Deployment Architecture
              </td>
              <td className="px-5 py-4">DevOps Guild</td>
              <td className="px-5 py-4 text-text-muted">1 hour ago</td>
              <td className="px-5 py-4">
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-status-warning/15 text-status-warning border border-status-warning/30">
                  Pending Review
                </span>
              </td>
              <td className="px-5 py-4 text-right space-x-2">
                <button
                  onClick={() => alert('Opening side-by-side milestone diff review workspace...')}
                  className="px-3 py-1 rounded bg-primary text-primary-foreground font-semibold text-xs shadow-sm hover:opacity-90 transition-all"
                >
                  Review Diff
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};
