import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, Calendar, Download, SlidersHorizontal, Type, AlignLeft } from 'lucide-react';

export const ReaderView: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  // Reader Comfort Preferences
  const [fontFamily, setFontFamily] = useState<'sans' | 'serif'>('sans');
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg'>('base');
  const [isSepia, setIsSepia] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);

  const fontSizeClass = {
    sm: 'text-sm leading-relaxed',
    base: 'text-base leading-relaxed',
    lg: 'text-lg leading-relaxed',
  }[fontSize];

  return (
    <div className={`min-h-full py-8 px-4 sm:px-8 transition-colors ${isSepia ? 'bg-[#F1E9D8] text-[#3B3228]' : 'bg-canvas text-foreground'}`}>
      <div className="max-w-[720px] mx-auto space-y-6">
        {/* Navigation & Controls Bar */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 text-xs font-medium text-text-secondary hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPreferences((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors shadow-sm ${
                showPreferences
                  ? 'bg-accent-bg text-accent-main border-accent-main/30'
                  : 'bg-surface border-border text-text-secondary hover:text-foreground'
              }`}
              title="Reading Preferences"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Reader View</span>
            </button>

            <button
              onClick={() => alert('Exporting derived markdown with pending insertions stripped...')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface hover:bg-elevated text-text-main border border-border text-xs font-semibold transition-colors shadow-sm"
            >
              <Download className="w-3.5 h-3.5 text-accent-main" />
              <span>Export Markdown</span>
            </button>
          </div>
        </div>

        {/* Reader Preference Drawer / Bar */}
        {showPreferences && (
          <div className="p-4 rounded-xl bg-surface border border-border shadow-sm flex flex-wrap items-center justify-between gap-4 text-xs animate-in fade-in slide-in-from-top-1 duration-150">
            {/* Font Family */}
            <div className="flex items-center gap-2">
              <span className="text-text-muted flex items-center gap-1 font-medium">
                <Type className="w-3.5 h-3.5" /> Typeface:
              </span>
              <button
                onClick={() => setFontFamily('sans')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  fontFamily === 'sans'
                    ? 'bg-accent-bg text-accent-main font-semibold'
                    : 'text-text-secondary hover:text-foreground'
                }`}
              >
                Sans
              </button>
              <button
                onClick={() => setFontFamily('serif')}
                className={`px-2.5 py-1 rounded-md text-xs font-serif transition-colors ${
                  fontFamily === 'serif'
                    ? 'bg-accent-bg text-accent-main font-semibold'
                    : 'text-text-secondary hover:text-foreground'
                }`}
              >
                Serif
              </button>
            </div>

            {/* Font Size */}
            <div className="flex items-center gap-2">
              <span className="text-text-muted font-medium">Size:</span>
              {(['sm', 'base', 'lg'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFontSize(s)}
                  className={`px-2 py-0.5 rounded text-xs uppercase font-medium transition-colors ${
                    fontSize === s
                      ? 'bg-accent-bg text-accent-main font-semibold'
                      : 'text-text-secondary hover:text-foreground'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Sepia Mode Toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsSepia((prev) => !prev)}
                className={`px-3 py-1 rounded-lg border text-xs font-medium transition-colors ${
                  isSepia
                    ? 'bg-[#E5DAC0] text-[#3B3228] border-[#CFC0A4] font-semibold'
                    : 'bg-canvas text-text-secondary border-border hover:text-foreground'
                }`}
              >
                {isSepia ? 'Sepia Active' : 'Sepia Paper'}
              </button>
            </div>
          </div>
        )}

        {/* Reader Paper Article Canvas */}
        <div
          className={`rounded-2xl border p-8 sm:p-12 shadow-sm space-y-8 transition-colors ${
            isSepia
              ? 'bg-[#F7F0E0] border-[#E4D8BE] text-[#3B3228]'
              : 'bg-surface border-border text-foreground'
          } ${fontFamily === 'serif' ? 'font-serif' : 'font-sans'}`}
        >
          {/* Article Capsule Header */}
          <div className="space-y-4 border-b border-border pb-8">
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-accent-bg text-accent-main border border-accent-main/20">
              Architecture
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">
              Enterprise Architecture & In-Process Agent Gateway Spec
            </h1>
            <div className="flex flex-wrap items-center gap-4 text-xs text-text-secondary">
              <span>By <strong className="text-foreground">Santosh (Lead Author)</strong></span>
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
                  <span className="font-mono text-text-muted">/{slug}</span>
                </>
              )}
            </div>
          </div>

          {/* Reader Prose Content */}
          <article className={`space-y-6 ${fontSizeClass}`}>
            <p>
              This document describes the unified single-authority write path inside <code>apps/collab</code>,
              enabling synchronized concurrent editing between human browsers and autonomous AI agents.
            </p>

            <div className="enterprise-alert enterprise-alert-note">
              <strong>Architectural Note:</strong> The collaboration gateway routes human and agent transactions through a unified Yjs CRDT model, ensuring zero document split-brain.
            </div>

            <h2 className="text-xl font-bold border-b border-border pb-2 pt-4">
              1. System Invariants & Single Authority
            </h2>
            <p>
              The Hocuspocus collaboration server runs on port <code>4000</code> and maintains an in-memory Yjs document
              tree. Edits made by AI agents are routed directly in-process through <code>hocuspocus.openDirectConnection()</code>.
            </p>

            <div className="enterprise-alert enterprise-alert-tip">
              <strong>Performance Tip:</strong> Snapshot persistence to PostgreSQL uses binary bytea byte encoding, avoiding costly JSON string transformations on high-frequency transactions.
            </div>

            <p>
              When an agent suggests modifications, it dispatches <code>suggestion_insert</code> and <code>suggestion_delete</code> marks.
              Human authors inspect suggestions with attribution tooltips, retaining complete editorial authority to accept or reject each delta.
            </p>
          </article>
        </div>
      </div>
    </div>
  );
};
