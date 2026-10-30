import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useTheme } from '../context/ThemeContext.js';
import { Sun, Moon, Laptop, Key, Plus, Trash2, Copy, Check, ShieldAlert, Loader2, Clock } from 'lucide-react';
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
  const [selectedScopes, setSelectedScopes] = useState<string[]>([
    'posts:read',
    'posts:write',
    'comments:write',
    'spaces:read',
    'spaces:write',
  ]);
  const [expiresInDays, setExpiresInDays] = useState<number>(90);
  const [isCreatingToken, setIsCreatingToken] = useState(false);
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [hasCopiedSecret, setHasCopiedSecret] = useState(false);
  const [patError, setPatError] = useState<string | null>(null);

  const AVAILABLE_SCOPES = [
    { id: 'posts:read', label: 'Read Posts & Documents', desc: 'Allows AI or scripts to read documents & view catalogs.' },
    { id: 'posts:write', label: 'Edit & Create Posts', desc: 'Allows drafting, editing, and appending section cards.' },
    { id: 'comments:write', label: 'Write Comments', desc: 'Allows adding discussion notes and replies.' },
    { id: 'posts:publish', label: 'Publish Approved Posts', desc: 'Allows publication when your existing role and the review workflow permit it.' },
    { id: 'spaces:read', label: 'Read Spaces & Directories', desc: 'Allows browsing team spaces and member rosters.' },
    { id: 'spaces:write', label: 'Manage Spaces', desc: 'Allows creating team spaces and requesting permissions.' },
  ];

  const handleToggleScope = (scopeId: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scopeId) ? prev.filter((s) => s !== scopeId) : [...prev, scopeId]
    );
  };

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
    if (!tokenName.trim() || isCreatingToken || selectedScopes.length === 0) return;

    setIsCreatingToken(true);
    setPatError(null);
    setGeneratedSecret(null);
    try {
      const res = await api.post<{ token: PatItem; secret: string }>('/pats', {
        name: tokenName.trim(),
        scopes: selectedScopes,
        expiresInDays: expiresInDays,
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

  const formatLastUsed = (dateStr?: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    let relative = '';
    if (diffMins < 1) relative = 'Just now';
    else if (diffMins < 60) relative = `${diffMins}m ago`;
    else if (diffHours < 24) relative = `${diffHours}h ago`;
    else if (diffDays < 7) relative = `${diffDays}d ago`;
    else relative = date.toLocaleDateString();

    return `${relative} (${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
  };

  const handleRevokePat = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to revoke and delete token "${name}"? External tools and scripts using this token will immediately lose access.`)) {
      return;
    }
    // Optimistically update list immediately
    setTokens((prev) => prev.filter((tok) => tok.id !== id));
    try {
      await api.delete(`/pats/${id}`);
      await fetchTokens();
    } catch (err: any) {
      alert(err.message || 'Failed to revoke token.');
      fetchTokens();
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
        <form onSubmit={handleCreatePat} className="space-y-3 p-4 rounded-xl bg-canvas border border-border">
          <div className="font-semibold text-xs text-foreground">Create New Access Token</div>
          
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              placeholder="Token description (e.g. Antigravity MCP Assistant)"
              className="flex-1 p-2 rounded-lg bg-surface border border-border text-foreground text-xs"
            />
            <select
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
              className="p-2 rounded-lg bg-surface border border-border text-foreground text-xs"
            >
              <option value={30}>Expires in 30 days</option>
              <option value={90}>Expires in 90 days</option>
              <option value={180}>Expires in 180 days</option>
              <option value={365}>Expires in 1 year</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-text-muted mb-1.5 uppercase tracking-wider">
              Token Permissions (Scopes)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {AVAILABLE_SCOPES.map((sc) => {
                const isSelected = selectedScopes.includes(sc.id);
                return (
                  <button
                    key={sc.id}
                    type="button"
                    onClick={() => handleToggleScope(sc.id)}
                    className={`p-2.5 rounded-lg border text-left transition-colors flex items-start gap-2.5 ${
                      isSelected
                        ? 'bg-accent/10 border-accent/40 text-foreground'
                        : 'bg-surface border-border text-text-muted hover:border-border-strong'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      readOnly
                      className="mt-0.5 accent-accent pointer-events-none"
                    />
                    <div>
                      <div className="text-xs font-semibold">{sc.label}</div>
                      <div className="text-[10px] text-text-secondary">{sc.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={isCreatingToken || !tokenName.trim() || selectedScopes.length === 0}
              className="px-4 py-2 rounded-lg bg-accent text-white text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5 shadow-xs hover:opacity-90 transition-opacity"
            >
              {isCreatingToken ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              <span>Generate Token</span>
            </button>
          </div>
        </form>

        {/* Active tokens list */}
        <div className="space-y-3 pt-2">
          <div className="text-xs font-semibold text-foreground flex items-center justify-between">
            <span>Active Tokens ({tokens.length})</span>
          </div>

          {tokens.length === 0 ? (
            <p className="text-xs text-text-muted italic p-3 rounded-lg bg-canvas border border-border">
              No active personal access tokens found.
            </p>
          ) : (
            tokens.map((tok) => (
              <div
                key={tok.id}
                className="p-4 rounded-xl bg-canvas border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-foreground text-sm">{tok.name}</span>
                    {tok.lastUsedAt ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-status-success/15 text-status-success border border-status-success/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-text-muted/10 text-text-muted border border-border">
                        Never used
                      </span>
                    )}
                  </div>

                  {tok.scopes && tok.scopes.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {tok.scopes.map((scope) => (
                        <span
                          key={scope}
                          className="px-2 py-0.5 rounded bg-accent/10 border border-accent/20 text-accent font-mono text-[10px]"
                        >
                          {scope}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-secondary">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-text-muted" />
                      <span>
                        <strong className="text-foreground font-medium">Last used:</strong>{' '}
                        {tok.lastUsedAt ? (
                          <span className="text-foreground">{formatLastUsed(tok.lastUsedAt)}</span>
                        ) : (
                          <span className="text-text-muted italic">Never</span>
                        )}
                      </span>
                    </div>

                    <div>
                      <strong className="text-foreground font-medium">Created:</strong>{' '}
                      {new Date(tok.createdAt).toLocaleDateString()}
                    </div>

                    {tok.expiresAt && (
                      <div>
                        <strong className="text-foreground font-medium">Expires:</strong>{' '}
                        {new Date(tok.expiresAt).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end sm:self-center">
                  <button
                    onClick={() => handleRevokePat(tok.id, tok.name)}
                    className="px-3 py-1.5 rounded-lg border border-border text-text-muted hover:text-status-danger hover:border-status-danger/40 hover:bg-status-danger/10 transition-colors inline-flex items-center gap-1.5 text-xs font-medium"
                    title="Revoke & Delete Token"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
