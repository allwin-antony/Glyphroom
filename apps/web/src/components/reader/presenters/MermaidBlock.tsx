// Presentation component for Mermaid diagrams.
//
// Security controls:
//  - Mermaid is initialized with `securityLevel: 'strict'`.
//  - Produced SVG is run through DOMPurify (SVG profile).
//  - NEVER a `sanitized || rawSvg` fallback: when sanitization yields nothing
//    a safe error is shown.
//  - Diagram ids are unique per instance/render (monotonic counter).
//  - Stale async results are ignored via a per-effect render sequence and a
//    mounted flag (unmount / newer render cancels earlier results).
//
// jsdom lacks full SVG/font layout APIs, so consumers (tests) are expected to
// mock `mermaid`; this component gracefully degrades to an error message when
// the library is unavailable.

import React, { useState, useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { sanitizeSvg } from '../security.js';

interface MermaidBlockProps {
  code: string;
  className?: string;
}

// Monotonic counter keeps diagram container ids unique across instances.
let mermaidInstanceCounter = 0;

export const MermaidBlock: React.FC<MermaidBlockProps> = ({ code, className }) => {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  const instanceId = useRef(++mermaidInstanceCounter);
  const mounted = useRef(true);
  const renderSeq = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const seq = ++renderSeq.current;
    const localInstance = instanceId.current;

    if (!code || !code.trim()) {
      setSvg('');
      setError(null);
      setRendering(false);
      return;
    }

    setRendering(true);
    setError(null);
    let cancelled = false;

    (async () => {
      let mermaid;
      try {
        mermaid = (await import('mermaid')).default;
      } catch {
        if (cancelled || seq !== renderSeq.current || !mounted.current) return;
        setRendering(false);
        setError('Mermaid library unavailable');
        setSvg('');
        return;
      }

      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'neutral',
          fontFamily: 'inherit',
        });
        const id = `mermaid-${localInstance}-${seq}`;
        const { svg: raw } = await mermaid.render(id, code);
        if (cancelled || seq !== renderSeq.current || !mounted.current) return;
        const clean = sanitizeSvg(raw);
        if (!clean) {
          setError('Diagram output could not be sanitized');
          setSvg('');
        } else {
          setSvg(clean);
          setError(null);
        }
      } catch (err) {
        if (cancelled || seq !== renderSeq.current || !mounted.current) return;
        setSvg('');
        setError(err instanceof Error ? err.message : 'Mermaid diagram syntax error');
      } finally {
        if (!cancelled && seq === renderSeq.current && mounted.current) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [code]);

  if (!code || !code.trim()) return null;

  const wrapperClass = ['overflow-x-auto py-3 flex justify-center text-foreground', className].filter(Boolean).join(' ');

  if (error) {
    return (
      <div className={['p-3 rounded-lg bg-status-danger/10 border border-status-danger/20 text-status-danger text-xs font-mono space-y-1', className].filter(Boolean).join(' ')}>
        <div className="font-semibold">Diagram Syntax Error</div>
        <div className="text-[11px] break-words">{error}</div>
      </div>
    );
  }

  if (rendering) {
    return (
      <div className={['py-8 flex flex-col items-center justify-center text-text-muted text-xs gap-2', className].filter(Boolean).join(' ')}>
        <span>Rendering diagram...</span>
      </div>
    );
  }

  return <div className={wrapperClass} dangerouslySetInnerHTML={{ __html: svg }} />;
};
