import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.js';
import { ThemeToggle } from '../ui/ThemeToggle.js';
import {
  Search,
  Plus,
  Menu,
  LogOut,
  FolderGit2,
  Settings,
  Sliders,
  ChevronDown,
  UserCheck,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

export interface TopBarProps {
  onOpenCommandSearch: () => void;
  onToggleMobileSidebar: () => void;
  isSidebarCollapsed?: boolean;
  onToggleDesktopSidebar?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  onOpenCommandSearch,
  onToggleMobileSidebar,
  isSidebarCollapsed,
  onToggleDesktopSidebar,
}) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  // Close profile dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setIsProfileOpen(false);
    await logout();
    navigate('/sign-in');
  };

  const isMac = typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  return (
    <header className="h-16 bg-surface border-b border-border flex items-center justify-between px-4 sm:px-6 z-20 transition-colors">
      {/* Left: Mobile hamburger & Search trigger */}
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleMobileSidebar}
          className="p-2 rounded-lg text-text-muted hover:text-foreground hover:bg-canvas md:hidden transition-colors"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {onToggleDesktopSidebar && (
          <button
            onClick={onToggleDesktopSidebar}
            className="hidden md:flex p-2 rounded-lg text-text-muted hover:text-foreground hover:bg-canvas transition-colors"
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        )}

        {/* Global Search Trigger Pill */}
        <button
          onClick={onOpenCommandSearch}
          className="flex items-center gap-3 px-3.5 py-1.5 rounded-lg bg-canvas hover:bg-elevated border border-border text-text-muted hover:text-foreground text-xs w-48 sm:w-72 transition-colors text-left group shadow-sm"
        >
          <Search className="w-3.5 h-3.5 text-text-muted group-hover:text-accent-main transition-colors" />
          <span className="flex-1 truncate">Search posts, commands...</span>
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-surface border border-border text-[10px] font-mono text-text-muted shadow-sm">
            {isMac ? '⌘K' : 'Ctrl+K'}
          </kbd>
        </button>
      </div>

      {/* Right: Theme Toggle, New Post CTA & Profile Avatar Menu */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Theme Mode Switcher */}
        <ThemeToggle />

        <button
          onClick={() => navigate('/posts/new')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:opacity-90 text-primary-foreground font-semibold text-xs shadow-sm transition-all"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New Post</span>
        </button>

        {/* Profile Dropdown Container */}
        <div className="relative" ref={profileMenuRef}>
          <button
            onClick={() => setIsProfileOpen((prev) => !prev)}
            className="flex items-center gap-2 p-1 rounded-lg hover:bg-canvas transition-colors"
            aria-expanded={isProfileOpen}
            aria-haspopup="true"
          >
            <div className="w-8 h-8 rounded-full bg-accent-bg border border-border flex items-center justify-center font-bold text-xs text-accent-main shadow-sm">
              {user?.fullName ? user.fullName[0].toUpperCase() : 'A'}
            </div>
            <div className="hidden lg:block text-left">
              <div className="text-xs font-semibold text-foreground leading-tight">
                {user?.fullName || 'Admin User'}
              </div>
              <div className="text-[10px] text-text-muted capitalize">
                {user?.role || 'admin'}
              </div>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-text-muted hidden lg:block" />
          </button>

          {/* Profile Menu Flyout */}
          {isProfileOpen && (
            <div className="absolute right-0 mt-2 w-60 rounded-xl bg-elevated border border-border shadow-xl py-1 text-xs text-foreground z-50 animate-in fade-in zoom-in-95 duration-100">
              {/* Profile Header */}
              <div className="px-4 py-3 border-b border-border bg-canvas/50">
                <div className="font-semibold text-foreground truncate">{user?.fullName}</div>
                <div className="text-text-muted text-[11px] truncate">{user?.email}</div>
                <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-accent-bg text-accent-main border border-accent-main/20">
                  <UserCheck className="w-3 h-3" />
                  <span>{user?.role}</span>
                </div>
              </div>

              {/* Menu Links */}
              <div className="py-1">
                <Link
                  to="/my-work"
                  onClick={() => setIsProfileOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2 hover:bg-canvas text-text-secondary hover:text-foreground transition-colors"
                >
                  <FolderGit2 className="w-4 h-4 text-text-muted" />
                  <span>My Work</span>
                </Link>

                <Link
                  to="/settings"
                  onClick={() => setIsProfileOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2 hover:bg-canvas text-text-secondary hover:text-foreground transition-colors"
                >
                  <Settings className="w-4 h-4 text-text-muted" />
                  <span>Personal Settings & PATs</span>
                </Link>

                {user?.role === 'admin' && (
                  <Link
                    to="/admin"
                    onClick={() => setIsProfileOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2 hover:bg-canvas text-text-secondary hover:text-foreground transition-colors"
                  >
                    <Sliders className="w-4 h-4 text-status-warning" />
                    <span>Admin Console</span>
                  </Link>
                )}
              </div>

              <div className="border-t border-border my-1" />

              {/* Sign Out Action */}
              <button
                onClick={handleLogout}
                className="flex items-center gap-2.5 w-full text-left px-4 py-2 text-status-danger hover:bg-status-danger/10 transition-colors font-medium"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
