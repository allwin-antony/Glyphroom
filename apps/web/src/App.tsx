import React, { useState, useMemo } from 'react';
import * as Y from 'yjs';
import { CollaborativeEditor } from './components/Editor.js';
import { ReaderPreview } from './components/ReaderPreview.js';
import { FileEdit, BookOpen, ShieldCheck, Cpu } from 'lucide-react';

export const App: React.FC = () => {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [docJSON, setDocJSON] = useState<any>(null);
  const [postTitle, setPostTitle] = useState('Enterprise Architecture & Agent Gateway Spec');

  // Stable Yjs document instance for the post
  const ydoc = useMemo(() => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('prosemirror');

    // Seed initial content if empty
    if (fragment.length === 0) {
      const p1 = new Y.XmlElement('paragraph');
      const text1 = new Y.XmlText('Welcome to Enterprise Blogger 2.0 collaborative workspace.');
      p1.insert(0, [text1]);
      fragment.insert(0, [p1]);
    }
    return doc;
  }, []);

  const currentUser = {
    name: 'Santosh (Lead Author)',
    color: '#0284c7',
    role: 'author',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#f8fafc' }}>
      {/* Top Application Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 24px',
          background: '#0f172a',
          color: '#ffffff',
          borderBottom: '1px solid #1e293b',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 700,
              fontSize: '16px',
              letterSpacing: '-0.02em',
            }}
          >
            <ShieldCheck size={20} color="#38bdf8" />
            <span>Enterprise Blogger 2.0</span>
          </div>

          <span style={{ color: '#475569' }}>|</span>

          <input
            value={postTitle}
            onChange={(e) => setPostTitle(e.target.value)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid transparent',
              color: '#f8fafc',
              fontSize: '15px',
              fontWeight: 500,
              padding: '2px 4px',
              outline: 'none',
            }}
            placeholder="Post Title..."
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Mode Switcher Tabs */}
          <div
            style={{
              display: 'flex',
              background: '#1e293b',
              padding: '2px',
              borderRadius: '6px',
            }}
          >
            <button
              onClick={() => setMode('edit')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: '4px',
                border: 'none',
                background: mode === 'edit' ? '#0284c7' : 'transparent',
                color: '#ffffff',
                fontWeight: 500,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              <FileEdit size={14} /> Editor
            </button>

            <button
              onClick={() => setMode('preview')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: '4px',
                border: 'none',
                background: mode === 'preview' ? '#0284c7' : 'transparent',
                color: '#ffffff',
                fontWeight: 500,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              <BookOpen size={14} /> Reader View
            </button>
          </div>

          {/* User profile capsule */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              color: '#94a3b8',
              background: '#1e293b',
              padding: '4px 10px',
              borderRadius: '16px',
            }}
          >
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: currentUser.color,
              }}
            />
            <span style={{ color: '#f8fafc', fontWeight: 500 }}>{currentUser.name}</span>
          </div>
        </div>
      </header>

      {/* Main Workspace Body */}
      <main style={{ flex: 1, overflow: 'hidden' }}>
        {mode === 'edit' ? (
          <CollaborativeEditor
            ydoc={ydoc}
            user={currentUser}
            onDocChange={(json) => setDocJSON(json)}
          />
        ) : (
          <div style={{ padding: '32px', overflowY: 'auto', height: '100%' }}>
            <ReaderPreview prosemirrorDocJSON={docJSON} title={postTitle} />
          </div>
        )}
      </main>
    </div>
  );
};
