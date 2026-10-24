import React from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useTheme } from '../context/ThemeContext.js';
import { Sun, Moon, Laptop } from 'lucide-react';

export const SettingsView: React.FC = () => {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Personal Settings</h1>
        <p className="text-xs text-text-secondary mt-1">
          Manage your personal profile, reading comfort, and appearance preferences.
        </p>
      </div>

      {/* User Identity Panel */}
      <div className="p-6 rounded-xl bg-surface border border-border shadow-sm space-y-4">
        <h2 className="text-sm font-bold text-foreground">User Identity</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="text-text-muted block mb-1">Full Name</label>
            <div className="p-2.5 rounded-lg bg-canvas border border-border text-foreground font-medium">
              {user?.fullName || 'Not specified'}
            </div>
          </div>
          <div>
            <label className="text-text-muted block mb-1">Email Address</label>
            <div className="p-2.5 rounded-lg bg-canvas border border-border text-foreground font-medium">
              {user?.email || 'Not specified'}
            </div>
          </div>
          <div>
            <label className="text-text-muted block mb-1">Role Permission</label>
            <div className="p-2.5 rounded-lg bg-canvas border border-border text-accent-main font-semibold capitalize">
              {user?.role || 'reader'}
            </div>
          </div>
        </div>
      </div>

      {/* Appearance & Theme Settings */}
      <div className="p-6 rounded-xl bg-surface border border-border shadow-sm space-y-4">
        <div>
          <h2 className="text-sm font-bold text-foreground">Appearance & Reading Comfort</h2>
          <p className="text-xs text-text-secondary mt-0.5">
            Designed for long writing sessions with warm paper light mode and deep cool slate dark mode (~14:1 contrast).
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { id: 'light', label: 'Warm Paper', desc: 'Light mode (#F6F5F2)', icon: Sun },
            { id: 'dark', label: 'Cool Slate', desc: 'Dark mode (#0F1216)', icon: Moon },
            { id: 'system', label: 'System Sync', desc: 'Follows OS preference', icon: Laptop },
          ].map((opt) => {
            const Icon = opt.icon;
            const isSelected = theme === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setTheme(opt.id as any)}
                className={`flex flex-col items-center justify-center gap-2 p-4 rounded-xl border text-xs font-semibold transition-all ${
                  isSelected
                    ? 'border-accent-main bg-accent-bg text-accent-main shadow-sm'
                    : 'border-border bg-canvas hover:bg-elevated text-text-secondary hover:text-foreground'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{opt.label}</span>
                <span className="text-[10px] font-normal text-text-muted">{opt.desc}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
