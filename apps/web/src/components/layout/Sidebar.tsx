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
  Radio,
} from 'lucide-react';

export interface SidebarProps {
  isMobileOpen: boolean;
  onMobileClose: () => void;
}

interface NavItem {
  name: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  requiredRoles?: Array<'admin' | 'moderator' | 'author' | 'reader'>;
}

export const Sidebar: React.FC<SidebarProps> = ({ isMobileOpen, onMobileClose }) => {
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
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 flex flex-col transition-transform duration-200 ease-in-out md:static md:translate-x-0 ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-0 max-md:-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 flex items-center justify-between px-5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 text-white shadow-md shadow-sky-500/20">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="font-bold text-base tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <span>Glyphroom</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                  2.0
                </span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Knowledge & Publishing</div>
            </div>
          </div>

          <button
            onClick={onMobileClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 md:hidden"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick New Post CTA */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800/60">
          <NavLink
            to="/posts/new"
            onClick={onMobileClose}
            className="flex items-center justify-center gap-2 w-full py-2.5 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs shadow-md shadow-sky-600/20 transition-all hover:shadow-sky-500/30"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Create New Post</span>
          </NavLink>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          <div className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Navigation
          </div>

          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={onMobileClose}
                className={({ isActive }) =>
                  `flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400 font-semibold border-l-2 border-sky-600 dark:border-sky-400'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-900'
                  }`
                }
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.name}</span>
                </div>
                {item.badge && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Footer Session Capsule */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/80">
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-2.5">
            <span className="flex items-center gap-1.5">
              <Radio className="w-3 h-3 text-emerald-500 animate-pulse" />
              <span>Core Live</span>
            </span>
            <ThemeToggle />
          </div>

          {user && (
            <div className="flex items-center gap-2.5 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 shadow-sm dark:shadow-none">
              <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center font-bold text-xs text-sky-600 dark:text-sky-400 shrink-0">
                {user.fullName ? user.fullName[0].toUpperCase() : 'U'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                  {user.fullName || user.email}
                </div>
                <div className="text-[10px] capitalize text-slate-500 dark:text-slate-400">
                  {user.role} role
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
