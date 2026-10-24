import React, { useState } from 'react';
import { Users, Key, Shield, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';

export const AdminView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'users' | 'pats' | 'audit'>('audit');
  const [verifyStatus, setVerifyStatus] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const handleVerifyChain = async () => {
    setIsVerifying(true);
    setVerifyError(null);
    setVerifyStatus(null);
    try {
      const result = await api.get<{ valid: boolean; totalRows?: number; tamperedRowId?: string }>('/audit/verify');
      if (result.valid) {
        setVerifyStatus(
          result.totalRows !== undefined
            ? `100% Cryptographically Verified (${result.totalRows} blocks verified, 0 discrepancies)`
            : '100% Cryptographically Verified (Genesis chain verified, 0 discrepancies)'
        );
      } else {
        setVerifyError(
          result.tamperedRowId
            ? `Tamper detected at row ID: ${result.tamperedRowId}`
            : 'Integrity verification detected anomalies'
        );
        setVerifyStatus(null);
      }
    } catch (err: any) {
      setVerifyError(err.message || 'Failed to communicate with audit verification service. Please verify backend status.');
      setVerifyStatus(null);
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Enterprise Admin Console</h1>
        <p className="text-xs text-slate-400 mt-1">
          Governance portal for user roles, Personal Access Tokens (PATs), and cryptographic audit trail verification.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 gap-4">
        {[
          { id: 'users', label: 'User Directory', icon: Users },
          { id: 'pats', label: 'PAT Token Inventory', icon: Key },
          { id: 'audit', label: 'Audit Log & Chain Verification', icon: Shield },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 pb-3 px-2 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-sky-400 text-sky-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* User Directory Tab Content */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800">
            <h2 className="text-sm font-bold text-slate-100">User Management Directory</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Manage enterprise member accounts, role assignments (admin, moderator, author, reader), and access status.
            </p>
          </div>
        </div>
      )}

      {/* PAT Token Inventory Tab Content */}
      {activeTab === 'pats' && (
        <div className="space-y-4">
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800">
            <h2 className="text-sm font-bold text-slate-100">Personal Access Tokens (PAT) Inventory</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Active enterprise-wide personal access tokens, authorized scopes, and credential revocation controls.
            </p>
          </div>
        </div>
      )}

      {/* Audit Log Tab Content */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-100">Cryptographic SHA-256 Tamper Verification</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Validates the sequential SHA-256 hash chain across all recorded platform audit events.
              </p>
            </div>
            <button
              onClick={handleVerifyChain}
              disabled={isVerifying}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium text-xs shadow-md transition-all"
            >
              {isVerifying ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <span>Verify Hash Chain</span>
              )}
            </button>
          </div>

          {verifyStatus && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold flex items-center gap-2" role="status">
              <CheckCircle2 className="w-4 h-4" />
              <span>{verifyStatus}</span>
            </div>
          )}

          {verifyError && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold flex items-center gap-2" role="alert">
              <AlertCircle className="w-4 h-4" />
              <span>{verifyError}</span>
            </div>
          )}

          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Audit Timeline & Event Stream</h3>
            <p className="text-xs text-slate-400">
              Immutable append-only ledger of platform governance actions, authentication events, and document updates.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
