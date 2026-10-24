import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FileText, 
  ArrowLeft, 
  Sparkles, 
  ArrowRight, 
  Loader2, 
  AlertCircle, 
  RefreshCw 
} from 'lucide-react';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import { TEMPLATES } from '../components/editor/TemplatePickerDialog.js';

export const NewPostView: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [isProvisioning, setIsProvisioning] = useState(false);

  const handleSelectTemplate = async (templateId: string, templateTitle?: string) => {
    if (isProvisioning) return;
    setError(null);
    setSelectedTemplateId(templateId);
    setIsProvisioning(true);

    try {
      if (user?.role === 'reader') {
        throw new Error('Reader role does not have permission to create posts.');
      }

      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 7);
      const slugPrefix = templateId === 'blank' ? 'draft' : templateId.replace(/_/g, '-');
      const slug = `${slugPrefix}-${timestamp}-${randomSuffix}`;
      const title = templateTitle || (templateId === 'blank' ? 'Untitled Draft' : 'New Document');

      const res = await api.post<{ post: { id: string } }>('/posts', {
        title,
        slug,
        templateId: templateId === 'blank' ? undefined : templateId,
      });

      if (res?.post?.id) {
        navigate(`/posts/${res.post.id}/edit`, { replace: true });
      } else {
        throw new Error('Server returned invalid post data.');
      }
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 403) {
        setError('You do not have permission to create draft posts. Author, moderator, or admin role is required.');
      } else {
        setError(err?.message || 'Failed to provision draft post. Please try again.');
      }
      setIsProvisioning(false);
      setSelectedTemplateId(null);
    }
  };

  return (
    <div className="min-h-full bg-canvas text-foreground p-4 sm:p-8 max-w-5xl mx-auto">
      {/* Header bar */}
      <div className="flex items-center justify-between mb-8">
        <button
          onClick={() => navigate('/my-work')}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-surface text-text-secondary hover:text-foreground hover:bg-elevated transition-colors text-xs font-semibold"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to My Work</span>
        </button>

        <div className="inline-flex items-center gap-1.5 text-xs text-text-muted">
          <Sparkles className="w-3.5 h-3.5 text-accent" />
          <span>Enterprise Document Scaffolding</span>
        </div>
      </div>

      {/* Main hero title */}
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
          Create New Document or Status Post
        </h1>
        <p className="text-sm text-text-secondary mt-1.5 max-w-2xl leading-relaxed">
          Select an enterprise template pre-configured with status indicators, tables, and architecture diagrams, or start with a clean slate.
        </p>
      </div>

      {/* Error alert if provisioning fails */}
      {error && (
        <div className="p-4 rounded-xl bg-status-danger/10 border border-status-danger/30 text-status-danger mb-6 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <div className="font-bold">Provisioning Error</div>
            <div className="mt-0.5 text-text-secondary">{error}</div>
          </div>
          <button
            onClick={() => setError(null)}
            className="p-1 text-text-muted hover:text-foreground transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Primary Options Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* Blank Draft Card */}
        <div
          onClick={() => handleSelectTemplate('blank', 'Untitled Draft')}
          className={`group p-5 rounded-2xl border bg-surface transition-all cursor-pointer flex flex-col justify-between text-left relative overflow-hidden ${
            selectedTemplateId === 'blank'
              ? 'border-accent ring-2 ring-accent/30 shadow-md'
              : 'border-border hover:border-accent hover:shadow-md'
          } ${isProvisioning && selectedTemplateId !== 'blank' ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="p-2.5 rounded-xl bg-canvas border border-border text-foreground group-hover:bg-accent group-hover:text-white transition-colors">
                <FileText className="w-5 h-5" />
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-canvas border border-border text-text-muted">
                Clean Slate
              </span>
            </div>

            <h3 className="font-bold text-sm text-foreground group-hover:text-accent transition-colors">
              Blank Document
            </h3>
            <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">
              Start from scratch with rich text, markdown formatting, collaborative suggestion mode, and custom block insertion.
            </p>
          </div>

          <div className="mt-6 pt-3 border-t border-border flex items-center justify-between text-xs font-semibold text-accent">
            {isProvisioning && selectedTemplateId === 'blank' ? (
              <span className="flex items-center gap-1.5 text-text-muted">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                <span>Provisioning...</span>
              </span>
            ) : (
              <>
                <span>Start Blank</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </div>
        </div>

        {/* Enterprise Templates */}
        {TEMPLATES.map((tpl) => {
          const Icon = tpl.icon;
          const isSelected = selectedTemplateId === tpl.id;
          return (
            <div
              key={tpl.id}
              onClick={() => handleSelectTemplate(tpl.id, tpl.title)}
              className={`group p-5 rounded-2xl border bg-surface transition-all cursor-pointer flex flex-col justify-between text-left relative overflow-hidden ${
                isSelected
                  ? 'border-accent ring-2 ring-accent/30 shadow-md'
                  : 'border-border hover:border-accent hover:shadow-md'
              } ${isProvisioning && !isSelected ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2.5 rounded-xl bg-canvas border border-border text-accent group-hover:bg-accent group-hover:text-white transition-colors">
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-canvas border border-border text-text-muted">
                    {tpl.badge}
                  </span>
                </div>

                <h3 className="font-bold text-sm text-foreground group-hover:text-accent transition-colors">
                  {tpl.title}
                </h3>
                <p className="text-xs text-text-secondary mt-1.5 leading-relaxed line-clamp-2">
                  {tpl.description}
                </p>

                <div className="mt-4 pt-3 border-t border-border flex flex-wrap gap-1">
                  {tpl.previewItems.map((item, idx) => (
                    <span
                      key={idx}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-canvas text-text-muted font-medium"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-6 pt-3 border-t border-border flex items-center justify-between text-xs font-semibold text-accent">
                {isProvisioning && isSelected ? (
                  <span className="flex items-center gap-1.5 text-text-muted">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                    <span>Scaffolding template...</span>
                  </span>
                ) : (
                  <>
                    <span>Use Template</span>
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
