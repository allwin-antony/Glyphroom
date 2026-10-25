import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Layers,
  Users,
  FileText,
  PlusCircle,
  Settings,
  Shield,
  UserPlus,
  Trash2,
  Lock,
  Globe,
  Clock,
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Mail,
} from 'lucide-react';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../components/ui/dialog.js';

export interface SpaceMember {
  spaceId: string;
  userId: string;
  role: 'viewer' | 'reviewer' | 'author' | 'maintainer' | 'owner';
  fullName: string;
  email: string;
  globalRole: string;
}

export interface SpacePost {
  id: string;
  slug: string;
  title: string;
  status: string;
  visibility: 'space' | 'invited_only';
  isPromoted: boolean;
  authorName?: string;
  createdAt: string;
  updatedAt: string;
}

export const SpaceView: React.FC = () => {
  const { idOrSlug } = useParams<{ idOrSlug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [space, setSpace] = useState<any>(null);
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [posts, setPosts] = useState<SpacePost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'pages' | 'members' | 'settings'>('pages');

  // Add member modal
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [inviteMode, setInviteMode] = useState<'directory' | 'manual'>('directory');
  const [manualEmail, setManualEmail] = useState('');
  const [isLoadingDirectory, setIsLoadingDirectory] = useState(false);
  const [allUsers, setAllUsers] = useState<Array<{ id: string; email: string; fullName: string }>>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<'viewer' | 'reviewer' | 'author' | 'maintainer'>('author');
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [memberActionError, setMemberActionError] = useState<string | null>(null);

  const fetchSpaceDetails = async () => {
    if (!idOrSlug) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<{ space: any }>(`/spaces/${idOrSlug}`);
      setSpace(res.space);

      // Fetch space members
      if (res.space?.isMember || user?.role === 'admin') {
        const memRes = await api.get<{ members: SpaceMember[] }>(`/spaces/${res.space.id}/members`);
        setMembers(memRes.members || []);
      }

      // Fetch posts for this space
      const postsRes = await api.get<{ posts: SpacePost[] }>('/posts');
      const spacePages = (postsRes.posts || []).filter((p: any) => p.spaceId === res.space.id);
      setPosts(spacePages);
    } catch (err: any) {
      console.error('Failed to load space:', err);
      setError(err.message || 'Unable to load Space details.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSpaceDetails();
  }, [idOrSlug]);

  const handleOpenAddMember = async () => {
    setIsAddMemberOpen(true);
    setMemberActionError(null);
    setIsLoadingDirectory(true);
    try {
      let usersList: any[] = [];
      try {
        const res = await api.get<{ users: any[] }>('/spaces/directory/users');
        usersList = res.users || [];
      } catch {
        try {
          const res = await api.get<{ users: any[] }>('/collaborators/users');
          usersList = res.users || [];
        } catch {
          const res = await api.get<{ users: any[] }>('/posts/collaborators/users');
          usersList = res.users || [];
        }
      }
      setAllUsers(usersList);
      
      const memberIds = new Set(members.map((m) => m.userId));
      const available = usersList.filter((u) => !memberIds.has(u.id));
      if (available.length > 0) {
        setSelectedUserId(available[0].id);
      } else {
        setSelectedUserId('');
      }
    } catch (err: any) {
      console.error('Failed to load user directory:', err);
      setMemberActionError('Could not load corporate user directory.');
    } finally {
      setIsLoadingDirectory(false);
    }
  };

  const handleAddMemberSubmit = async () => {
    if (!space) return;
    setIsAddingMember(true);
    setMemberActionError(null);
    try {
      if (inviteMode === 'directory') {
        if (!selectedUserId) {
          setMemberActionError('Please select a user from the directory or switch to invite by email.');
          setIsAddingMember(false);
          return;
        }
        await api.post(`/spaces/${space.id}/members`, {
          userId: selectedUserId,
          role: selectedRole,
        });
      } else {
        if (!manualEmail.trim()) {
          setMemberActionError('Please enter a valid corporate email address.');
          setIsAddingMember(false);
          return;
        }
        await api.post(`/spaces/${space.id}/members`, {
          email: manualEmail.trim(),
          role: selectedRole,
        });
      }
      setIsAddMemberOpen(false);
      setManualEmail('');
      fetchSpaceDetails();
    } catch (err: any) {
      setMemberActionError(err.message || 'Failed to add member.');
    } finally {
      setIsAddingMember(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!space) return;
    try {
      await api.delete(`/spaces/${space.id}/members/${userId}`);
      fetchSpaceDetails();
    } catch (err: any) {
      alert(err.message || 'Failed to remove member.');
    }
  };

  const canManageMembers =
    user?.role === 'admin' || space?.userRole === 'owner' || space?.userRole === 'maintainer';

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
        <p className="text-xs text-text-muted">Loading Space...</p>
      </div>
    );
  }

  if (error || !space) {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center space-y-4">
        <AlertCircle className="w-12 h-12 text-status-danger mx-auto" />
        <h2 className="text-lg font-bold text-foreground">Space Not Accessible</h2>
        <p className="text-xs text-text-secondary">{error || 'This space does not exist or you lack membership.'}</p>
        <button
          onClick={() => navigate('/catalog')}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-xs font-semibold"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Company Library</span>
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Space Hero Banner */}
      <div className="p-6 rounded-2xl bg-surface border border-border shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-accent-bg text-accent border border-accent/20">
                <Layers className="w-5 h-5" />
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight text-foreground">{space.name}</h1>
              {space.userRole && (
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-accent text-white tracking-wider">
                  {space.userRole}
                </span>
              )}
            </div>
            <p className="text-xs text-text-secondary max-w-2xl mt-1">
              {space.description || 'Dedicated collaborative team workspace for project documentation and status updates.'}
            </p>
          </div>

          {/* Action CTAs */}
          <div className="flex items-center gap-2">
            <Link
              to={`/posts/new?spaceId=${space.id}`}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-accent text-white text-xs font-semibold shadow-xs hover:opacity-90 transition-all"
            >
              <PlusCircle className="w-4 h-4" />
              <span>New Page in Space</span>
            </Link>
          </div>
        </div>

        {/* Space Meta Stat Chips */}
        <div className="flex items-center gap-6 pt-3 border-t border-border text-xs text-text-secondary">
          <div className="flex items-center gap-1.5">
            <Users className="w-4 h-4 text-text-muted" />
            <span>{members.length} Space Members</span>
          </div>
          <div className="flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-text-muted" />
            <span>{posts.length} Documentation Pages</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Globe className="w-4 h-4 text-emerald-500" />
            <span>{posts.filter((p) => p.isPromoted).length} Promoted to Company</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border gap-6">
        {[
          { id: 'pages', label: 'Pages & Documentation', icon: FileText, count: posts.length },
          { id: 'members', label: 'Team Members & Roles', icon: Users, count: members.length },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 pb-3 px-1 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-muted hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-surface border border-border text-text-muted">
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tab: Pages List */}
      {activeTab === 'pages' && (
        <div className="space-y-3">
          {posts.length === 0 ? (
            <div className="p-12 text-center rounded-xl bg-surface border border-border text-xs text-text-muted space-y-3">
              <FileText className="w-8 h-8 mx-auto text-text-muted opacity-50" />
              <p>No documentation pages created in this space yet.</p>
              <Link
                to={`/posts/new?spaceId=${space.id}`}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Create First Page</span>
              </Link>
            </div>
          ) : (
            posts.map((p) => (
              <div
                key={p.id}
                className="p-4 rounded-xl bg-surface border border-border hover:border-accent/40 shadow-xs transition-all flex items-center justify-between gap-4"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      to={`/posts/${p.slug}`}
                      className="font-bold text-sm text-foreground hover:text-accent transition-colors truncate"
                    >
                      {p.title}
                    </Link>
                    {p.isPromoted && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                        <Globe className="w-3 h-3" />
                        <span>Company Library</span>
                      </span>
                    )}
                    {p.visibility === 'invited_only' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                        <Lock className="w-3 h-3" />
                        <span>Invited Only</span>
                      </span>
                    )}
                    <span className="text-[10px] px-2 py-0.5 rounded-md font-semibold bg-canvas border border-border text-text-muted uppercase">
                      {p.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-text-muted flex items-center gap-3">
                    {p.authorName && <span>By {p.authorName}</span>}
                    <span>•</span>
                    <span>Updated {new Date(p.updatedAt || p.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    to={`/posts/${p.id}/edit`}
                    className="px-3 py-1.5 rounded-lg border border-border bg-canvas text-text-secondary hover:text-foreground text-xs font-medium"
                  >
                    Edit
                  </Link>
                  <Link
                    to={`/posts/${p.slug}`}
                    className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium shadow-xs"
                  >
                    Read
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: Members Directory */}
      {activeTab === 'members' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-foreground">Space Members</h2>
              <p className="text-xs text-text-secondary">
                Collaborators with roles assigned directly to this space.
              </p>
            </div>
            {canManageMembers && (
              <button
                onClick={handleOpenAddMember}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold shadow-xs"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Add Member</span>
              </button>
            )}
          </div>

          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-canvas border-b border-border text-text-muted uppercase text-[10px] font-bold">
                <tr>
                  <th className="py-2.5 px-4">Member</th>
                  <th className="py-2.5 px-4">Space Role</th>
                  <th className="py-2.5 px-4">Permissions</th>
                  {canManageMembers && <th className="py-2.5 px-4 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.map((m) => (
                  <tr key={m.userId} className="hover:bg-canvas/50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-foreground">{m.fullName}</div>
                      <div className="text-[11px] text-text-muted">{m.email}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-bold capitalize bg-accent-bg text-accent border border-accent/20">
                        {m.role}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-text-secondary">
                      {m.role === 'owner' || m.role === 'maintainer' ? (
                        <span>Manage all pages, members & promote to company</span>
                      ) : m.role === 'author' ? (
                        <span>Create & edit pages in space</span>
                      ) : m.role === 'reviewer' ? (
                        <span>Read, comment & review pages</span>
                      ) : (
                        <span>Read pages in space</span>
                      )}
                    </td>
                    {canManageMembers && (
                      <td className="py-3 px-4 text-right">
                        {m.role !== 'owner' && (
                          <button
                            onClick={() => handleRemoveMember(m.userId)}
                            className="p-1 rounded-md text-text-muted hover:text-status-danger hover:bg-status-danger/10 transition-colors"
                            title="Remove member"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Member Dialog */}
      <Dialog open={isAddMemberOpen} onOpenChange={setIsAddMemberOpen}>
        <DialogContent className="sm:max-w-md bg-surface text-foreground border border-border">
          <DialogHeader>
            <DialogTitle>Add Space Member</DialogTitle>
            <DialogDescription className="text-text-secondary text-xs">
              Invite a user from the corporate directory into {space.name}.
            </DialogDescription>
          </DialogHeader>

          {memberActionError && (
            <div className="p-3 rounded-lg bg-status-danger/10 border border-status-danger/30 text-status-danger text-xs">
              {memberActionError}
            </div>
          )}

          {/* Toggle between directory dropdown & email input */}
          <div className="flex border-b border-border mt-1 mb-2 text-xs">
            <button
              type="button"
              onClick={() => { setInviteMode('directory'); setMemberActionError(null); }}
              className={`pb-2 px-3 font-semibold transition-colors flex items-center gap-1.5 border-b-2 ${
                inviteMode === 'directory'
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-muted hover:text-foreground'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Select from Directory</span>
            </button>
            <button
              type="button"
              onClick={() => { setInviteMode('manual'); setMemberActionError(null); }}
              className={`pb-2 px-3 font-semibold transition-colors flex items-center gap-1.5 border-b-2 ${
                inviteMode === 'manual'
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-muted hover:text-foreground'
              }`}
            >
              <Mail className="w-3.5 h-3.5" />
              <span>Invite by Email</span>
            </button>
          </div>

          <div className="space-y-4 py-2 text-xs">
            {inviteMode === 'directory' ? (
              <div>
                <label className="block font-semibold mb-1">User from Directory</label>
                {isLoadingDirectory ? (
                  <div className="py-3 px-3 bg-canvas border border-border rounded-lg text-text-muted flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                    <span>Loading corporate directory...</span>
                  </div>
                ) : (
                  (() => {
                    const memberUserIds = new Set(members.map((m) => m.userId));
                    const availableDirectoryUsers = allUsers.filter((u) => !memberUserIds.has(u.id));
                    return availableDirectoryUsers.length > 0 ? (
                      <select
                        value={selectedUserId}
                        onChange={(e) => setSelectedUserId(e.target.value)}
                        className="w-full p-2 rounded-lg bg-canvas border border-border text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                      >
                        {availableDirectoryUsers.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.fullName} ({u.email})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="p-3 bg-canvas border border-border rounded-lg text-text-muted leading-relaxed">
                        {allUsers.length > 0 ? (
                          <span>All directory users are already members of this Space. You can use <strong>Invite by Email</strong> to invite another user.</span>
                        ) : (
                          <span>No directory users found. You can use <strong>Invite by Email</strong> to invite directly.</span>
                        )}
                      </div>
                    );
                  })()
                )}
              </div>
            ) : (
              <div>
                <label className="block font-semibold mb-1">Corporate Email Address</label>
                <input
                  type="email"
                  placeholder="name@company.com"
                  value={manualEmail}
                  onChange={(e) => setManualEmail(e.target.value)}
                  className="w-full p-2 rounded-lg bg-canvas border border-border text-foreground placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            )}

            <div>
              <label className="block font-semibold mb-1">Space Role</label>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as any)}
                className="w-full p-2 rounded-lg bg-canvas border border-border text-foreground"
              >
                <option value="viewer">Viewer — Read pages only</option>
                <option value="reviewer">Reviewer — Read, comment & review</option>
                <option value="author">Author — Create & edit pages</option>
                <option value="maintainer">Maintainer — Manage pages, members & promotions</option>
              </select>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <button
              onClick={() => setIsAddMemberOpen(false)}
              className="px-3 py-1.5 rounded-lg border border-border text-xs"
            >
              Cancel
            </button>
            <button
              onClick={handleAddMemberSubmit}
              disabled={isAddingMember}
              className="px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold disabled:opacity-50"
            >
              {isAddingMember ? 'Adding...' : 'Add Member'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
