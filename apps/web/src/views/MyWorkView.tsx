import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlusCircle } from 'lucide-react';

export const MyWorkView: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'drafts' | 'in_review' | 'published' | 'suggestions'>('drafts');

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Work Dashboard</h1>
          <p className="text-xs text-text-secondary mt-1">
            Track your ongoing drafts, editorial review submissions, and suggestions awaiting your review.
          </p>
        </div>
        <button
          onClick={() => navigate('/posts/new')}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:opacity-90 text-primary-foreground font-semibold text-xs shadow-sm self-start sm:self-auto transition-all"
        >
          <PlusCircle className="w-4 h-4" />
          <span>New Article</span>
        </button>
      </div>

      {/* Segmented Tabs */}
      <div className="flex border-b border-border gap-2">
        {[
          { id: 'drafts', label: 'Drafts (2)' },
          { id: 'in_review', label: 'In Review (1)' },
          { id: 'published', label: 'Published (3)' },
          { id: 'suggestions', label: 'Suggestions Waiting (2)' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`pb-3 px-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-accent-main text-accent-main'
                : 'border-transparent text-text-muted hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content Table */}
      <div className="rounded-xl bg-surface border border-border shadow-sm overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-canvas border-b border-border text-text-muted font-semibold uppercase text-[10px]">
            <tr>
              <th className="px-5 py-3">Title</th>
              <th className="px-5 py-3">Category</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Last Modified</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-text-secondary">
            <tr className="hover:bg-canvas/50 transition-colors">
              <td className="px-5 py-4 font-medium text-foreground">
                Enterprise Architecture & In-Process Agent Gateway Spec
              </td>
              <td className="px-5 py-4">Architecture</td>
              <td className="px-5 py-4">
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-status-success/15 text-status-success border border-status-success/30">
                  Published
                </span>
              </td>
              <td className="px-5 py-4 text-text-muted">2 hours ago</td>
              <td className="px-5 py-4 text-right space-x-2">
                <button
                  onClick={() => navigate('/posts/1/edit')}
                  className="px-2.5 py-1 rounded bg-canvas hover:bg-elevated text-foreground text-[11px] font-medium border border-border transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => navigate('/posts/architecture-gateway-spec')}
                  className="px-2.5 py-1 rounded bg-accent-bg text-accent-main hover:opacity-80 text-[11px] font-semibold transition-colors"
                >
                  View
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};
