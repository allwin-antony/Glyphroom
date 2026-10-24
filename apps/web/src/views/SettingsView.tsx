import React from 'react';
import { useAuth } from '../context/AuthContext.js';

export const SettingsView: React.FC = () => {
  const { user } = useAuth();

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Personal Settings</h1>
        <p className="text-xs text-slate-400 mt-1">
          Manage your personal profile and developer access credentials.
        </p>
      </div>

      <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
        <h2 className="text-sm font-bold text-slate-200">User Identity</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="text-slate-500 block mb-1">Full Name</label>
            <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 font-medium">
              {user?.fullName || 'Not specified'}
            </div>
          </div>
          <div>
            <label className="text-slate-500 block mb-1">Email Address</label>
            <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 font-medium">
              {user?.email || 'Not specified'}
            </div>
          </div>
          <div>
            <label className="text-slate-500 block mb-1">Role Permission</label>
            <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sky-400 font-semibold capitalize">
              {user?.role || 'reader'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
