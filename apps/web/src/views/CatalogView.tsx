import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, LayoutGrid, List, User, Calendar } from 'lucide-react';

export const CatalogView: React.FC = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCoe, setSelectedCoe] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Knowledge Catalog</h1>
          <p className="text-xs text-slate-400 mt-1">
            Search, filter, and discover official enterprise engineering and architecture publications.
          </p>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-slate-800 self-start sm:self-auto">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === 'grid' ? 'bg-slate-800 text-sky-400' : 'text-slate-400 hover:text-slate-200'
            }`}
            aria-label="Grid view"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === 'list' ? 'bg-slate-800 text-sky-400' : 'text-slate-400 hover:text-slate-200'
            }`}
            aria-label="List view"
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 p-4 rounded-xl bg-slate-900 border border-slate-800">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by title, excerpt, tag, or author..."
            className="w-full pl-9 pr-4 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>

        <select
          value={selectedCoe}
          onChange={(e) => setSelectedCoe(e.target.value)}
          className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-sky-500"
        >
          <option value="all">All COEs / Categories</option>
          <option value="architecture">Architecture</option>
          <option value="engineering">Engineering</option>
          <option value="security">Security</option>
          <option value="devops">DevOps & SRE</option>
        </select>
      </div>

      {/* Catalog Cards Grid */}
      <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5' : 'space-y-3'}>
        {[
          {
            id: '1',
            slug: 'architecture-gateway-spec',
            title: 'Enterprise Architecture & In-Process Agent Gateway Spec',
            excerpt: 'Specification for single-authority write path inside apps/collab using Hocuspocus.',
            coe: 'Architecture',
            author: 'Santosh (Lead Author)',
            date: '2026-10-24',
            readTime: '6 min read',
          },
          {
            id: '2',
            slug: 'crdt-convergence-harness',
            title: 'Automated CRDT Convergence & Myers Diff Suggestion Engine',
            excerpt: 'Verifying zero keystroke loss across concurrent headless human and AI editing clients.',
            coe: 'Engineering',
            author: 'Collab Team',
            date: '2026-10-23',
            readTime: '9 min read',
          },
          {
            id: '3',
            slug: 'production-deployment-guide',
            title: 'Turnkey Self-Contained Docker Production Deployment',
            excerpt: 'Zero host-dependency server launch with automated Postgres migration and Nginx reverse proxy.',
            coe: 'DevOps & SRE',
            author: 'DevOps Guild',
            date: '2026-10-22',
            readTime: '4 min read',
          },
        ].map((item) => (
          <div
            key={item.id}
            onClick={() => navigate(`/posts/${item.slug}`)}
            className="p-5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 cursor-pointer transition-all hover:bg-slate-900/80 group"
          >
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
                {item.coe}
              </span>
              <span className="text-slate-500">{item.readTime}</span>
            </div>
            <h3 className="text-sm font-bold text-slate-100 group-hover:text-sky-300 transition-colors">
              {item.title}
            </h3>
            <p className="text-xs text-slate-400 mt-2 line-clamp-2 leading-relaxed">
              {item.excerpt}
            </p>
            <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                {item.author}
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                {item.date}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
