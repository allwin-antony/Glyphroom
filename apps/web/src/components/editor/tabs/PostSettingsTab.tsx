import React, { useState, useEffect } from 'react';
import { 
  Settings, 
  Save, 
  Loader2, 
  AlertCircle, 
  Check, 
  Sparkles, 
  X, 
  Plus 
} from 'lucide-react';
import { api, ApiError } from '../../../lib/api.js';

export interface PostSettingsTabProps {
  postId: string;
  postMetadata?: {
    id: string;
    title: string;
    slug: string;
    excerpt?: string | null;
    coeId?: string | null;
    status: string;
  };
  onMetadataUpdate?: (metadata: any) => void;
}

const COE_OPTIONS = [
  { id: '', label: 'None (General)' },
  { id: 'coe-architecture', label: 'Architecture COE' },
  { id: 'coe-engineering', label: 'Engineering COE' },
  { id: 'coe-security', label: 'Security COE' },
  { id: 'coe-devops', label: 'DevOps & SRE COE' },
  { id: 'coe-product', label: 'Product & Design COE' },
];

export const PostSettingsTab: React.FC<PostSettingsTabProps> = ({
  postId,
  postMetadata,
  onMetadataUpdate,
}) => {
  const [title, setTitle] = useState(postMetadata?.title || '');
  const [slug, setSlug] = useState(postMetadata?.slug || '');
  const [excerpt, setExcerpt] = useState(postMetadata?.excerpt || '');
  const [coeId, setCoeId] = useState(postMetadata?.coeId || '');
  const [tags, setTags] = useState<string[]>(['engineering', 'collaborative']);
  const [tagInput, setTagInput] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync with prop updates
  useEffect(() => {
    if (postMetadata) {
      setTitle(postMetadata.title || '');
      setSlug(postMetadata.slug || '');
      setExcerpt(postMetadata.excerpt || '');
      setCoeId(postMetadata.coeId || '');
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
    coeId !== (postMetadata?.coeId || '');

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

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between bg-surface-muted/30">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
          <Settings className="w-4 h-4 text-text-secondary" />
          <span>Post Settings</span>
        </div>

        {saveSuccess && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-status-success animate-in fade-in-50">
            <Check className="w-3.5 h-3.5" />
            <span>Saved</span>
          </span>
        )}
      </div>

      {/* Settings Form */}
      <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
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

        {/* Slug Field */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="font-semibold text-foreground">URL Slug</label>
            <button
              type="button"
              onClick={handleGenerateSlug}
              className="text-[10px] text-accent hover:underline inline-flex items-center gap-1"
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
              placeholder="my-post-slug"
            />
          </div>
        </div>

        {/* Excerpt Field */}
        <div className="space-y-1.5">
          <label className="font-semibold text-foreground">Excerpt / Summary</label>
          <textarea
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            rows={3}
            className="w-full px-3 py-1.5 rounded-lg bg-canvas border border-border focus:outline-none focus:border-accent text-foreground text-xs resize-none placeholder:text-text-muted"
            placeholder="A brief summary for catalog cards and preview snippets..."
          />
        </div>

        {/* Center of Excellence Dropdown */}
        <div className="space-y-1.5">
          <label className="font-semibold text-foreground">Center of Excellence (COE)</label>
          <select
            value={coeId}
            onChange={(e) => setCoeId(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-lg bg-canvas border border-border focus:outline-none focus:border-accent text-foreground text-xs"
          >
            {COE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Tags Chips */}
        <div className="space-y-1.5">
          <label className="font-semibold text-foreground">Tags</label>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-elevated border border-border text-[11px] text-foreground font-medium"
              >
                <span>#{tag}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="p-0.5 rounded-full hover:bg-canvas text-text-muted hover:text-foreground"
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
              className="px-2.5 py-1 rounded-lg border border-border bg-elevated hover:bg-canvas text-foreground text-xs"
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
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-xs hover:opacity-90 transition-all disabled:opacity-50 shadow-xs"
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
    </div>
  );
};
