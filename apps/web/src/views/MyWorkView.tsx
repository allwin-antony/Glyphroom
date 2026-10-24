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
          <h1 className="text-2xl font-bold text-slate-100">My Work Dashboard</h1>
          <p className="text-xs text-slate-400 mt-1">
            Track your ongoing drafts, editorial review submissions, and suggestions awaiting your review.
          </p>
        </div>
        <button
          onClick={() => navigate('/posts/new')}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs shadow-sm self-start sm:self-auto"
        >
          <PlusCircle className="w-4 h-4" />
          <span>New Article</span>
        </button>
      </div>

      {/* Segmented Tabs */}
      <div className="flex border-b border-slate-800 gap-2">
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
                ? 'border-sky-400 text-sky-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content Table */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-semibold uppercase text-[10px]">
            <tr>
              <th className="px-5 py-3">Title</th>
              <th className="px-5 py-3">Category</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Last Modified</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-slate-300">
            <tr>
              <td className="px-5 py-4 font-medium text-slate-100">
                Enterprise Architecture & In-Process Agent Gateway Spec
              </td>
              <td className="px-5 py-4">Architecture</td>
              <td className="px-5 py-4">
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Published
                </span>
              </td>
              <td className="px-5 py-4 text-slate-500">2 hours ago</td>
              <td className="px-5 py-4 text-right space-x-2">
                <button
                  onClick={() => navigate('/posts/1/edit')}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px]"
                >
                  Edit
                </button>
                <button
                  onClick={() => navigate('/posts/architecture-gateway-spec')}
                  className="px-2.5 py-1 rounded bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 text-[11px]"
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
