import React, { useState, useEffect, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar.js';
import { TopBar } from './TopBar.js';
import { CommandSearch } from './CommandSearch.js';

export const AppLayout: React.FC = () => {
  const [isCommandSearchOpen, setIsCommandSearchOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Global keyboard listener for Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsCommandSearchOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleOpenSearch = useCallback(() => {
    setIsCommandSearchOpen(true);
  }, []);

  const handleCloseSearch = useCallback(() => {
    setIsCommandSearchOpen(false);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors">
      {/* 1. Desktop & Mobile Sidebar */}
      <Sidebar
        isMobileOpen={isMobileSidebarOpen}
        onMobileClose={() => setIsMobileSidebarOpen(false)}
      />

      {/* 2. Main Application Column */}
      <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden bg-slate-50 dark:bg-slate-900 transition-colors">
        {/* Global Topbar */}
        <TopBar
          onOpenCommandSearch={handleOpenSearch}
          onToggleMobileSidebar={() => setIsMobileSidebarOpen((prev) => !prev)}
        />

        {/* Dynamic Route Content Area */}
        <main className="flex-1 overflow-y-auto bg-slate-50/60 dark:bg-slate-950 relative focus:outline-none transition-colors">
          <Outlet />
        </main>
      </div>

      {/* 3. Global Command Search Modal */}
      <CommandSearch
        isOpen={isCommandSearchOpen}
        onClose={handleCloseSearch}
      />
    </div>
  );
};
