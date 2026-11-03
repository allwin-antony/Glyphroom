import React from 'react';
import { Download, FileText, ShieldAlert, ShieldCheck, Clock } from 'lucide-react';
import { safeUrl } from './reader/security.js';

export interface AttachmentCardData {
  fileName: string;
  fileSize: number;
  mimeType: string;
  url: string;
  scanStatus?: 'scanning' | 'clean' | 'blocked';
}

export function formatAttachmentBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i] || 'Bytes'}`;
}

interface AttachmentCardProps extends AttachmentCardData {
  selected?: boolean;
}

export const AttachmentCard: React.FC<AttachmentCardProps> = ({
  fileName,
  fileSize,
  url,
  scanStatus = 'clean',
  selected = false,
}) => {
  const downloadUrl = safeUrl(url);
  const scan = scanStatus === 'blocked'
    ? { label: 'Scan: Blocked', Icon: ShieldAlert, className: 'text-status-error' }
    : scanStatus === 'scanning'
      ? { label: 'Scan: Scanning', Icon: Clock, className: 'text-status-warning' }
      : { label: 'Scan: Clean', Icon: ShieldCheck, className: 'text-status-success' };

  return (
    <div
      className={`reader-attachment-card flex items-center justify-between p-3 rounded-xl border bg-surface transition-all ${
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
            <span>{formatAttachmentBytes(fileSize)}</span>
            <span>•</span>
            <span className={`inline-flex items-center gap-1 font-medium ${scan.className}`}>
              <scan.Icon className="w-3 h-3" />
              <span>{scan.label}</span>
            </span>
          </div>
        </div>
      </div>

      <a
        href={downloadUrl}
        download={fileName}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-elevated border border-border hover:bg-canvas text-foreground text-xs font-semibold shadow-xs shrink-0 transition-colors"
      >
        <Download className="w-3.5 h-3.5 text-accent" />
        <span>Download</span>
      </a>
    </div>
  );
};
