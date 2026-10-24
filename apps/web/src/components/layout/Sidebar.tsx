import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.js';
import { ThemeToggle } from '../ui/ThemeToggle.js';
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
} from 'lucide-react';

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
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-accent to-accent-dark text-white shadow-sm shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            {!isCollapsed && (
              <div className="font-bold text-base tracking-tight text-foreground truncate">
                Glyphroom
              </div>
            )}
          </div>

          {/* Desktop collapse toggle button */}
          {!isCollapsed && onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              className="p-1.5 rounded-lg text-text-muted hover:text-foreground hover:bg-canvas transition-colors hidden md:flex items-center justify-center"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
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
        </nav>

        {/* Footer Session / Theme Toggle */}
        <div className={`p-3 border-t border-border bg-surface-muted/30 ${isCollapsed ? 'flex flex-col items-center gap-3' : 'space-y-3'}`}>
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-2">
              <ThemeToggle />
              {onToggleCollapse && (
                <button
                  onClick={onToggleCollapse}
                  className="p-1.5 rounded-lg text-text-muted hover:text-foreground hover:bg-canvas transition-colors hidden md:flex"
                  title="Expand sidebar"
                  aria-label="Expand sidebar"
                >
                  <PanelLeftOpen className="w-4 h-4" />
                </button>
              )}
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
    </>
  );
};
