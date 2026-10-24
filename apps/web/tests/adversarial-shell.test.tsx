import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { cn } from '../src/lib/utils.js';
import { AppLayout } from '../src/components/layout/AppLayout.js';
import { Sidebar } from '../src/components/layout/Sidebar.js';
import { TopBar } from '../src/components/layout/TopBar.js';
import { CommandSearch } from '../src/components/layout/CommandSearch.js';
import { ProtectedRoute } from '../src/components/auth/ProtectedRoute.js';
import { AuthContext, type AuthContextValue, type AuthUser } from '../src/context/AuthContext.js';

// Helper to construct mock AuthContext values
const createMockAuth = (
  role: 'admin' | 'moderator' | 'author' | 'reader' = 'reader',
  overrides?: Partial<AuthContextValue>
): AuthContextValue => ({
  user: {
    id: `user-${role}-1`,
    userId: `user-${role}-1`,
    email: `${role}@enterprise-blogger.local`,
    fullName: `${role.toUpperCase()} Test User`,
    role,
  },
  csrfToken: 'mock-csrf-token-xyz',
  isLoading: false,
  isAuthenticated: true,
  login: vi.fn(),
  logout: vi.fn(),
  refreshSession: vi.fn(),
  ...overrides,
});

describe('Adversarial Verification: cn() Utility Edge Cases', () => {
  it('handles null, undefined, false, 0, and empty inputs gracefully', () => {
    expect(cn()).toBe('');
    expect(cn(null)).toBe('');
    expect(cn(undefined)).toBe('');
    expect(cn(false)).toBe('');
    expect(cn('')).toBe('');
    expect(cn(null, undefined, false, '', 'valid-class')).toBe('valid-class');
  });

  it('correctly resolves conflicting Tailwind padding and margin classes', () => {
    // Direct conflict: p-4 overrides p-2
    expect(cn('p-2', 'p-4')).toBe('p-4');

    // General padding over specific axes
    expect(cn('px-4 py-2', 'p-8')).toBe('p-8');

    // Specific axis after general padding (p-8 then px-4 should preserve py-8 from p-8 and set px-4)
    expect(cn('p-8', 'px-4')).toBe('p-8 px-4');

    // Margin overrides
    expect(cn('m-2', 'm-6')).toBe('m-6');
    expect(cn('mt-2 mb-4', 'm-8')).toBe('m-8');
    expect(cn('m-8', 'mt-2')).toBe('m-8 mt-2');
  });

  it('correctly resolves conflicting colors, display, and layout classes', () => {
    // Text color conflict
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');

    // Background color conflict
    expect(cn('bg-slate-900', 'bg-slate-950')).toBe('bg-slate-950');

    // Display conflict: flex vs block vs hidden
    expect(cn('flex', 'block')).toBe('block');
    expect(cn('block', 'hidden')).toBe('hidden');
    expect(cn('hidden', 'flex')).toBe('flex');

    // Dimensions
    expect(cn('w-12', 'w-full')).toBe('w-full');
    expect(cn('h-16', 'h-screen')).toBe('h-screen');
  });

  it('handles deeply nested arrays and conditional object configurations', () => {
    const result = cn(
      'base',
      ['nested-1', ['nested-2', { 'active-class': true, 'inactive-class': false }]],
      null,
      undefined,
      { 'conditional-true': true }
    );
    expect(result).toBe('base nested-1 nested-2 active-class conditional-true');
  });

  it('deduplicates identical classes and arbitrary Tailwind values', () => {
    expect(cn('font-bold', 'font-bold', 'font-bold')).toBe('font-bold');
    expect(cn('bg-[#123456]', 'bg-[#abcdef]')).toBe('bg-[#abcdef]');
  });
});

