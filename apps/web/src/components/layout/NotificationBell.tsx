import React, { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../../hooks/useNotifications.js';

export const NotificationBell: React.FC = () => {
  const navigate = useNavigate();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-label="Notifications" aria-expanded={open} className="relative p-2 rounded-lg text-text-muted hover:text-foreground hover:bg-canvas transition-colors">
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 h-4 px-1 rounded-full bg-status-danger text-white text-[10px] font-bold flex items-center justify-center">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl bg-elevated border border-border shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="font-semibold text-sm">Notifications</span>
            {unreadCount > 0 && <button type="button" onClick={() => void markAllRead()} className="flex items-center gap-1 text-[11px] text-accent-main hover:underline"><CheckCheck className="w-3.5 h-3.5" />Mark all read</button>}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? <p className="px-4 py-8 text-center text-xs text-text-muted">You are all caught up.</p> : notifications.map((notification) => (
              <button key={notification.id} type="button" onClick={() => { if (!notification.readAt) void markRead(notification.id); if (notification.href) navigate(notification.href); setOpen(false); }} className={`w-full text-left px-4 py-3 border-b border-border last:border-0 hover:bg-canvas ${notification.readAt ? '' : 'bg-accent-bg/30'}`}>
                <div className="flex items-start gap-2"><span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${notification.readAt ? 'bg-border' : 'bg-accent-main'}`} /><span className="min-w-0"><span className="block text-xs font-semibold text-foreground">{notification.title}</span><span className="block mt-1 text-xs text-text-secondary">{notification.body}</span></span></div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
