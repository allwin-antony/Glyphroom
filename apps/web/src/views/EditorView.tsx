import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as Y from 'yjs';
import { CollaborativeEditor } from '../components/Editor.js';
import {
  FileCheck,
  ArrowLeft,
  Radio,
} from 'lucide-react';

export const EditorView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [title, setTitle] = useState('Enterprise Architecture & Collaborative Editor');

  // Stable Yjs document instance
  const ydoc = useMemo(() => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('prosemirror');
    if (fragment.length === 0) {
      const p = new Y.XmlElement('paragraph');
      const text = new Y.XmlText('Welcome to collaborative editing room for post: ' + (id || 'new'));
      p.insert(0, [text]);
      fragment.insert(0, [p]);
    }
    return doc;
  }, [id]);

  const currentUser = {
    name: 'Lead Author',
    color: '#0072B2', // Okabe-Ito Blue
    role: 'author',
  };

  return (
    <div className="flex flex-col h-full bg-canvas text-foreground">
      {/* Editor Sub-Header / Status Bar */}
      <div className="h-12 bg-surface border-b border-border flex items-center justify-between px-6 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/my-work')}
            className="p-1 rounded text-text-muted hover:text-foreground hover:bg-canvas transition-colors"
            aria-label="Back to My Work"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="bg-transparent border-none text-sm font-semibold text-foreground focus:outline-none w-72 sm:w-96 placeholder:text-text-muted"
            placeholder="Untitled Post..."
          />
        </div>

        <div className="flex items-center gap-3">
          {/* Real-time Save Status Badge */}
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-status-success/15 text-status-success border border-status-success/30">
            <Radio className="w-2.5 h-2.5 animate-pulse" />
            <span>Saved ✓</span>
          </div>

          <button
            onClick={() => navigate('/reviews')}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-primary hover:opacity-90 text-primary-foreground font-semibold text-xs shadow-sm transition-all"
          >
            <FileCheck className="w-3.5 h-3.5" />
            <span>Submit for Review</span>
          </button>
        </div>
      </div>

      {/* Editor Main Canvas */}
      <div className="flex-1 overflow-hidden">
        <CollaborativeEditor
          ydoc={ydoc}
          user={currentUser}
          onDocChange={() => {}}
        />
      </div>
    </div>
  );
};
