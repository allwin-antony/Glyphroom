import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import React from 'react';
import { AttachmentCard, formatAttachmentBytes } from '../components/AttachmentCard.js';

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
            <span>{formatAttachmentBytes(fileSize)}</span>
          </div>
        </div>
      ) : (
        <AttachmentCard fileName={fileName} fileSize={fileSize} mimeType={mimeType} url={url} scanStatus={scanStatus} selected={selected} />
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
