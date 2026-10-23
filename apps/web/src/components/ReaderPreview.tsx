import React from 'react';
import { exportDerivedMarkdown } from '@enterprise-blogger/shared';
import { Eye, BookOpen } from 'lucide-react';

export interface ReaderPreviewProps {
  prosemirrorDocJSON: any;
  title: string;
}

export const ReaderPreview: React.FC<ReaderPreviewProps> = ({ prosemirrorDocJSON, title }) => {
  const derivedMarkdown = prosemirrorDocJSON
    ? exportDerivedMarkdown(prosemirrorDocJSON)
    : '';

  return (
    <div
      style={{
        maxWidth: '800px',
        margin: '0 auto',
        padding: '32px 24px',
        background: '#ffffff',
        borderRadius: '8px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          paddingBottom: '16px',
          marginBottom: '24px',
          borderBottom: '1px solid #e2e8f0',
          color: '#64748b',
          fontSize: '13px',
        }}
      >
        <BookOpen size={18} color="#0284c7" />
        <span style={{ fontWeight: 600, color: '#0f172a' }}>Published Reader Projection</span>
        <span>• Pending AI insertions are excluded, pending deletions retain original text</span>
      </div>

      <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '24px', color: '#0f172a' }}>
        {title || 'Untitled Post'}
      </h1>

      <div
        style={{
          whiteSpace: 'pre-wrap',
          fontFamily: 'inherit',
          fontSize: '16px',
          lineHeight: '1.7',
          color: '#334155',
        }}
      >
        {derivedMarkdown}
      </div>
    </div>
  );
};
