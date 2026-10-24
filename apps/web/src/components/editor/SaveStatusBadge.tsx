import React, { useState, useEffect } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { Check, Loader2, Radio, WifiOff } from 'lucide-react';
import { cn } from '../../lib/utils.js';

export type SaveStatusState = 'saved' | 'saving' | 'reconnecting' | 'offline';

export interface SaveStatusBadgeProps {
  provider?: HocuspocusProvider | null;
  hasUnsavedChanges?: boolean;
  className?: string;
}

export const SaveStatusBadge: React.FC<SaveStatusBadgeProps> = ({
  provider,
  hasUnsavedChanges = false,
  className,
}) => {
  const [status, setStatus] = useState<SaveStatusState>('saved');

  useEffect(() => {
    // 1. Check offline status first
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setStatus('offline');
    }

    const handleOnline = () => {
      setStatus((provider as any)?.status === 'connected' ? 'saved' : 'reconnecting');
    };
    const handleOffline = () => setStatus('offline');

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (!provider) {
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }

    let saveDebounceTimer: any;

    // 2. Provider event listeners
    const onStatus = ({ status: wsStatus }: { status: string }) => {
      if ((typeof navigator !== 'undefined' && !navigator.onLine) || wsStatus === 'disconnected') {
        setStatus('offline');
      } else if (wsStatus === 'connecting') {
        setStatus('reconnecting');
      } else if (wsStatus === 'connected') {
        setStatus((provider as any).hasUnsyncedChanges ? 'saving' : 'saved');
      }
    };

    const onSynced = ({ state }: { state: boolean }) => {
      if (state && !(provider as any).hasUnsyncedChanges) {
        clearTimeout(saveDebounceTimer);
        saveDebounceTimer = setTimeout(() => {
          setStatus('saved');
        }, 300);
      }
    };

    const onUnsynced = ({ number }: { number: number }) => {
      if (number > 0) {
        clearTimeout(saveDebounceTimer);
        setStatus('saving');
      } else {
        clearTimeout(saveDebounceTimer);
        saveDebounceTimer = setTimeout(() => {
          setStatus('saved');
        }, 300);
      }
    };

    provider.on('status', onStatus);
    provider.on('synced', onSynced);
    provider.on('unsyncedChanges', onUnsynced);

    // Initial state reflection
    if ((provider as any)?.status === 'connected') {
      setStatus((provider as any).hasUnsyncedChanges ? 'saving' : 'saved');
    } else if ((provider as any)?.status === 'connecting') {
      setStatus('reconnecting');
    }

    return () => {
      clearTimeout(saveDebounceTimer);
      provider.off('status', onStatus);
      provider.off('synced', onSynced);
      provider.off('unsyncedChanges', onUnsynced);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [provider]);

  // Fallback to prop override if external state triggers saving
  useEffect(() => {
    if (hasUnsavedChanges && status === 'saved') {
      setStatus('saving');
    }
  }, [hasUnsavedChanges, status]);

  const configs = {
    saved: {
      label: 'Saved ✓',
      icon: <Check className="w-3 h-3 text-status-success shrink-0" />,
      classes: 'bg-status-success/15 text-status-success border-status-success/30',
    },
    saving: {
      label: 'Saving...',
      icon: <Loader2 className="w-3 h-3 animate-spin text-status-info shrink-0" />,
      classes: 'bg-status-info/15 text-status-info border-status-info/30',
    },
    reconnecting: {
      label: 'Reconnecting...',
      icon: <Radio className="w-3 h-3 animate-pulse text-status-warning shrink-0" />,
      classes: 'bg-status-warning/15 text-status-warning border-status-warning/30',
    },
    offline: {
      label: 'Offline',
      icon: <WifiOff className="w-3 h-3 text-status-danger shrink-0" />,
      classes: 'bg-status-danger/15 text-status-danger border-status-danger/30',
    },
  };

  const current = configs[status];

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all select-none shadow-xs",
        current.classes,
        className
      )}
    >
      {current.icon}
      <span>{current.label}</span>
    </div>
  );
};