describe('Adversarial Verification: Role-Based Sidebar Navigation', () => {
  const roles: Array<'reader' | 'author' | 'moderator' | 'admin'> = [
    'reader',
    'author',
    'moderator',
    'admin',
  ];

  it('reader sees Home, Catalog, My Work, Settings and NOT Reviews or Admin Console', () => {
    render(
      <MemoryRouter>
        <AuthContext.Provider value={createMockAuth('reader')}>
          <Sidebar isMobileOpen={false} onMobileClose={vi.fn()} />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    expect(screen.getByText('Home')).toBeDefined();
    expect(screen.getByText('Catalog')).toBeDefined();
    expect(screen.getByText('My Work')).toBeDefined();
    expect(screen.getByText('Settings')).toBeDefined();
    expect(screen.queryByText('Reviews')).toBeNull();
    expect(screen.queryByText('Admin Console')).toBeNull();
  });

  it('author sees Home, Catalog, My Work, Settings and NOT Reviews or Admin Console', () => {
    render(
      <MemoryRouter>
        <AuthContext.Provider value={createMockAuth('author')}>
          <Sidebar isMobileOpen={false} onMobileClose={vi.fn()} />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    expect(screen.getByText('Home')).toBeDefined();
    expect(screen.getByText('Catalog')).toBeDefined();
    expect(screen.getByText('My Work')).toBeDefined();
    expect(screen.getByText('Settings')).toBeDefined();
    expect(screen.queryByText('Reviews')).toBeNull();
    expect(screen.queryByText('Admin Console')).toBeNull();
  });

  it('moderator sees Reviews but NOT Admin Console', () => {
    render(
      <MemoryRouter>
        <AuthContext.Provider value={createMockAuth('moderator')}>
          <Sidebar isMobileOpen={false} onMobileClose={vi.fn()} />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    expect(screen.getByText('Home')).toBeDefined();
    expect(screen.getByText('Catalog')).toBeDefined();
    expect(screen.getByText('My Work')).toBeDefined();
    expect(screen.getByText('Reviews')).toBeDefined();
    expect(screen.getByText('Settings')).toBeDefined();
    expect(screen.queryByText('Admin Console')).toBeNull();
  });

  it('admin sees both Reviews and Admin Console', () => {
    render(
      <MemoryRouter>
        <AuthContext.Provider value={createMockAuth('admin')}>
          <Sidebar isMobileOpen={false} onMobileClose={vi.fn()} />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    expect(screen.getByText('Home')).toBeDefined();
    expect(screen.getByText('Catalog')).toBeDefined();
    expect(screen.getByText('My Work')).toBeDefined();
    expect(screen.getByText('Reviews')).toBeDefined();
    expect(screen.getByText('Admin Console')).toBeDefined();
    expect(screen.getByText('Settings')).toBeDefined();
  });

  it('dynamically adapts when user role changes at runtime', () => {
    const DynamicRoleWrapper = () => {
      const [role, setRole] = useState<'reader' | 'moderator' | 'admin'>('reader');
      return (
        <AuthContext.Provider value={createMockAuth(role)}>
          <button onClick={() => setRole('moderator')}>Promote to Moderator</button>
          <button onClick={() => setRole('admin')}>Promote to Admin</button>
          <Sidebar isMobileOpen={false} onMobileClose={vi.fn()} />
        </AuthContext.Provider>
      );
    };

    render(
      <MemoryRouter>
        <DynamicRoleWrapper />
      </MemoryRouter>
    );

    // Initial: reader
    expect(screen.queryByText('Reviews')).toBeNull();
    expect(screen.queryByText('Admin Console')).toBeNull();

    // Promote to moderator
    fireEvent.click(screen.getByText('Promote to Moderator'));
    expect(screen.getByText('Reviews')).toBeDefined();
    expect(screen.queryByText('Admin Console')).toBeNull();

    // Promote to admin
    fireEvent.click(screen.getByText('Promote to Admin'));
    expect(screen.getByText('Reviews')).toBeDefined();
    expect(screen.getByText('Admin Console')).toBeDefined();
  });
});

describe('Adversarial Verification: Keyboard Navigation & CommandSearch Dialog', () => {
  it('opens and closes via Cmd+K / Ctrl+K and Escape globally in AppLayout', () => {
    render(
      <MemoryRouter>
        <AuthContext.Provider value={createMockAuth('admin')}>
          <AppLayout />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    // Initially closed
    expect(screen.queryByPlaceholderText('Type a command or search platform features...')).toBeNull();

    // Test Cmd+K (Mac metaKey)
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByPlaceholderText('Type a command or search platform features...')).toBeDefined();

    // Cmd+K again toggles it closed
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.queryByPlaceholderText('Type a command or search platform features...')).toBeNull();

    // Test Ctrl+K (Windows/Linux ctrlKey)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByPlaceholderText('Type a command or search platform features...')).toBeDefined();

    // Test Escape closes it
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByPlaceholderText('Type a command or search platform features...')).toBeNull();

    // Test case insensitivity: uppercase 'K' with Ctrl
    fireEvent.keyDown(window, { key: 'K', ctrlKey: true });
    expect(screen.getByPlaceholderText('Type a command or search platform features...')).toBeDefined();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByPlaceholderText('Type a command or search platform features...')).toBeNull();
  });

  it('cycles command selection via ArrowDown and ArrowUp with boundary wrap-around', () => {
    render(
      <MemoryRouter>
        <AuthContext.Provider value={createMockAuth('admin')}>
          <CommandSearch isOpen={true} onClose={vi.fn()} />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    // Initial selected index is 0 ('Home Dashboard')
    // ArrowUp at top wraps around to the last command
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    // In admin mode, last item is 'Verify Audit Chain Integrity'
    expect(screen.getByText('Verify Audit Chain Integrity')).toBeDefined();

    // ArrowDown wraps from bottom back to 0 ('Home Dashboard')
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getByText('Home Dashboard')).toBeDefined();

    // ArrowDown steps to item 1 ('Browse Catalog')
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getByText('Browse Catalog')).toBeDefined();
  });

  it('filters commands by search query and executes selection on Enter', () => {
    const handleClose = vi.fn();
    render(
      <MemoryRouter>
        <AuthContext.Provider value={createMockAuth('admin')}>
          <CommandSearch isOpen={true} onClose={handleClose} />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText('Type a command or search platform features...');

    // Type query: 'audit'
    fireEvent.change(input, { target: { value: 'audit' } });
    expect(screen.getByText('Verify Audit Chain Integrity')).toBeDefined();
    expect(screen.queryByText('Home Dashboard')).toBeNull();

    // Press Enter to execute selected filtered command
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('handles empty query result without crashing on arrow keys or Enter', () => {
    const handleClose = vi.fn();
    render(
      <MemoryRouter>
        <AuthContext.Provider value={createMockAuth('admin')}>
          <CommandSearch isOpen={true} onClose={handleClose} />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText('Type a command or search platform features...');

    // Type impossible query
    fireEvent.change(input, { target: { value: 'non_existent_search_term_12345' } });
    expect(screen.getByText(/No matching commands found/)).toBeDefined();

    // Arrow navigation when empty should not throw
    expect(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      fireEvent.keyDown(window, { key: 'ArrowUp' });
      fireEvent.keyDown(window, { key: 'Enter' });
    }).not.toThrow();

    // Enter with 0 items should NOT close or navigate
    expect(handleClose).not.toHaveBeenCalled();
  });

  it('strictly filters commands by role inside CommandSearch', () => {
    const { unmount } = render(
      <MemoryRouter>
        <AuthContext.Provider value={createMockAuth('reader')}>
          <CommandSearch isOpen={true} onClose={vi.fn()} />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    // Reader should not see Governance items
    expect(screen.queryByText('Review Queue')).toBeNull();
    expect(screen.queryByText('Admin Console')).toBeNull();
    expect(screen.queryByText('Verify Audit Chain Integrity')).toBeNull();

    unmount();

    // Moderator should see Review Queue, but not Admin items
    render(
      <MemoryRouter>
        <AuthContext.Provider value={createMockAuth('moderator')}>
          <CommandSearch isOpen={true} onClose={vi.fn()} />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    expect(screen.getByText('Review Queue')).toBeDefined();
    expect(screen.queryByText('Admin Console')).toBeNull();
    expect(screen.queryByText('Verify Audit Chain Integrity')).toBeNull();
  });

  it('evaluates backdrop click behavior on CommandSearch to ensure dismissal', () => {
    const handleClose = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <AuthContext.Provider value={createMockAuth('admin')}>
          <CommandSearch isOpen={true} onClose={handleClose} />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    // The outermost backdrop element
    const backdrop = container.firstElementChild as HTMLElement;
    expect(backdrop).toBeDefined();

    // Fire click directly on backdrop
    fireEvent.click(backdrop);

    // Outer backdrop overlay has onClick={onClose} attached
    const backdropClosesModal = handleClose.mock.calls.length > 0;
    expect(backdropClosesModal).toBe(true);
    expect(handleClose).toHaveBeenCalledTimes(1);

    // Also assert clicking inner modal content stops propagation and does not trigger onClose again
    const modalContent = backdrop.firstElementChild as HTMLElement;
    expect(modalContent).toBeDefined();
    fireEvent.click(modalContent);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});

describe('Adversarial Verification: TopBar & Profile Dropdown', () => {
  it('toggles profile menu and respects role visibility for Admin Console', () => {
    render(
      <MemoryRouter>
        <AuthContext.Provider value={createMockAuth('admin')}>
          <TopBar onOpenCommandSearch={vi.fn()} onToggleMobileSidebar={vi.fn()} />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    // Profile dropdown closed initially
    expect(screen.queryByText('Sign Out')).toBeNull();

    // Click profile button to open
    const profileButton = screen.getByRole('button', { name: /ADMIN Test User/i });
    fireEvent.click(profileButton);

    // Open: Admin sees Admin Console in dropdown
    expect(screen.getByText('Personal Settings & PATs')).toBeDefined();
    expect(screen.getByText('Admin Console')).toBeDefined();
    expect(screen.getByText('Sign Out')).toBeDefined();
  });

  it('hides Admin Console from reader profile menu', () => {
    render(
      <MemoryRouter>
        <AuthContext.Provider value={createMockAuth('reader')}>
          <TopBar onOpenCommandSearch={vi.fn()} onToggleMobileSidebar={vi.fn()} />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    const profileButton = screen.getByRole('button', { name: /READER Test User reader/i });
    fireEvent.click(profileButton);

    expect(screen.getByText('Personal Settings & PATs')).toBeDefined();
    expect(screen.queryByText('Admin Console')).toBeNull();
    expect(screen.getByText('Sign Out')).toBeDefined();
  });
});

describe('Adversarial Verification: ProtectedRoute Access Control', () => {
  it('redirects unauthenticated users to /sign-in preserving return location', () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AuthContext.Provider
          value={createMockAuth('reader', { isAuthenticated: false, user: null })}
        >
          <Routes>
            <Route path="/sign-in" element={<div>Sign-in View Destination</div>} />
            <Route
              path="/admin"
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <div>Confidential Admin Area</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>
    );

    expect(screen.getByText('Sign-in View Destination')).toBeDefined();
    expect(screen.queryByText('Confidential Admin Area')).toBeNull();
  });

  it('renders loading indicator without FOUC when isLoading is true', () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AuthContext.Provider
          value={createMockAuth('admin', { isLoading: true, isAuthenticated: false, user: null })}
        >
          <ProtectedRoute allowedRoles={['admin']}>
            <div>Confidential Admin Area</div>
          </ProtectedRoute>
        </AuthContext.Provider>
      </MemoryRouter>
    );

    expect(screen.getByText('Authenticating session...')).toBeDefined();
    expect(screen.queryByText('Confidential Admin Area')).toBeNull();
  });

  it('renders 403 Access Restricted screen on role mismatch displaying current & required roles', () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AuthContext.Provider value={createMockAuth('reader')}>
          <Routes>
            <Route
              path="/admin"
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <div>Confidential Admin Area</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>
    );

    expect(screen.getByText('Access Restricted')).toBeDefined();
    expect(screen.getByText('reader')).toBeDefined();
    expect(screen.getByText('admin')).toBeDefined();
    expect(screen.getByText('Return to Dashboard')).toBeDefined();
    expect(screen.queryByText('Confidential Admin Area')).toBeNull();
  });

  it('allows access when user role matches allowedRoles', () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AuthContext.Provider value={createMockAuth('admin')}>
          <Routes>
            <Route
              path="/admin"
              element={
                <ProtectedRoute allowedRoles={['admin']}>
                  <div>Confidential Admin Area</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>
    );

    expect(screen.getByText('Confidential Admin Area')).toBeDefined();
    expect(screen.queryByText('Access Restricted')).toBeNull();
  });
});
