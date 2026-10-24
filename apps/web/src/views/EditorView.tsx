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
    color: '#0284c7',
    role: 'author',
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100">
      {/* Editor Sub-Header / Status Bar */}
      <div className="h-12 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/my-work')}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            aria-label="Back to My Work"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="bg-transparent border-none text-sm font-semibold text-slate-100 focus:outline-none w-72 sm:w-96"
            placeholder="Untitled Post..."
          />
        </div>

        <div className="flex items-center gap-3">
          {/* Real-time Save Status Badge */}
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Radio className="w-2.5 h-2.5 animate-pulse" />
            <span>Saved ✓</span>
          </div>

          <button
            onClick={() => navigate('/reviews')}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs shadow-sm transition-all"
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
