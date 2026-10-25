import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.js';
import { ThemeToggle } from '../ui/ThemeToggle.js';
import { api } from '../../lib/api.js';
import {
  Sparkles,
  Home,
  BookOpen,
  FolderGit2,
  CheckSquare,
  Sliders,
  Settings,
  PlusCircle,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Layers,
  Plus,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog.js';

export interface SidebarProps {
  isMobileOpen: boolean;
  onMobileClose: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

interface NavItem {
  name: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  requiredRoles?: Array<'admin' | 'moderator' | 'author' | 'reader'>;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isMobileOpen,
  onMobileClose,
  isCollapsed = false,
  onToggleCollapse,
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [spacesList, setSpacesList] = useState<Array<{ id: string; slug: string; name: string; userRole?: string }>>([]);
  const [isRequestSpaceOpen, setIsRequestSpaceOpen] = useState(false);
  const [requestName, setRequestName] = useState('');
  const [requestSlug, setRequestSlug] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [requestStatus, setRequestStatus] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      api.get<{ spaces: any[] }>('/spaces')
        .then((res) => {
          setSpacesList(res.spaces || []);
        })
        .catch(() => {});
    }
  }, [user]);

  const handleNameChange = (val: string) => {
    setRequestName(val);
    setRequestSlug(val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
  };

  const handleSubmitSpaceRequest = async () => {
    if (!requestName.trim() || !requestSlug.trim()) return;
    setIsSubmittingRequest(true);
    setRequestStatus(null);
    try {
      await api.post('/spaces/requests', {
        name: requestName.trim(),
        slug: requestSlug.trim(),
        reason: requestReason.trim(),
      });
      setRequestStatus('Space request submitted to Administrators for approval!');
      setTimeout(() => {
        setIsRequestSpaceOpen(false);
        setRequestName('');
        setRequestSlug('');
        setRequestReason('');
        setRequestStatus(null);
      }, 1500);
    } catch (err: any) {
      setRequestStatus(err.message || 'Failed to submit space request.');
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  const navItems: NavItem[] = [
    { name: 'Home', to: '/', icon: Home },
    { name: 'Catalog', to: '/catalog', icon: BookOpen },
    { name: 'My Work', to: '/my-work', icon: FolderGit2 },
    {
      name: 'Reviews',
      to: '/reviews',
      icon: CheckSquare,
      requiredRoles: ['moderator', 'admin'],
      badge: 'Queue',
    },
    {
      name: 'Admin Console',
      to: '/admin',
      icon: Sliders,
      requiredRoles: ['admin'],
      badge: 'Admin',
    },
    { name: 'Settings', to: '/settings', icon: Settings },
  ];

  // Filter items based on user role
  const visibleNavItems = navItems.filter((item) => {
    if (!item.requiredRoles) return true;
    if (!user) return false;
    return item.requiredRoles.includes(user.role);
  });

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 bg-surface border-r border-border flex flex-col transition-all duration-200 ease-in-out md:static md:translate-x-0 ${
          isCollapsed ? 'md:w-16 w-64' : 'md:w-64 w-64'
        } ${isMobileOpen ? 'translate-x-0' : '-translate-x-0 max-md:-translate-x-full'}`}
      >
        {/* Brand Header */}
        <div className={`h-16 flex items-center border-b border-border ${isCollapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
          {!isCollapsed ? (
            <>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-xl bg-gradient-to-tr from-accent to-accent-dark text-white shadow-sm shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="font-bold text-base tracking-tight text-foreground truncate">
                  Glyphroom
                </div>
              </div>

              {/* Desktop collapse toggle button */}
              {onToggleCollapse && (
                <button
                  onClick={onToggleCollapse}
                  className="p-1.5 rounded-lg text-text-muted hover:text-foreground hover:bg-canvas transition-colors hidden md:flex items-center justify-center"
                  aria-label="Collapse sidebar"
                  title="Collapse sidebar"
                >
                  <PanelLeftClose className="w-4 h-4" />
                </button>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center w-full">
              {/* When collapsed, keep the expand toggle right here at the top */}
              {onToggleCollapse && (
                <button
                  onClick={onToggleCollapse}
                  className="p-2 rounded-xl text-text-muted hover:text-foreground hover:bg-canvas transition-colors hidden md:flex items-center justify-center group"
                  aria-label="Expand sidebar"
                  title="Expand sidebar"
                >
                  <PanelLeftOpen className="w-5 h-5 text-accent group-hover:scale-105 transition-transform" />
                </button>
              )}
            </div>
          )}

          {/* Mobile close button */}
          <button
            onClick={onMobileClose}
            className="p-1 rounded-md text-text-muted hover:text-foreground hover:bg-canvas md:hidden"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick New Post CTA */}
        <div className={`p-3 border-b border-border ${isCollapsed ? 'flex justify-center' : ''}`}>
          <NavLink
            to="/posts/new"
            onClick={onMobileClose}
            className={`flex items-center rounded-lg bg-accent text-white font-medium text-xs shadow-xs hover:opacity-90 transition-all ${
              isCollapsed
                ? 'w-10 h-10 justify-center p-0'
                : 'w-full py-2 px-3 justify-center gap-2'
            }`}
            title="Create New Post"
          >
            <PlusCircle className="w-4 h-4 shrink-0" />
            {!isCollapsed && <span>Create New Post</span>}
          </NavLink>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
          {!isCollapsed && (
            <div className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Navigation
            </div>
          )}

          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={onMobileClose}
                title={isCollapsed ? item.name : undefined}
                className={({ isActive }) =>
                  `flex items-center rounded-lg text-xs font-medium transition-colors ${
                    isCollapsed
                      ? 'justify-center w-10 h-10 mx-auto'
                      : 'justify-between px-3 py-2'
                  } ${
                    isActive
                      ? 'bg-accent-bg text-accent font-semibold border-l-2 border-accent'
                      : 'text-text-secondary hover:text-foreground hover:bg-canvas'
                  }`
                }
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  {!isCollapsed && <span className="truncate">{item.name}</span>}
                </div>
                {!isCollapsed && item.badge && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-surface border border-border text-text-secondary shrink-0">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}

          {/* Team Spaces Section */}
          {!isCollapsed && (
            <div className="pt-4 pb-1">
              <div className="px-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                <span>Team Spaces</span>
                <button
                  onClick={() => setIsRequestSpaceOpen(true)}
                  className="p-0.5 rounded hover:bg-canvas hover:text-accent transition-colors"
                  title="Request New Space"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="mt-1 space-y-0.5">
                {spacesList.length === 0 ? (
                  <div className="px-3 py-1.5 text-[11px] text-text-muted italic">
                    No active spaces
                  </div>
                ) : (
                  spacesList.slice(0, 8).map((sp) => (
                    <NavLink
                      key={sp.id}
                      to={`/spaces/${sp.slug}`}
                      onClick={onMobileClose}
                      className={({ isActive }) =>
                        `flex items-center justify-between px-3 py-1.5 rounded-lg text-xs transition-colors ${
                          isActive
                            ? 'bg-accent-bg text-accent font-semibold'
                            : 'text-text-secondary hover:text-foreground hover:bg-canvas'
                        }`
                      }
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <Layers className="w-3.5 h-3.5 text-text-muted shrink-0" />
                        <span className="truncate">{sp.name}</span>
                      </div>
                      {sp.userRole && (
                        <span className="text-[9px] uppercase px-1 py-0.2 rounded bg-surface border border-border text-text-muted">
                          {sp.userRole[0]}
                        </span>
                      )}
                    </NavLink>
                  ))
                )}
              </div>
            </div>
          )}
        </nav>

        {/* Footer Session / Theme Toggle */}
        <div className={`p-3 border-t border-border bg-surface-muted/30 ${isCollapsed ? 'flex flex-col items-center gap-3' : 'space-y-3'}`}>
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-2">
              <ThemeToggle />
            </div>
          ) : (
            <div className="flex items-center justify-between text-xs text-text-secondary">
              <span className="font-medium">Theme</span>
              <ThemeToggle />
            </div>
          )}

          {user && (
            <div
              className={`flex items-center rounded-lg bg-surface border border-border shadow-xs ${
                isCollapsed ? 'justify-center p-1.5' : 'gap-2.5 p-2'
              }`}
              title={isCollapsed ? (user.fullName || user.email) : undefined}
            >
              <div className="w-7 h-7 rounded-full bg-accent-bg border border-accent/20 flex items-center justify-center font-bold text-xs text-accent shrink-0">
                {user.fullName ? user.fullName[0].toUpperCase() : 'U'}
              </div>
              {!isCollapsed && (
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-foreground truncate">
                    {user.fullName || user.email}
                  </div>
                  <div className="text-[10px] capitalize text-text-muted truncate">
                    {user.role} role
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* User Space Request Dialog */}
      <Dialog open={isRequestSpaceOpen} onOpenChange={setIsRequestSpaceOpen}>
        <DialogContent className="sm:max-w-md bg-surface text-foreground border border-border">
          <DialogHeader>
            <DialogTitle>Request a New Team Space</DialogTitle>
            <DialogDescription className="text-text-secondary text-xs">
              Submit a proposal for a dedicated workspace. Platform Administrators will review and provision the space.
            </DialogDescription>
          </DialogHeader>

          {requestStatus && (
            <div className="p-3 rounded-lg bg-accent-bg border border-accent/20 text-accent text-xs">
              {requestStatus}
            </div>
          )}

          <div className="space-y-3 py-2 text-xs">
            <div>
              <label className="block font-semibold mb-1">Space Name</label>
              <input
                type="text"
                value={requestName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. Payments Revamp"
                className="w-full p-2 rounded-lg bg-canvas border border-border text-foreground"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">URL Identifier (Slug)</label>
              <input
                type="text"
                value={requestSlug}
                onChange={(e) => setRequestSlug(e.target.value)}
                placeholder="e.g. payments-revamp"
                className="w-full p-2 rounded-lg bg-canvas border border-border text-foreground font-mono text-[11px]"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Reason & Purpose</label>
              <textarea
                value={requestReason}
                onChange={(e) => setRequestReason(e.target.value)}
                rows={3}
                placeholder="Describe which team or initiative will use this space..."
                className="w-full p-2 rounded-lg bg-canvas border border-border text-foreground resize-none"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <button
              onClick={() => setIsRequestSpaceOpen(false)}
              className="px-3 py-1.5 rounded-lg border border-border text-xs"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmitSpaceRequest}
              disabled={isSubmittingRequest || !requestName.trim()}
              className="px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold disabled:opacity-50"
            >
              {isSubmittingRequest ? 'Submitting...' : 'Submit Request'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
