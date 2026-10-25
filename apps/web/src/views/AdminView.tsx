import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Users, Key, Shield, CheckCircle2, AlertCircle, Loader2, Layers, Plus, Check, X, ArrowRight } from 'lucide-react';
import { api } from '../lib/api.js';

export const AdminView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'audit' | 'spaces' | 'users' | 'pats'>('audit');
  const [verifyStatus, setVerifyStatus] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  // Spaces governance state
  const [spaces, setSpaces] = useState<any[]>([]);
  const [spaceRequests, setSpaceRequests] = useState<any[]>([]);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [newSpaceSlug, setNewSpaceSlug] = useState('');
  const [newSpaceDesc, setNewSpaceDesc] = useState('');
  const [isCreatingSpace, setIsCreatingSpace] = useState(false);
  const [spaceError, setSpaceError] = useState<string | null>(null);

  const fetchAdminData = async () => {
    try {
      const spRes = await api.get<{ spaces: any[] }>('/spaces');
      if (spRes && spRes.spaces) setSpaces(spRes.spaces);
    } catch {}

    try {
      const reqRes = await api.get<{ requests: any[] }>('/spaces/requests');
      if (reqRes && reqRes.requests) setSpaceRequests(reqRes.requests);
    } catch {}
  };

  useEffect(() => {
    if (activeTab === 'spaces') {
      fetchAdminData();
    }
  }, [activeTab]);

  const handleCreateSpace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSpaceName.trim() || !newSpaceSlug.trim() || isCreatingSpace) return;
    setIsCreatingSpace(true);
    setSpaceError(null);
    try {
      await api.post('/spaces', {
        name: newSpaceName.trim(),
        slug: newSpaceSlug.trim(),
        description: newSpaceDesc.trim() || undefined,
      });
      setNewSpaceName('');
      setNewSpaceSlug('');
      setNewSpaceDesc('');
      fetchAdminData();
    } catch (err: any) {
      setSpaceError(err.message || 'Failed to create space.');
    } finally {
      setIsCreatingSpace(false);
    }
  };

  const handleReviewRequest = async (id: string, action: 'approve' | 'reject') => {
    try {
      await api.patch(`/spaces/requests/${id}`, { action });
      fetchAdminData();
    } catch (err: any) {
      alert(err.message || 'Failed to review space request.');
    }
  };

  const handleVerifyChain = async () => {
    setIsVerifying(true);
    setVerifyError(null);
    setVerifyStatus(null);
    try {
      const result = await api.get<{ valid: boolean; totalRows?: number; tamperedRowId?: string }>('/audit/verify');
      if (result.valid) {
        setVerifyStatus(
          result.totalRows !== undefined
            ? `100% Cryptographically Verified (${result.totalRows} blocks verified, 0 discrepancies)`
            : '100% Cryptographically Verified (Genesis chain verified, 0 discrepancies)'
        );
      } else {
        setVerifyError(
          result.tamperedRowId
            ? `Tamper detected at row ID: ${result.tamperedRowId}`
            : 'Integrity verification detected anomalies'
        );
        setVerifyStatus(null);
      }
    } catch (err: any) {
      setVerifyError(err.message || 'Failed to communicate with audit verification service. Please verify backend status.');
      setVerifyStatus(null);
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Glyphroom Admin Console</h1>
        <p className="text-xs text-text-secondary mt-1">
          Governance portal for user roles, Personal Access Tokens (PATs), and cryptographic audit trail verification.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border gap-4">
        {[
          { id: 'spaces', label: 'Team Spaces & Requests', icon: Layers },
          { id: 'users', label: 'User Directory', icon: Users },
          { id: 'pats', label: 'PAT Token Inventory', icon: Key },
          { id: 'audit', label: 'Audit Log & Chain Verification', icon: Shield },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 pb-3 px-2 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-accent-main text-accent-main'
                  : 'border-transparent text-text-muted hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Team Spaces & Requests Tab Content */}
      {activeTab === 'spaces' && (
        <div className="space-y-6">
          {/* Create New Space */}
          <div className="p-5 rounded-xl bg-surface border border-border shadow-sm space-y-4">
            <h2 className="text-sm font-bold text-foreground">Provision New Team Space</h2>
            <p className="text-xs text-text-secondary">
              Provision a new secure boundary for a project or engineering team with independent maintainers and document visibility.
            </p>

            {spaceError && (
              <div className="p-3 rounded-lg bg-status-danger/10 border border-status-danger/30 text-status-danger text-xs">
                {spaceError}
              </div>
            )}

            <form onSubmit={handleCreateSpace} className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <input
                type="text"
                value={newSpaceName}
                onChange={(e) => {
                  setNewSpaceName(e.target.value);
                  setNewSpaceSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
                }}
                placeholder="Space Name (e.g. Payments Revamp)"
                className="p-2 rounded-lg bg-canvas border border-border text-foreground"
                required
              />
              <input
                type="text"
                value={newSpaceSlug}
                onChange={(e) => setNewSpaceSlug(e.target.value)}
                placeholder="Slug (e.g. payments-revamp)"
                className="p-2 rounded-lg bg-canvas border border-border text-foreground font-mono"
                required
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSpaceDesc}
                  onChange={(e) => setNewSpaceDesc(e.target.value)}
                  placeholder="Optional description"
                  className="flex-1 p-2 rounded-lg bg-canvas border border-border text-foreground"
                />
                <button
                  type="submit"
                  disabled={isCreatingSpace || !newSpaceName.trim()}
                  className="px-4 py-2 rounded-lg bg-accent text-white font-semibold inline-flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create</span>
                </button>
              </div>
            </form>
          </div>

          {/* Pending Space Requests */}
          <div className="p-5 rounded-xl bg-surface border border-border shadow-sm space-y-4">
            <h2 className="text-sm font-bold text-foreground">Pending Space Requests from Users</h2>
            <p className="text-xs text-text-secondary">
              Review and approve user-submitted space proposals.
            </p>

            {spaceRequests.length === 0 ? (
              <p className="text-xs text-text-muted italic">No pending space requests.</p>
            ) : (
              <div className="divide-y divide-border">
                {spaceRequests.map((req) => (
                  <div key={req.id} className="py-3 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-bold text-foreground">{req.name} <span className="font-mono text-text-muted">({req.slug})</span></div>
                      <div className="text-text-secondary mt-0.5">{req.reason || 'No description provided'}</div>
                      <div className="text-[11px] text-text-muted mt-0.5">Requested by {req.requesterName} ({req.requesterEmail})</div>
                    </div>
                    {req.status === 'pending' ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleReviewRequest(req.id, 'approve')}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold inline-flex items-center gap-1 hover:bg-emerald-700"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Approve</span>
                        </button>
                        <button
                          onClick={() => handleReviewRequest(req.id, 'reject')}
                          className="px-3 py-1.5 rounded-lg border border-border bg-canvas text-text-secondary hover:text-status-danger"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Reject</span>
                        </button>
                      </div>
                    ) : (
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-canvas border border-border text-text-muted">
                        {req.status}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Active Spaces Directory */}
          <div className="p-5 rounded-xl bg-surface border border-border shadow-sm space-y-4">
            <h2 className="text-sm font-bold text-foreground">Active Enterprise Spaces ({spaces.length})</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {spaces.map((sp) => (
                <Link
                  key={sp.id}
                  to={`/spaces/${sp.slug}`}
                  className="p-3.5 rounded-lg bg-canvas border border-border hover:border-accent hover:shadow-xs transition-all space-y-1.5 block group cursor-pointer"
                  title={`Open ${sp.name} Space`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Layers className="w-4 h-4 text-accent shrink-0" />
                      <span className="font-bold text-xs text-foreground group-hover:text-accent transition-colors truncate">
                        {sp.name}
                      </span>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-text-muted group-hover:text-accent group-hover:translate-x-0.5 transition-all shrink-0" />
                  </div>
                  <p className="text-[11px] text-text-secondary line-clamp-2">
                    {sp.description || 'Dedicated workspace'}
                  </p>
                  <div className="font-mono text-[10px] text-text-muted">
                    /spaces/{sp.slug}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* User Directory Tab Content */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="p-5 rounded-xl bg-surface border border-border shadow-sm">
            <h2 className="text-sm font-bold text-foreground">User Management Directory</h2>
            <p className="text-xs text-text-secondary mt-0.5">
              Manage enterprise member accounts, role assignments (admin, moderator, author, reader), and access status.
            </p>
          </div>
        </div>
      )}

      {/* PAT Token Inventory Tab Content */}
      {activeTab === 'pats' && (
        <div className="space-y-4">
          <div className="p-5 rounded-xl bg-surface border border-border shadow-sm">
            <h2 className="text-sm font-bold text-foreground">Personal Access Tokens (PAT) Inventory</h2>
            <p className="text-xs text-text-secondary mt-0.5">
              Active enterprise-wide personal access tokens, authorized scopes, and credential revocation controls.
            </p>
          </div>
        </div>
      )}

      {/* Audit Log Tab Content */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="p-5 rounded-xl bg-surface border border-border shadow-sm flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-foreground">Cryptographic SHA-256 Tamper Verification</h2>
              <p className="text-xs text-text-secondary mt-0.5">
                Validates the sequential SHA-256 hash chain across all recorded platform audit events.
              </p>
            </div>
            <button
              onClick={handleVerifyChain}
              disabled={isVerifying}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-status-success text-white disabled:opacity-50 font-semibold text-xs shadow-sm hover:opacity-90 transition-all"
            >
              {isVerifying ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <span>Verify Hash Chain</span>
              )}
            </button>
          </div>

          {verifyStatus && (
            <div className="p-4 rounded-xl bg-status-success/10 border border-status-success/30 text-status-success text-xs font-semibold flex items-center gap-2" role="status">
              <CheckCircle2 className="w-4 h-4" />
              <span>{verifyStatus}</span>
            </div>
          )}

          {verifyError && (
            <div className="p-4 rounded-xl bg-status-danger/10 border border-status-danger/30 text-status-danger text-xs font-semibold flex items-center gap-2" role="alert">
              <AlertCircle className="w-4 h-4" />
              <span>{verifyError}</span>
            </div>
          )}

          <div className="p-5 rounded-xl bg-surface border border-border shadow-sm space-y-3">
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Audit Timeline & Event Stream</h3>
            <p className="text-xs text-text-secondary">
              Immutable append-only ledger of platform governance actions, authentication events, and document updates.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
