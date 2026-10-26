import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Users, Key, Shield, CheckCircle2, AlertCircle, Loader2, Layers, Plus, Check, X, ArrowRight, RefreshCw } from 'lucide-react';
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

  type AdminUser = { id: string; email: string; fullName: string; role: string; isActive: boolean; ssoProvider?: string | null; createdAt?: string };
  type AdminPat = { id: string; name: string; scopes: string[]; lastUsedAt?: string | null; expiresAt?: string | null; revokedAt?: string | null; createdAt?: string; userEmail: string; userFullName: string; userIsActive: boolean };
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminPats, setAdminPats] = useState<AdminPat[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [userRole, setUserRole] = useState('all');
  const [userStatus, setUserStatus] = useState('all');
  const [patSearch, setPatSearch] = useState('');
  const [patStatus, setPatStatus] = useState('all');
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminAction, setAdminAction] = useState<string | null>(null);
  const [confirmingAction, setConfirmingAction] = useState<string | null>(null);

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

  const fetchUsers = async () => {
    setAdminLoading(true);
    setAdminError(null);
    try {
      const params = new URLSearchParams({ status: userStatus });
      if (userSearch.trim()) params.set('q', userSearch.trim());
      if (userRole !== 'all') params.set('role', userRole);
      const result = await api.get<{ users: AdminUser[] }>(`/admin/users?${params.toString()}`);
      setAdminUsers(result.users || []);
    } catch (err: any) {
      setAdminError(err?.message || 'Failed to load users.');
    } finally {
      setAdminLoading(false);
    }
  };

  const fetchPats = async () => {
    setAdminLoading(true);
    setAdminError(null);
    try {
      const params = new URLSearchParams({ status: patStatus });
      if (patSearch.trim()) params.set('q', patSearch.trim());
      const result = await api.get<{ tokens: AdminPat[] }>(`/admin/pats?${params.toString()}`);
      setAdminPats(result.tokens || []);
    } catch (err: any) {
      setAdminError(err?.message || 'Failed to load PAT inventory.');
    } finally {
      setAdminLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'users') fetchUsers();
    if (activeTab === 'pats') fetchPats();
  }, [activeTab]);

  const updateUserRole = async (user: AdminUser, role: string) => {
    if (role === user.role) return;
    if (confirmingAction !== `role-${user.id}-${role}`) {
      setConfirmingAction(`role-${user.id}-${role}`);
      return;
    }
    setAdminAction(`role-${user.id}`);
    setConfirmingAction(null);
    try {
      await api.patch(`/admin/users/${user.id}/role`, { role });
      await fetchUsers();
    } catch (err: any) {
      setAdminError(err?.message || 'Failed to update user role.');
    } finally {
      setAdminAction(null);
    }
  };

  const updateUserStatus = async (user: AdminUser) => {
    const nextStatus = !user.isActive;
    if (confirmingAction !== `status-${user.id}`) {
      setConfirmingAction(`status-${user.id}`);
      return;
    }
    setAdminAction(`status-${user.id}`);
    setConfirmingAction(null);
    try {
      await api.patch(`/admin/users/${user.id}/status`, { isActive: nextStatus });
      await fetchUsers();
    } catch (err: any) {
      setAdminError(err?.message || 'Failed to update account status.');
    } finally {
      setAdminAction(null);
    }
  };

  const revokeAdminPat = async (pat: AdminPat) => {
    if (confirmingAction !== `pat-${pat.id}`) {
      setConfirmingAction(`pat-${pat.id}`);
      return;
    }
    setAdminAction(`pat-${pat.id}`);
    setConfirmingAction(null);
    try {
      await api.delete(`/admin/pats/${pat.id}`);
      await fetchPats();
    } catch (err: any) {
      setAdminError(err?.message || 'Failed to revoke PAT.');
    } finally {
      setAdminAction(null);
    }
  };

  const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString() : 'Never';

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
          <div className="p-5 rounded-xl bg-surface border border-border shadow-sm space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-foreground">User Management Directory</h2>
                <p className="text-xs text-text-secondary mt-0.5">Manage enterprise member accounts, roles, and access status.</p>
              </div>
              <button onClick={fetchUsers} disabled={adminLoading} className="p-2 rounded-lg border border-border text-text-secondary hover:text-foreground disabled:opacity-50" aria-label="Refresh users"><RefreshCw className={`w-4 h-4 ${adminLoading ? 'animate-spin' : ''}`} /></button>
            </div>
            <div className="flex flex-wrap gap-2">
              <input aria-label="Search users" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fetchUsers()} placeholder="Search name or email" className="p-2 rounded-lg bg-canvas border border-border text-foreground text-xs flex-1 min-w-48" />
              <select aria-label="Filter users by role" value={userRole} onChange={(e) => setUserRole(e.target.value)} className="p-2 rounded-lg bg-canvas border border-border text-foreground text-xs"><option value="all">All roles</option><option value="admin">Admin</option><option value="moderator">Moderator</option><option value="author">Author</option><option value="reader">Reader</option></select>
              <select aria-label="Filter users by status" value={userStatus} onChange={(e) => setUserStatus(e.target.value)} className="p-2 rounded-lg bg-canvas border border-border text-foreground text-xs"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
              <button onClick={fetchUsers} className="px-3 py-2 rounded-lg bg-accent text-white text-xs font-semibold">Apply filters</button>
            </div>
            {adminError && <div role="alert" className="p-3 rounded-lg bg-status-danger/10 border border-status-danger/30 text-status-danger text-xs">{adminError}</div>}
            {adminLoading ? <div className="py-8 text-center text-xs text-text-secondary"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading users...</div> : adminUsers.length === 0 ? <p className="py-8 text-center text-xs text-text-muted italic">No users match these filters.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-text-muted border-b border-border"><th className="p-2">User</th><th className="p-2">Role</th><th className="p-2">Status</th><th className="p-2">Provider</th><th className="p-2 text-right">Actions</th></tr></thead><tbody className="divide-y divide-border">
                {adminUsers.map((user) => <tr key={user.id}><td className="p-2"><div className="font-semibold text-foreground">{user.fullName}</div><div className="text-text-secondary">{user.email}</div></td><td className="p-2"><select aria-label={`Role for ${user.email}`} value={user.role} disabled={adminAction === `role-${user.id}`} onChange={(e) => updateUserRole(user, e.target.value)} className="p-1.5 rounded bg-canvas border border-border text-foreground"><option value="admin">Admin</option><option value="moderator">Moderator</option><option value="author">Author</option><option value="reader">Reader</option></select>{confirmingAction?.startsWith(`role-${user.id}-`) && <div className="text-[10px] text-status-warning mt-1">Select again to confirm</div>}</td><td className="p-2"><span className={`px-2 py-1 rounded text-[10px] font-bold ${user.isActive ? 'bg-status-success/10 text-status-success' : 'bg-status-danger/10 text-status-danger'}`}>{user.isActive ? 'Active' : 'Inactive'}</span></td><td className="p-2 text-text-secondary">{user.ssoProvider || 'Local'}</td><td className="p-2 text-right"><button disabled={adminAction === `status-${user.id}`} onClick={() => updateUserStatus(user)} className="px-2 py-1 rounded border border-border text-text-secondary hover:text-foreground disabled:opacity-50">{confirmingAction === `status-${user.id}` ? 'Confirm?' : user.isActive ? 'Deactivate' : 'Activate'}</button></td></tr>)}
              </tbody></table></div>
            )}
          </div>
        </div>
      )}

      {/* PAT Token Inventory Tab Content */}
      {activeTab === 'pats' && (
        <div className="space-y-4">
          <div className="p-5 rounded-xl bg-surface border border-border shadow-sm space-y-4">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-bold text-foreground">Personal Access Tokens (PAT) Inventory</h2><p className="text-xs text-text-secondary mt-0.5">Enterprise-wide token ownership, scopes, usage, and revocation controls.</p></div><button onClick={fetchPats} disabled={adminLoading} className="p-2 rounded-lg border border-border text-text-secondary hover:text-foreground disabled:opacity-50" aria-label="Refresh PAT inventory"><RefreshCw className={`w-4 h-4 ${adminLoading ? 'animate-spin' : ''}`} /></button></div>
            <div className="flex flex-wrap gap-2"><input aria-label="Search PATs" value={patSearch} onChange={(e) => setPatSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fetchPats()} placeholder="Search token or owner" className="p-2 rounded-lg bg-canvas border border-border text-foreground text-xs flex-1 min-w-48" /><select aria-label="Filter PATs by status" value={patStatus} onChange={(e) => setPatStatus(e.target.value)} className="p-2 rounded-lg bg-canvas border border-border text-foreground text-xs"><option value="all">All tokens</option><option value="active">Active</option><option value="expired">Expired</option><option value="revoked">Revoked</option></select><button onClick={fetchPats} className="px-3 py-2 rounded-lg bg-accent text-white text-xs font-semibold">Apply filters</button></div>
            {adminError && <div role="alert" className="p-3 rounded-lg bg-status-danger/10 border border-status-danger/30 text-status-danger text-xs">{adminError}</div>}
            {adminLoading ? <div className="py-8 text-center text-xs text-text-secondary"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading PAT inventory...</div> : adminPats.length === 0 ? <p className="py-8 text-center text-xs text-text-muted italic">No tokens match these filters.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-text-muted border-b border-border"><th className="p-2">Token / Owner</th><th className="p-2">Scopes</th><th className="p-2">Last used</th><th className="p-2">Expires</th><th className="p-2 text-right">Action</th></tr></thead><tbody className="divide-y divide-border">{adminPats.map((pat) => <tr key={pat.id} className={pat.revokedAt ? 'opacity-60' : ''}><td className="p-2"><div className="font-semibold text-foreground">{pat.name}</div><div className="text-text-secondary">{pat.userFullName} · {pat.userEmail}</div></td><td className="p-2"><div className="flex flex-wrap gap-1">{pat.scopes.map((scope) => <span key={scope} className="px-1.5 py-0.5 rounded bg-canvas border border-border font-mono text-[10px]">{scope}</span>)}</div></td><td className="p-2 text-text-secondary">{formatDate(pat.lastUsedAt)}</td><td className="p-2 text-text-secondary">{pat.expiresAt ? formatDate(pat.expiresAt) : 'Never'}</td><td className="p-2 text-right">{pat.revokedAt ? <span className="text-status-danger font-semibold">Revoked</span> : <button disabled={adminAction === `pat-${pat.id}`} onClick={() => revokeAdminPat(pat)} className="px-2 py-1 rounded border border-status-danger/40 text-status-danger hover:bg-status-danger/10 disabled:opacity-50">{confirmingAction === `pat-${pat.id}` ? 'Confirm revoke?' : 'Revoke'}</button>}</td></tr>)}</tbody></table></div>
            )}
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
