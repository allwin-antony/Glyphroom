import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { SignInView } from '../src/views/SignInView.js';
import { AuthContext, type AuthContextValue } from '../src/context/AuthContext.js';
import { ApiError } from '../src/lib/api.js';

describe('SignInView Component', () => {
  let mockLogin: ReturnType<typeof vi.fn>;
  let mockAuthValue: AuthContextValue;

  beforeEach(() => {
    mockLogin = vi.fn();
    mockAuthValue = {
      user: null,
      csrfToken: null,
      isLoading: false,
      isAuthenticated: false,
      login: mockLogin,
      logout: vi.fn(),
      refreshSession: vi.fn(),
    };
  });

  it('renders corporate branding, email/password inputs, and break-glass helper', () => {
    render(
      <MemoryRouter>
        <AuthContext.Provider value={mockAuthValue}>
          <SignInView />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    expect(screen.getByText('Enterprise Blogger 2.0')).toBeDefined();
    expect(screen.getByText('Break-Glass Admin')).toBeDefined();
    expect(screen.getByPlaceholderText('name@company.com')).toBeDefined();
    expect(screen.getByPlaceholderText('••••••••••••')).toBeDefined();
  });

  it('quick-fills admin credentials when clicking Fill button', () => {
    render(
      <MemoryRouter>
        <AuthContext.Provider value={mockAuthValue}>
          <SignInView />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    const fillBtn = screen.getByRole('button', { name: 'Fill' });
    fireEvent.click(fillBtn);

    const emailInput = screen.getByPlaceholderText('name@company.com') as HTMLInputElement;
    const passwordInput = screen.getByPlaceholderText('••••••••••••') as HTMLInputElement;

    expect(emailInput.value).toBe('admin@enterprise-blogger.local');
    expect(passwordInput.value).toBe('admin2026!');
  });

  it('displays error alert banner when authentication fails', async () => {
    mockLogin.mockRejectedValueOnce(
      new ApiError(401, 'Unauthorized', null, 'Invalid credentials or account inactive.')
    );

    render(
      <MemoryRouter>
        <AuthContext.Provider value={mockAuthValue}>
          <SignInView />
        </AuthContext.Provider>
      </MemoryRouter>
    );

    // Quick fill
    fireEvent.click(screen.getByRole('button', { name: 'Fill' }));

    // Submit
    const submitBtn = screen.getByRole('button', { name: 'Sign In' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toBeDefined();
      expect(alert.textContent).toContain('Invalid credentials or account inactive');
    });
  });
});
