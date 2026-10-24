import React from 'react';

export const ReviewQueueView: React.FC = () => {
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Moderator Review Queue</h1>
        <p className="text-xs text-slate-400 mt-1">
          Review pending submissions, inspect side-by-side milestone diffs, and approve or request changes.
        </p>
      </div>

      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px]">
            <tr>
              <th className="px-5 py-3">Title</th>
              <th className="px-5 py-3">Author</th>
              <th className="px-5 py-3">Submitted</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-slate-300">
            <tr>
              <td className="px-5 py-4 font-semibold text-slate-100">
                Turnkey Docker Production Deployment Architecture
              </td>
              <td className="px-5 py-4">DevOps Guild</td>
              <td className="px-5 py-4 text-slate-500">1 hour ago</td>
              <td className="px-5 py-4">
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  Pending Review
                </span>
              </td>
              <td className="px-5 py-4 text-right space-x-2">
                <button
                  onClick={() => alert('Opening side-by-side milestone diff review workspace...')}
                  className="px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs"
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
