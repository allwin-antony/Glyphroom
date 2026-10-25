import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Settings, 
  Save, 
  Loader2, 
  AlertCircle, 
  Check, 
  Sparkles, 
  X, 
  Plus, 
  Users, 
  UserPlus, 
  Trash2, 
  HelpCircle, 
  ShieldCheck, 
  Edit3, 
  Eye,
  Globe,
  Layers,
  Lock,
} from 'lucide-react';
import { api, ApiError } from '../../../lib/api.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../ui/dialog.js';

export interface PostSettingsTabProps {
  postId: string;
  postMetadata?: {
    id: string;
    title: string;
    slug: string;
    excerpt?: string | null;
    coeId?: string | null;
    spaceId?: string | null;
    visibility?: 'space' | 'invited_only';
    isPromoted?: boolean;
    status: string;
  };
  onMetadataUpdate?: (metadata: any) => void;
}

export interface CollaboratorItem {
  userId: string;
  permission: 'edit' | 'review' | 'view';
  fullName?: string;
  email: string;
  role: string;
}

export const PostSettingsTab: React.FC<PostSettingsTabProps> = ({
  postId,
  postMetadata,
  onMetadataUpdate,
}) => {
  const navigate = useNavigate();
  const [title, setTitle] = useState(postMetadata?.title || '');
  const [slug, setSlug] = useState(postMetadata?.slug || '');
  const [excerpt, setExcerpt] = useState(postMetadata?.excerpt || '');
  const [coeId, setCoeId] = useState(postMetadata?.coeId || '');
  const [spaceId, setSpaceId] = useState(postMetadata?.spaceId || '');
  const [visibility, setVisibility] = useState<'space' | 'invited_only'>(postMetadata?.visibility || 'space');
  const [isPromoted, setIsPromoted] = useState(postMetadata?.isPromoted || false);
  const [spacesOptions, setSpacesOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [promotionLoading, setPromotionLoading] = useState(false);
  const [promotionError, setPromotionError] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>(['engineering', 'collaborative']);
  const [tagInput, setTagInput] = useState('');

  // Delete document state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeletePost = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`/posts/${postId}`);
      navigate('/my-work', { replace: true });
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete post. Author or admin permission required.');
      setIsDeleting(false);
    }
  };

  // Dynamic COEs from backend
  const [coeOptions, setCoeOptions] = useState<Array<{ id: string; label: string }>>([
    { id: '', label: 'None (General Publishing)' },
  ]);

  // Collaborators state
  const [collaborators, setCollaborators] = useState<CollaboratorItem[]>([]);
  const [availableUsers, setAvailableUsers] = useState<Array<{ id: string; email: string; fullName: string }>>([]);
  const [selectedUserEmail, setSelectedUserEmail] = useState('');
  const [collaboratorRole, setCollaboratorRole] = useState<'edit' | 'review' | 'view'>('edit');
  const [isAddingCollab, setIsAddingCollab] = useState(false);
  const [collabError, setCollabError] = useState<string | null>(null);
  const [collabSuccess, setCollabSuccess] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 1. Fetch COEs and Spaces on mount
  useEffect(() => {
    async function fetchCoesAndSpaces() {
      try {
        const res = await api.get<{ coes: Array<{ id: string; name: string; code: string }> }>('/posts/coe');
        if (res?.coes && res.coes.length > 0) {
          setCoeOptions([
            { id: '', label: 'None (General Publishing)' },
            ...res.coes.map((c) => ({ id: c.id, label: c.name })),
          ]);
        }
      } catch (err) {
        console.warn('Failed to load COEs:', err);
      }

      try {
        const spacesRes = await api.get<{ spaces: Array<{ id: string; name: string }> }>('/spaces');
        setSpacesOptions(spacesRes?.spaces || []);
      } catch (err) {
        console.warn('Failed to load spaces:', err);
      }
    }
    fetchCoesAndSpaces();
  }, []);

  // 2. Fetch Collaborators & Available Users
  const fetchCollaborators = useCallback(async () => {
    try {
      const res = await api.get<{ collaborators: CollaboratorItem[] }>(`/posts/${postId}/collaborators`);
      setCollaborators(res?.collaborators || []);
    } catch (err) {
      console.warn('Failed to load collaborators:', err);
    }
  }, [postId]);

  const fetchAvailableUsers = useCallback(async () => {
    try {
      const res = await api.get<{ users: Array<{ id: string; email: string; fullName: string }> }>('/posts/collaborators/users');
      setAvailableUsers(res?.users || []);
    } catch (err) {
      console.warn('Failed to load available users:', err);
    }
  }, []);

  useEffect(() => {
    if (postId) {
      fetchCollaborators();
      fetchAvailableUsers();
    }
  }, [postId, fetchCollaborators, fetchAvailableUsers]);

  // Sync with prop updates
  useEffect(() => {
    if (postMetadata) {
      setTitle(postMetadata.title || '');
      setSlug(postMetadata.slug || '');
      setExcerpt(postMetadata.excerpt || '');
      setCoeId(postMetadata.coeId || '');
      setSpaceId(postMetadata.spaceId || '');
      setVisibility(postMetadata.visibility || 'space');
      setIsPromoted(Boolean(postMetadata.isPromoted));
    }
  }, [postMetadata]);

  // Generate slug from title
  const handleGenerateSlug = () => {
    const generated = title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
    if (generated) {
      setSlug(generated);
    }
  };

  const handleAddTag = (e: React.KeyboardEvent | React.MouseEvent) => {
    if ('key' in e && e.key !== 'Enter') return;
    e.preventDefault();
    const clean = tagInput.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (clean && !tags.includes(clean)) {
      setTags([...tags, clean]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  // Check if form is dirty
  const isDirty =
    title !== (postMetadata?.title || '') ||
    slug !== (postMetadata?.slug || '') ||
    excerpt !== (postMetadata?.excerpt || '') ||
    coeId !== (postMetadata?.coeId || '') ||
    spaceId !== (postMetadata?.spaceId || '') ||
    visibility !== (postMetadata?.visibility || 'space');

  const handlePromoteToCompany = async () => {
    setPromotionLoading(true);
    setPromotionError(null);
    try {
      await api.post(`/posts/${postId}/promote`);
      setIsPromoted(true);
      onMetadataUpdate?.({ ...postMetadata, isPromoted: true });
    } catch (err: any) {
      setPromotionError(err.message || 'Failed to promote post to Company Library.');
    } finally {
      setPromotionLoading(false);
    }
  };

  const handleDemoteFromCompany = async () => {
    setPromotionLoading(true);
    setPromotionError(null);
    try {
      await api.post(`/posts/${postId}/demote`);
      setIsPromoted(false);
      onMetadataUpdate?.({ ...postMetadata, isPromoted: false });
    } catch (err: any) {
      setPromotionError(err.message || 'Failed to withdraw post.');
    } finally {
      setPromotionLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !slug.trim() || isSaving) return;

    // Validate slug regex
    if (!/^[a-z0-9-]+$/.test(slug)) {
      setErrorMessage('Slug must contain only lowercase letters, numbers, and hyphens.');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setSaveSuccess(false);

    try {
      const payload: any = {
        title: title.trim(),
        slug: slug.trim(),
        excerpt: excerpt.trim() || undefined,
        coeId: coeId || null,
        spaceId: spaceId || null,
        visibility,
      };

      const res = await api.patch<{ post: any }>(`/posts/${postId}`, payload);
      if (res?.post) {
        onMetadataUpdate?.(res.post);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        setErrorMessage('This slug is already in use by another post.');
      } else {
        setErrorMessage(err?.message || 'Failed to update post settings.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Add collaborator handler
  const handleAddCollaborator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserEmail.trim() || isAddingCollab) return;

    setIsAddingCollab(true);
    setCollabError(null);
    setCollabSuccess(null);

    try {
      await api.post(`/posts/${postId}/collaborators`, {
        email: selectedUserEmail.trim(),
        permission: collaboratorRole,
      });
      setCollabSuccess(`Added collaborator with ${collaboratorRole} access.`);
      setSelectedUserEmail('');
      await fetchCollaborators();
      setTimeout(() => setCollabSuccess(null), 3000);
    } catch (err: any) {
      setCollabError(err?.message || 'Failed to add collaborator.');
    } finally {
      setIsAddingCollab(false);
    }
  };

  // Remove collaborator handler
  const handleRemoveCollaborator = async (userId: string) => {
    try {
      await api.delete(`/posts/${postId}/collaborators/${userId}`);
      await fetchCollaborators();
    } catch (err: any) {
      setCollabError(err?.message || 'Failed to remove collaborator.');
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface text-foreground overflow-y-auto">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between bg-surface-muted/30 sticky top-0 z-10">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Settings className="w-4 h-4 text-text-secondary" />
          <span>Post Settings & Co-Authors</span>
        </div>

        {saveSuccess && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-status-success animate-in fade-in-50">
            <Check className="w-3.5 h-3.5" />
            <span>Saved</span>
          </span>
        )}
      </div>

      <div className="p-4 space-y-6 text-xs">
        {/* Settings Form */}
        <form onSubmit={handleSave} className="space-y-4">
          {errorMessage && (
            <div className="p-2.5 rounded-lg bg-status-danger/10 border border-status-danger/30 text-status-danger text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Title Field */}
          <div className="space-y-1.5">
            <label className="font-semibold text-foreground">Post Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={500}
              className="w-full px-3 py-1.5 rounded-lg bg-canvas border border-border focus:outline-none focus:border-accent text-foreground text-xs"
              placeholder="Enter post title..."
            />
          </div>

          {/* Slug Field with Purpose Explanation */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <label className="font-semibold text-foreground">URL Slug</label>
                <div 
                  className="text-text-muted cursor-help" 
                  title="A URL slug is the human-readable web address (permalink) for your post, like /posts/distributed-systems instead of an obscure ID. It makes articles easy to share, read, and bookmark."
                >
                  <HelpCircle className="w-3 h-3" />
                </div>
              </div>
              <button
                type="button"
                onClick={handleGenerateSlug}
                className="text-[10px] text-accent hover:underline inline-flex items-center gap-1 font-medium"
              >
                <Sparkles className="w-2.5 h-2.5" />
                <span>Slugify Title</span>
              </button>
            </div>
            <div className="flex items-center rounded-lg bg-canvas border border-border px-3 py-1.5 focus-within:border-accent">
              <span className="text-text-muted select-none text-[11px]">/posts/</span>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                required
                maxLength={255}
                className="w-full bg-transparent border-none text-xs text-foreground focus:outline-none pl-0.5"
                placeholder="clean-article-slug"
              />
            </div>
            <p className="text-[10px] text-text-muted">
              Used in permanent web links and catalog routing. Use lowercase letters, numbers, and hyphens.
            </p>
          </div>

          {/* Excerpt Field */}
          <div className="space-y-1.5">
            <label className="font-semibold text-foreground">Excerpt / Abstract</label>
            <textarea
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              rows={3}
              className="w-full px-3 py-1.5 rounded-lg bg-canvas border border-border focus:outline-none focus:border-accent text-foreground text-xs resize-none placeholder:text-text-muted"
              placeholder="A concise summary for catalog cards, search listings, and reading previews..."
            />
          </div>

          {/* Center of Excellence (COE) with Explanation */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <label className="font-semibold text-foreground">Center of Excellence (COE)</label>
              <div 
                className="text-text-muted cursor-help"
                title="Centers of Excellence group enterprise engineering knowledge by domain (e.g., Architecture, Security, DevOps) for cross-team indexing and governance."
              >
                <HelpCircle className="w-3 h-3" />
              </div>
            </div>
            <select
              value={coeId}
              onChange={(e) => setCoeId(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-canvas border border-border focus:outline-none focus:border-accent text-foreground text-xs cursor-pointer"
            >
              {coeOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Team Space Association */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <label className="font-semibold text-foreground">Team Space</label>
              <div 
                className="text-text-muted cursor-help"
                title="Spaces partition documents to team members with dedicated roles (Viewer, Reviewer, Author, Maintainer, Owner)."
              >
                <Layers className="w-3 h-3" />
              </div>
            </div>
            <select
              value={spaceId}
              onChange={(e) => setSpaceId(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg bg-canvas border border-border focus:outline-none focus:border-accent text-foreground text-xs cursor-pointer"
            >
              <option value="">None (Independent / Personal Document)</option>
              {spacesOptions.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name}
                </option>
              ))}
            </select>
          </div>

          {/* Page Visibility Setting */}
          {spaceId && (
            <div className="space-y-1.5">
              <label className="font-semibold text-foreground">Page Visibility inside Space</label>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as any)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-canvas border border-border focus:outline-none focus:border-accent text-foreground text-xs cursor-pointer"
              >
                <option value="space">Space — Visible to all space members per their role</option>
                <option value="invited_only">Invited Only — Restricted to Maintainers & Page Guests</option>
              </select>
            </div>
          )}

          {/* Tags Chips */}
          <div className="space-y-1.5">
            <label className="font-semibold text-foreground">Tags</label>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-canvas border border-border text-[11px] text-foreground font-medium"
                >
                  <span>#{tag}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="p-0.5 rounded-full hover:bg-elevated text-text-muted hover:text-foreground"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleAddTag}
                placeholder="Add tag and press Enter..."
                className="flex-1 px-3 py-1 rounded-lg bg-canvas border border-border focus:outline-none focus:border-accent text-foreground text-xs"
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="px-2.5 py-1 rounded-lg border border-border bg-elevated hover:bg-canvas text-foreground text-xs font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Save Changes Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={!isDirty || isSaving}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent text-white font-semibold text-xs hover:opacity-90 transition-all disabled:opacity-50 shadow-xs cursor-pointer"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving Changes...</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Post Settings</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* ======================================================== */}
        {/* Company Library Promotion Governance Section */}
        {/* ======================================================== */}
        <div className="border-t border-border pt-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-emerald-500" />
              <h4 className="font-semibold text-xs text-foreground">Company Library Promotion</h4>
            </div>
            {isPromoted ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                Promoted
              </span>
            ) : (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface border border-border text-text-muted">
                Team Only
              </span>
            )}
          </div>

          <p className="text-[11px] text-text-secondary leading-relaxed">
            {spaceId
              ? 'Promoting publishes this document to the company-wide Company Library and search. Authors cannot self-promote team space pages; a Space Maintainer or Owner must promote.'
              : 'Independent personal documents can be directly promoted to the company library once vetted.'}
          </p>

          {promotionError && (
            <div className="p-2.5 rounded-lg bg-status-danger/10 border border-status-danger/30 text-status-danger text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{promotionError}</span>
            </div>
          )}

          {isPromoted ? (
            <button
              type="button"
              onClick={handleDemoteFromCompany}
              disabled={promotionLoading}
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-canvas hover:bg-elevated text-text-secondary hover:text-foreground text-xs font-semibold disabled:opacity-50"
            >
              {promotionLoading ? 'Updating...' : 'Withdraw to Team Space'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePromoteToCompany}
              disabled={promotionLoading}
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50 shadow-xs"
            >
              {promotionLoading ? 'Promoting...' : 'Promote to Company Library'}
            </button>
          )}
        </div>

        {/* ======================================================== */}
        {/* Collaborators & Co-Authors Section */}
        {/* ======================================================== */}
        <div className="border-t border-border pt-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-accent" />
              <h4 className="font-semibold text-xs text-foreground">Collaborators & Co-Authors</h4>
            </div>
            <span className="text-[10px] text-text-muted">
              {collaborators.length} {collaborators.length === 1 ? 'collaborator' : 'collaborators'}
            </span>
          </div>

          <p className="text-[11px] text-text-secondary leading-relaxed">
            Invite teammates to co-author this post. Collaborators can open this document, write simultaneously in real time, see each other's live carets, and propose suggestions.
          </p>

          {collabError && (
            <div className="p-2.5 rounded-lg bg-status-danger/10 border border-status-danger/30 text-status-danger text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{collabError}</span>
            </div>
          )}

          {collabSuccess && (
            <div className="p-2.5 rounded-lg bg-status-success/10 border border-status-success/30 text-status-success text-xs flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>{collabSuccess}</span>
            </div>
          )}

          {/* Active Collaborators List */}
          <div className="space-y-2">
            {collaborators.length === 0 ? (
              <div className="p-3 rounded-lg border border-dashed border-border bg-canvas text-center text-text-muted text-[11px]">
                No external collaborators invited yet. Only you have edit access.
              </div>
            ) : (
              collaborators.map((c) => (
                <div
                  key={c.userId}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-canvas border border-border shadow-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-accent-bg border border-accent/20 flex items-center justify-center font-bold text-xs text-accent shrink-0">
                      {(c.fullName || c.email)[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-xs text-foreground truncate">
                        {c.fullName || c.email}
                      </div>
                      <div className="text-[10px] text-text-muted truncate">
                        {c.email}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span 
                      className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                        c.permission === 'edit'
                          ? 'bg-status-success/10 text-status-success border-status-success/30'
                          : c.permission === 'review'
                          ? 'bg-status-warning/10 text-status-warning border-status-warning/30'
                          : 'bg-canvas text-text-secondary border-border'
                      }`}
                    >
                      {c.permission === 'edit' && <Edit3 className="w-2.5 h-2.5" />}
                      {c.permission === 'review' && <ShieldCheck className="w-2.5 h-2.5" />}
                      {c.permission === 'view' && <Eye className="w-2.5 h-2.5" />}
                      <span className="capitalize">{c.permission}</span>
                    </span>

                    <button
                      type="button"
                      onClick={() => handleRemoveCollaborator(c.userId)}
                      className="p-1 rounded-md text-text-muted hover:text-status-danger hover:bg-elevated transition-colors"
                      title="Remove collaborator"
                      aria-label="Remove collaborator"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Add Collaborator Form */}
          <form onSubmit={handleAddCollaborator} className="space-y-2 pt-2 border-t border-border">
            <label className="font-semibold text-xs text-foreground flex items-center gap-1.5">
              <UserPlus className="w-3.5 h-3.5 text-accent" />
              <span>Invite Teammate</span>
            </label>

            <div className="space-y-2">
              {/* Quick Select Teammate from Enterprise Directory */}
              {availableUsers.length > 0 && (
                <div className="flex gap-1.5">
                  <select
                    value={selectedUserEmail}
                    onChange={(e) => setSelectedUserEmail(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-canvas border border-border text-xs text-foreground focus:outline-none focus:border-accent"
                  >
                    <option value="">Select from organization directory...</option>
                    {availableUsers.map((u) => (
                      <option key={u.id} value={u.email}>
                        {u.fullName} ({u.email})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Or manual email typing */}
              <div className="flex gap-2">
                <input
                  type="email"
                  value={selectedUserEmail}
                  onChange={(e) => setSelectedUserEmail(e.target.value)}
                  placeholder="Or enter teammate's corporate email..."
                  className="flex-1 px-3 py-1.5 rounded-lg bg-canvas border border-border text-xs text-foreground focus:outline-none focus:border-accent"
                />
                <select
                  value={collaboratorRole}
                  onChange={(e) => setCollaboratorRole(e.target.value as any)}
                  className="px-2 py-1.5 rounded-lg bg-canvas border border-border text-xs text-foreground focus:outline-none focus:border-accent"
                >
                  <option value="edit">Editor (Co-write)</option>
                  <option value="review">Reviewer (Suggest)</option>
                  <option value="view">Viewer (Read-only)</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={!selectedUserEmail.trim() || isAddingCollab}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-elevated border border-border hover:bg-canvas text-foreground font-semibold text-xs transition-colors disabled:opacity-50"
              >
                {isAddingCollab ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Adding Collaborator...</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="w-3.5 h-3.5 text-accent" />
                    <span>Add as Collaborator</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Danger Zone: Post Deletion */}
        <div className="p-4 rounded-xl border border-status-danger/30 bg-status-danger/5 space-y-3">
          <div className="flex items-center gap-2 text-status-danger">
            <Trash2 className="w-4 h-4 shrink-0" />
            <h4 className="font-bold text-xs uppercase tracking-wider">Danger Zone</h4>
          </div>
          <p className="text-[11px] text-text-secondary leading-relaxed">
            Permanently delete this document, all historical revision snapshots, and file attachments. This action cannot be undone.
          </p>
          <button
            type="button"
            onClick={() => setIsDeleteDialogOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-status-danger text-white font-semibold text-xs hover:opacity-90 transition-opacity"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete This Document</span>
          </button>
        </div>

        {/* Delete Confirmation Dialog */}
        <Dialog open={isDeleteDialogOpen} onOpenChange={(open) => !open && setIsDeleteDialogOpen(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-status-danger">
                <Trash2 className="w-4 h-4" />
                <span>Delete Document</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-text-secondary mt-1">
                Are you sure you want to delete <strong className="text-foreground">{title || 'this post'}</strong>? This will permanently delete the post, all version history, and attachments. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>

            {deleteError && (
              <div className="p-3 rounded-lg bg-status-danger/10 text-status-danger border border-status-danger/30 text-xs">
                {deleteError}
              </div>
            )}

            <DialogFooter className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsDeleteDialogOpen(false)}
                disabled={isDeleting}
                className="px-3 py-1.5 rounded-lg border border-border bg-canvas text-xs font-semibold text-foreground hover:bg-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeletePost}
                disabled={isDeleting}
                className="px-3 py-1.5 rounded-lg bg-status-danger text-white text-xs font-semibold hover:opacity-90 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Confirm Delete</span>
                  </>
                )}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};
