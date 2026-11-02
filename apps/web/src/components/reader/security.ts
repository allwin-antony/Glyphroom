// Shared security helpers for the read-only rich-content reader/preview renderer.
//
// All rendering in this directory is presentation-only:
//  - Ordinary content is emitted as escaped React text (JSX interpolation).
//  - Raw HTML is never inserted via dangerouslySetInnerHTML except where the
//    source is a trusted generator (KaTeX with trust:false) or a
//    DOMPurify-sanitized Mermaid SVG (never a raw-SVG fallback).
//  - href/src URLs are protocol-allowlisted before rendering; javascript:/data:/
//    and other suspicious schemes are dropped.

import DOMPurify from 'dompurify';

export const ALLOWED_URL_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'] as const;
export type AllowedUrlProtocol = (typeof ALLOWED_URL_PROTOCOLS)[number];

// Base used to resolve relative URLs for protocol inspection. Same-origin
// relative links resolve to http: and are therefore allowed.
const URL_RESOLUTION_BASE = 'http://localhost.reader';

/** Control characters / null bytes that have no place in a URL attribute. */
const URL_CONTROL_RE = /[\0\u0001-\u001f\u007f]/;

/** Return true when `url` uses an allowlisted protocol. */
export function isAllowedUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url.trim()) return false;
  const trimmed = url.trim();
  if (URL_CONTROL_RE.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed, URL_RESOLUTION_BASE);
    return ALLOWED_URL_PROTOCOLS.includes(parsed.protocol.toLowerCase() as AllowedUrlProtocol);
  } catch {
    return false;
  }
}

/** Return the URL if allowlisted, otherwise an empty string (unsafe URL dropped). */
export function safeUrl(url: unknown): string {
  return isAllowedUrl(url) ? String(url) : '';
}

/** DOMPurify config for Mermaid SVG output. SVG profile only, no raw-SVG fallback. */
export const DOMPURIFY_SVG_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ['foreignObject'],
  ADD_ATTR: ['dominant-baseline'],
};

/** Sanitize Mermaid SVG. Returns '' when sanitization yields nothing (never raw SVG). */
export function sanitizeSvg(svg: unknown): string {
  if (typeof svg !== 'string' || !svg.trim()) return '';
  const clean = DOMPurify.sanitize(svg, DOMPURIFY_SVG_CONFIG);
  if (!clean || typeof clean !== 'string' || !clean.trim()) return '';
  return clean;
}

/** DOMPurify config for KaTeX-produced HTML (defence-in-depth). */
export const DOMPURIFY_HTML_CONFIG = {
  USE_PROFILES: { html: true, mathMl: true },
  ADD_TAGS: ['semantics', 'annotation'],
  ADD_ATTR: ['encoding'],
};

/** Sanitize KaTeX HTML output. */
export function sanitizeHtml(html: unknown): string {
  if (typeof html !== 'string' || !html.trim()) return '';
  const clean = DOMPurify.sanitize(html, DOMPURIFY_HTML_CONFIG);
  return typeof clean === 'string' ? clean : '';
}

/** Escape HTML special characters for safe text/attribute display. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
