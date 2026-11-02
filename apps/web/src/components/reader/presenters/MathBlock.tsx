// Presentation component for KaTeX mathematics.
//
// KaTeX is rendered with `trust: false` so LaTeX cannot inject raw HTML or
// scripts. The generated HTML is run through DOMPurify as defence-in-depth.
// On render failure a safe error message is shown; no raw LaTeX disappears
// silently and no untrusted HTML is inserted.

import React, { useState } from 'react';
import katex from 'katex';
import DOMPurify from 'dompurify';
import { sanitizeHtml } from '../security.js';

interface MathBlockProps {
  tex: string;
  displayMode?: boolean;
  className?: string;
}

export const MathBlock: React.FC<MathBlockProps> = ({ tex, displayMode = true, className }) => {
  const [error, setError] = useState<string | null>(null);

  let html = '';
  try {
    html = katex.renderToString(tex || '', {
      displayMode,
      throwOnError: false,
      trust: false, // Strict security: prevent raw HTML/script injection
    });
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Formula render error');
    html = '';
  }

  const safe = error ? '' : sanitizeHtml(html);

  const containerClass = displayMode
    ? 'overflow-x-auto py-2 flex justify-center text-foreground font-serif text-base'
    : 'text-foreground font-serif text-base';

  if (error || !safe) {
    return (
      <div className={['rounded-lg bg-status-danger/10 border border-status-danger/20 text-status-danger text-xs font-mono', className].filter(Boolean).join(' ')}>
        <div className="font-semibold">Formula render error</div>
        <div className="text-[11px] break-words">{error || 'Unable to render formula.'}</div>
      </div>
    );
  }

  return (
    <div className={[containerClass, className].filter(Boolean).join(' ')}>
      <div dangerouslySetInnerHTML={{ __html: safe }} />
    </div>
  );
};
