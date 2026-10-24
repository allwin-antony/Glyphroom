import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { AdminView } from '../src/views/AdminView.js';
import { api } from '../src/lib/api.js';

describe('AdminView Component & Cryptographic Hash Chain Verification', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('UI Layout & Governance Tabs', () => {
    it('renders admin console header, governance tabs, and audit timeline by default', () => {
      render(<AdminView />);

      // Title & description
      expect(screen.getByText('Glyphroom Admin Console')).toBeDefined();
      expect(
        screen.getByText(/Governance portal for user roles, Personal Access Tokens/i)
      ).toBeDefined();

      // Tab navigation buttons
      expect(screen.getByRole('button', { name: /User Directory/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /PAT Token Inventory/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Audit Log & Chain Verification/i })).toBeDefined();

      // Default active tab is audit log
      expect(screen.getByText('Cryptographic SHA-256 Tamper Verification')).toBeDefined();
      expect(screen.getByRole('button', { name: /Verify Hash Chain/i })).toBeDefined();
      expect(screen.getByText('Audit Timeline & Event Stream')).toBeDefined();
    });

    it('switches between User Directory, PAT Token Inventory, and Audit Timeline tabs', () => {
      render(<AdminView />);

      // Switch to User Directory
      fireEvent.click(screen.getByRole('button', { name: /User Directory/i }));
      expect(screen.getByText('User Management Directory')).toBeDefined();
      expect(screen.queryByText('Cryptographic SHA-256 Tamper Verification')).toBeNull();

      // Switch to PAT Token Inventory
      fireEvent.click(screen.getByRole('button', { name: /PAT Token Inventory/i }));
      expect(screen.getByText('Personal Access Tokens (PAT) Inventory')).toBeDefined();
      expect(screen.queryByText('User Management Directory')).toBeNull();

      // Switch back to Audit Log & Chain Verification
      fireEvent.click(screen.getByRole('button', { name: /Audit Log & Chain Verification/i }));
      expect(screen.getByText('Cryptographic SHA-256 Tamper Verification')).toBeDefined();
      expect(screen.getByText('Audit Timeline & Event Stream')).toBeDefined();
    });
  });

  describe('Hash Chain Verification — Genuine Success Handling', () => {
    it('displays success banner when audit verification returns valid: true', async () => {
      const apiGetSpy = vi.spyOn(api, 'get').mockResolvedValueOnce({ valid: true });

      render(<AdminView />);

      const verifyButton = screen.getByRole('button', { name: /Verify Hash Chain/i });
      fireEvent.click(verifyButton);

      await waitFor(() => {
        expect(
          screen.getByText(
            '100% Cryptographically Verified (Genesis chain verified, 0 discrepancies)'
          )
        ).toBeDefined();
      });

      expect(apiGetSpy).toHaveBeenCalledWith('/audit/verify');
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('displays verified block count when valid: true with totalRows is returned', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce({ valid: true, totalRows: 54 });

      render(<AdminView />);

      const verifyButton = screen.getByRole('button', { name: /Verify Hash Chain/i });
      fireEvent.click(verifyButton);

      await waitFor(() => {
        expect(
          screen.getByText(
            '100% Cryptographically Verified (54 blocks verified, 0 discrepancies)'
          )
        ).toBeDefined();
      });

      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  describe('Hash Chain Verification — Integrity Failure / Anomaly Detection', () => {
    it('displays anomaly error banner and NO success banner when valid: false', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce({ valid: false });

      render(<AdminView />);

      const verifyButton = screen.getByRole('button', { name: /Verify Hash Chain/i });
      fireEvent.click(verifyButton);

      await waitFor(() => {
        expect(screen.getByText('Integrity verification detected anomalies')).toBeDefined();
      });

      // Strict integrity check: Ensure NO success banner is present
      expect(screen.queryByText(/100% Cryptographically Verified/i)).toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('displays specific tampered row ID when detected', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce({
        valid: false,
        tamperedRowId: 'row-audit-log-uuid-999',
      });

      render(<AdminView />);

      const verifyButton = screen.getByRole('button', { name: /Verify Hash Chain/i });
      fireEvent.click(verifyButton);

      await waitFor(() => {
        expect(
          screen.getByText('Tamper detected at row ID: row-audit-log-uuid-999')
        ).toBeDefined();
      });

      expect(screen.queryByText(/100% Cryptographically Verified/i)).toBeNull();
    });
  });

  describe('Hash Chain Verification — Genuine Error & Network Failure Reporting', () => {
    it('displays network error message and NO fake success fallback on 500 error', async () => {
      vi.spyOn(api, 'get').mockRejectedValueOnce(
        new Error('Network error: 500 Internal Server Error')
      );

      render(<AdminView />);

      const verifyButton = screen.getByRole('button', { name: /Verify Hash Chain/i });
      fireEvent.click(verifyButton);

      await waitFor(() => {
        expect(
          screen.getByText('Network error: 500 Internal Server Error')
        ).toBeDefined();
      });

      // Strict anti-cheat assertion: catch block MUST NOT display fake verified banner!
      expect(screen.queryByText(/100% Cryptographically Verified/i)).toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('displays fallback message and NO success banner on empty error rejection', async () => {
      vi.spyOn(api, 'get').mockRejectedValueOnce({});

      render(<AdminView />);

      const verifyButton = screen.getByRole('button', { name: /Verify Hash Chain/i });
      fireEvent.click(verifyButton);

      await waitFor(() => {
        expect(
          screen.getByText(
            'Failed to communicate with audit verification service. Please verify backend status.'
          )
        ).toBeDefined();
      });

      expect(screen.queryByText(/100% Cryptographically Verified/i)).toBeNull();
    });
  });

  describe('State Transitions & Loading Indicator', () => {
    it('shows loading indicator and disables button while verification request is pending', async () => {
      let resolvePromise: (value: any) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      vi.spyOn(api, 'get').mockReturnValueOnce(pendingPromise as any);

      render(<AdminView />);

      const verifyButton = screen.getByRole('button', { name: /Verify Hash Chain/i });
      fireEvent.click(verifyButton);

      // In flight
      expect(screen.getByText('Verifying...')).toBeDefined();
      expect((verifyButton as HTMLButtonElement).disabled).toBe(true);

      // Resolve
      resolvePromise!({ valid: true, totalRows: 10 });

      await waitFor(() => {
        expect(screen.getByText(/100% Cryptographically Verified \(10 blocks verified/i)).toBeDefined();
      });

      expect((screen.getByRole('button', { name: /Verify Hash Chain/i }) as HTMLButtonElement).disabled).toBe(false);
    });

    it('clears previous success banner when subsequent verification fails', async () => {
      const apiGetSpy = vi.spyOn(api, 'get')
        .mockResolvedValueOnce({ valid: true, totalRows: 5 })
        .mockRejectedValueOnce(new Error('Connection lost'));

      render(<AdminView />);

      const verifyButton = screen.getByRole('button', { name: /Verify Hash Chain/i });

      // First run succeeds
      fireEvent.click(verifyButton);
      await waitFor(() => {
        expect(screen.getByText(/100% Cryptographically Verified/i)).toBeDefined();
      });

      // Second run fails
      fireEvent.click(verifyButton);
      await waitFor(() => {
        expect(screen.getByText('Connection lost')).toBeDefined();
      });

      // Previous success must be cleared
      expect(screen.queryByText(/100% Cryptographically Verified/i)).toBeNull();
    });
  });
});
