import type { HocuspocusProvider } from '@hocuspocus/provider';

/** Wait for server acknowledgement of all local updates, not just the first handshake. */
export function waitForCollabSync(provider: HocuspocusProvider | null, options: {
  timeoutMs?: number;
  signal?: AbortSignal;
} = {}): Promise<void> {
  if (!provider) return Promise.reject(new Error('Connect to the collaborative editor before submitting.'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      provider.off('synced', check);
      provider.off('unsyncedChanges', check);
      provider.off('authenticated', check);
      provider.off('status', onStatus);
      provider.off('authenticationFailed', disconnected);
      provider.off('disconnect', disconnected);
      provider.off('close', disconnected);
      provider.off('destroy', disconnected);
      options.signal?.removeEventListener('abort', canceled);
      if (error) reject(error); else resolve();
    };
    const disconnected = () => finish(new Error('Collaboration disconnected. Reconnect before submitting.'));
    const canceled = () => finish(new Error('Submission canceled.'));
    const check = () => {
      if (provider.document.isDestroyed || !provider.isAttached) return disconnected();
      if (provider.configuration.websocketProvider.status === 'connected'
        && provider.isAuthenticated && provider.isSynced && !provider.hasUnsyncedChanges) finish();
    };
    const onStatus = ({ status }: { status: string }) => {
      if (status === 'disconnected') disconnected(); else check();
    };
    const timer = setTimeout(() => finish(new Error('Your latest edits have not synced. Reconnect before submitting.')), options.timeoutMs ?? 10000);
    provider.on('synced', check);
    provider.on('unsyncedChanges', check);
    provider.on('authenticated', check);
    provider.on('status', onStatus);
    provider.on('authenticationFailed', disconnected);
    provider.on('disconnect', disconnected);
    provider.on('close', disconnected);
    provider.on('destroy', disconnected);
    options.signal?.addEventListener('abort', canceled, { once: true });
    if (options.signal?.aborted) return canceled();
    if (provider.configuration.websocketProvider.status === 'disconnected') return disconnected();
    try {
      provider.flushPendingUpdates();
      check();
    } catch {
      finish(new Error('Unable to sync the working document. Reconnect before submitting.'));
    }
  });
}
