import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useTheme } from '../context/ThemeContext.js';
import { Sun, Moon, Laptop, Key, Plus, Trash2, Copy, Check, ShieldAlert, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';

export interface PatItem {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
}

export const SettingsView: React.FC = () => {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();

  // PAT management state
  const [tokens, setTokens] = useState<PatItem[]>([]);
  const [tokenName, setTokenName] = useState('');
  const [isCreatingToken, setIsCreatingToken] = useState(false);
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [hasCopiedSecret, setHasCopiedSecret] = useState(false);
  const [patError, setPatError] = useState<string | null>(null);

  const fetchTokens = async () => {
    try {
      const res = await api.get<{ tokens: PatItem[] }>('/pats');
      setTokens(res.tokens || []);
    } catch {
      // Ignore if unauthenticated
    }
  };

  useEffect(() => {
    if (user) {
      fetchTokens();
    }
  }, [user]);

  const handleCreatePat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenName.trim() || isCreatingToken) return;

    setIsCreatingToken(true);
    setPatError(null);
    setGeneratedSecret(null);
    try {
      const res = await api.post<{ token: PatItem; secret: string }>('/pats', {
        name: tokenName.trim(),
        scopes: ['posts:read', 'posts:write', 'spaces:read', 'spaces:write'],
        expiresInDays: 90,
      });
      setTokenName('');
      setGeneratedSecret(res.secret);
      fetchTokens();
    } catch (err: any) {
      setPatError(err.message || 'Failed to create Personal Access Token.');
    } finally {
      setIsCreatingToken(false);
    }
  };

  const handleRevokePat = async (id: string) => {
    try {
      await api.delete(`/pats/${id}`);
      fetchTokens();
    } catch (err: any) {
      alert(err.message || 'Failed to revoke token.');
    }
  };

  const handleCopySecret = () => {
    if (generatedSecret) {
      navigator.clipboard.writeText(generatedSecret);
      setHasCopiedSecret(true);
      setTimeout(() => setHasCopiedSecret(false), 2500);
    }
  };

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
      {/* Personal Access Tokens (PAT) for MCP & External Tools */}
      <div className="p-6 rounded-xl bg-surface border border-border shadow-sm space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-bold text-foreground">Personal Access Tokens (PAT)</h2>
          </div>
          <p className="text-xs text-text-secondary mt-0.5">
            Create API tokens to connect your external Model Context Protocol (MCP) clients, Claude Desktop, Cursor, or automated scripts to Glyphroom.
          </p>
        </div>

        {/* Secret alert when newly created */}
        {generatedSecret && (
          <div className="p-4 rounded-xl bg-accent-bg border border-accent/30 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-accent">
              <ShieldAlert className="w-4 h-4" />
              <span>Copy your personal token now. It will not be shown again!</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={generatedSecret}
                className="flex-1 p-2 rounded-lg bg-surface border border-border font-mono text-xs text-foreground select-all"
              />
              <button
                onClick={handleCopySecret}
                className="px-3 py-2 rounded-lg bg-accent text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-xs"
              >
                {hasCopiedSecret ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Token</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {patError && (
          <div className="p-3 rounded-lg bg-status-danger/10 border border-status-danger/30 text-status-danger text-xs">
            {patError}
          </div>
        )}

        {/* Generate PAT form */}
        <form onSubmit={handleCreatePat} className="flex gap-2">
          <input
            type="text"
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder="Token name (e.g., Claude Desktop MCP)"
            className="flex-1 p-2 rounded-lg bg-canvas border border-border text-foreground text-xs"
          />
          <button
            type="submit"
            disabled={isCreatingToken || !tokenName.trim()}
            className="px-4 py-2 rounded-lg bg-accent text-white text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5 shadow-xs"
          >
            {isCreatingToken ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            <span>Generate Token</span>
          </button>
        </form>

        {/* Active tokens list */}
        <div className="space-y-2 pt-2">
          {tokens.length === 0 ? (
            <p className="text-xs text-text-muted italic">No active personal access tokens.</p>
          ) : (
            tokens.map((tok) => (
              <div
                key={tok.id}
                className="p-3 rounded-lg bg-canvas border border-border flex items-center justify-between text-xs"
              >
                <div className="space-y-0.5">
                  <div className="font-semibold text-foreground">{tok.name}</div>
                  <div className="text-[11px] text-text-muted">
                    Created {new Date(tok.createdAt).toLocaleDateString()}
                    {tok.lastUsedAt && ` • Last used ${new Date(tok.lastUsedAt).toLocaleDateString()}`}
                  </div>
                </div>
                <button
                  onClick={() => handleRevokePat(tok.id)}
                  className="p-1.5 rounded-md text-text-muted hover:text-status-danger hover:bg-status-danger/10 transition-colors"
                  title="Revoke Token"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
