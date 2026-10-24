import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import React from 'react';
import { FileText, Download, ShieldCheck, ShieldAlert, Clock } from 'lucide-react';

interface AttachmentComponentProps {
  node: {
    attrs: {
      attachmentId: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
      url: string;
      scanStatus: 'scanning' | 'clean' | 'blocked';
    };
  };
  selected: boolean;
}

function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

const AttachmentComponent: React.FC<AttachmentComponentProps> = ({ node, selected }) => {
  const { fileName, fileSize, mimeType, url, scanStatus } = node.attrs;
  const isImage = mimeType?.startsWith('image/');

  return (
    <NodeViewWrapper className="my-3 not-prose select-none">
      {isImage ? (
        <div className={`rounded-xl overflow-hidden border p-1 bg-surface ${selected ? 'border-accent ring-1 ring-accent/30' : 'border-border'}`}>
          <img
            src={url}
            alt={fileName}
            className="w-full h-auto max-h-[500px] object-contain rounded-lg bg-canvas"
            loading="lazy"
          />
          <div className="flex items-center justify-between px-2 pt-1 text-[11px] text-text-muted">
            <span className="truncate">{fileName}</span>
            <span>{formatBytes(fileSize)}</span>
          </div>
        </div>
      ) : (
        <div
          className={`flex items-center justify-between p-3 rounded-xl border bg-surface transition-all ${
            selected ? 'border-accent shadow-xs ring-1 ring-accent/20' : 'border-border shadow-xs'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-canvas border border-border text-accent shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-xs text-foreground truncate max-w-sm">
                {fileName}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-text-muted mt-0.5">
                <span>{formatBytes(fileSize)}</span>
                <span>•</span>
                <span className="inline-flex items-center gap-1 font-medium text-status-success">
                  <ShieldCheck className="w-3 h-3" />
                  <span>Scan: Clean</span>
                </span>
              </div>
            </div>
          </div>

          <a
            href={url}
            download={fileName}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-elevated border border-border hover:bg-canvas text-foreground text-xs font-semibold shadow-xs shrink-0 transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-accent" />
            <span>Download</span>
          </a>
        </div>
      )}
    </NodeViewWrapper>
  );
};

export const FileAttachmentBlock = Node.create({
  name: 'fileAttachmentBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      attachmentId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-attachment-id') || '',
        renderHTML: (attrs) => ({ 'data-attachment-id': attrs.attachmentId }),
      },
      fileName: {
        default: 'Attachment',
        parseHTML: (el) => el.getAttribute('data-filename') || '',
        renderHTML: (attrs) => ({ 'data-filename': attrs.fileName }),
      },
      fileSize: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute('data-filesize')) || 0,
        renderHTML: (attrs) => ({ 'data-filesize': attrs.fileSize }),
      },
      mimeType: {
        default: 'application/octet-stream',
        parseHTML: (el) => el.getAttribute('data-mimetype') || '',
        renderHTML: (attrs) => ({ 'data-mimetype': attrs.mimeType }),
      },
      url: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-url') || '',
        renderHTML: (attrs) => ({ 'data-url': attrs.url }),
      },
      scanStatus: {
        default: 'clean',
        parseHTML: (el) => el.getAttribute('data-scan') || 'clean',
        renderHTML: (attrs) => ({ 'data-scan': attrs.scanStatus }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="file-attachment-block"]',
        getAttrs: (el) => {
          if (typeof el === 'string') return false;
          return {
            attachmentId: el.getAttribute('data-attachment-id') || '',
            fileName: el.getAttribute('data-filename') || '',
            fileSize: Number(el.getAttribute('data-filesize')) || 0,
            mimeType: el.getAttribute('data-mimetype') || '',
            url: el.getAttribute('data-url') || '',
            scanStatus: el.getAttribute('data-scan') || 'clean',
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'file-attachment-block' }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentComponent as any);
  },
});
