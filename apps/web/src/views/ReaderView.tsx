import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, Calendar, Download } from 'lucide-react';

export const ReaderView: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  return (
    <div className="max-w-4xl mx-auto p-6 sm:p-10 space-y-8">
      {/* Back button & Action pills */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        <button
          onClick={() => alert('Exporting derived markdown with pending insertions stripped...')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-medium transition-colors"
        >
          <Download className="w-3.5 h-3.5 text-sky-400" />
          <span>Export Markdown</span>
        </button>
      </div>

      {/* Article Capsule Header */}
      <div className="space-y-4 border-b border-slate-800 pb-8">
        <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20">
          Architecture
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-100 tracking-tight leading-tight">
          Enterprise Architecture & In-Process Agent Gateway Spec
        </h1>
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <span>By <strong>Santosh (Lead Author)</strong></span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" /> Oct 24, 2026
          </span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> 7 min read
          </span>
          {slug && (
            <>
              <span>•</span>
              <span className="font-mono text-slate-500">/{slug}</span>
            </>
          )}
        </div>
      </div>

      {/* Reader Prose Content */}
      <article className="prose prose-invert prose-slate max-w-none text-slate-300 space-y-6 leading-relaxed">
        <p className="text-base text-slate-300">
          This document describes the unified single-authority write path inside <code>apps/collab</code>,
          enabling synchronized concurrent editing between human browsers and autonomous AI agents.
        </p>
        <h2 className="text-xl font-bold text-slate-100 border-b border-slate-800 pb-2">
          1. System Invariants & Single Authority
        </h2>
        <p>
          The Hocuspocus collaboration server runs on port <code>4000</code> and maintains an in-memory Yjs document
          tree. Edits made by AI agents are routed directly in-process through <code>hocuspocus.openDirectConnection()</code>.
        </p>
      </article>
    </div>
  );
};
