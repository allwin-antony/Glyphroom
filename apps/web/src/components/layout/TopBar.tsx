import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.js';
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
} from 'lucide-react';

export interface TopBarProps {
  onOpenCommandSearch: () => void;
  onToggleMobileSidebar: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  onOpenCommandSearch,
  onToggleMobileSidebar,
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
    <header className="h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 sm:px-6 z-20">
      {/* Left: Mobile hamburger & Search trigger */}
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleMobileSidebar}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 md:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Global Search Trigger Pill */}
        <button
          onClick={onOpenCommandSearch}
          className="flex items-center gap-3 px-3.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800/80 border border-slate-800 text-slate-400 text-xs w-48 sm:w-72 transition-colors text-left group"
        >
          <Search className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 transition-colors" />
          <span className="flex-1 truncate">Search posts, commands...</span>
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700/80 text-[10px] font-mono text-slate-400 shadow-sm">
            {isMac ? '⌘K' : 'Ctrl+K'}
          </kbd>
        </button>
      </div>

      {/* Right: New Post CTA & Profile Avatar Menu */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/posts/new')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs shadow-sm transition-all"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New Post</span>
        </button>

        {/* Profile Dropdown Container */}
        <div className="relative" ref={profileMenuRef}>
          <button
            onClick={() => setIsProfileOpen((prev) => !prev)}
            className="flex items-center gap-2 p-1 rounded-lg hover:bg-slate-800 transition-colors"
            aria-expanded={isProfileOpen}
            aria-haspopup="true"
          >
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-sky-400 shadow-sm">
              {user?.fullName ? user.fullName[0].toUpperCase() : 'A'}
            </div>
            <div className="hidden lg:block text-left">
              <div className="text-xs font-semibold text-slate-200 leading-tight">
                {user?.fullName || 'Admin User'}
              </div>
              <div className="text-[10px] text-slate-400 capitalize">
                {user?.role || 'admin'}
              </div>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 hidden lg:block" />
          </button>

          {/* Profile Menu Flyout */}
          {isProfileOpen && (
            <div className="absolute right-0 mt-2 w-60 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl py-1 text-xs text-slate-200 z-50 animate-in fade-in zoom-in-95 duration-100">
              {/* Profile Header */}
              <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/40">
                <div className="font-semibold text-slate-100 truncate">{user?.fullName}</div>
                <div className="text-slate-400 text-[11px] truncate">{user?.email}</div>
                <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  <UserCheck className="w-3 h-3" />
                  <span>{user?.role}</span>
                </div>
              </div>

              {/* Menu Links */}
              <div className="py-1">
                <Link
                  to="/my-work"
                  onClick={() => setIsProfileOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2 hover:bg-slate-800 text-slate-300 hover:text-slate-100 transition-colors"
                >
                  <FolderGit2 className="w-4 h-4 text-slate-400" />
                  <span>My Work</span>
                </Link>

                <Link
                  to="/settings"
                  onClick={() => setIsProfileOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2 hover:bg-slate-800 text-slate-300 hover:text-slate-100 transition-colors"
                >
                  <Settings className="w-4 h-4 text-slate-400" />
                  <span>Personal Settings & PATs</span>
                </Link>

                {user?.role === 'admin' && (
                  <Link
                    to="/admin"
                    onClick={() => setIsProfileOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2 hover:bg-slate-800 text-slate-300 hover:text-slate-100 transition-colors"
                  >
                    <Sliders className="w-4 h-4 text-amber-400" />
                    <span>Admin Console</span>
                  </Link>
                )}
              </div>

              <div className="border-t border-slate-800 my-1" />

              {/* Sign Out Action */}
              <button
                onClick={handleLogout}
                className="flex items-center gap-2.5 w-full text-left px-4 py-2 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors"
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
