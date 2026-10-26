import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  href?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export function useNotifications(enabled = true) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const result = await api.get<{ notifications: Notification[]; unreadCount: number }>('/notifications?limit=8');
      setNotifications(result.notifications);
      setUnreadCount(result.unreadCount);
    } catch {
      // Notifications are auxiliary UI; retain the last successful poll.
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
    if (!enabled) return;
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [enabled, refresh]);

  const markRead = useCallback(async (id: string) => {
    await api.post(`/notifications/${id}/read`);
    setNotifications((current) => current.map((item) => item.id === id ? { ...item, readAt: new Date().toISOString() } : item));
    setUnreadCount((count) => Math.max(0, count - 1));
  }, []);

  const markAllRead = useCallback(async () => {
    await api.post('/notifications/read-all');
    setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })));
    setUnreadCount(0);
  }, []);

  return { notifications, unreadCount, refresh, markRead, markAllRead };
}
