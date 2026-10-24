import React from 'react';
import { Navigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.js';
import { ShieldAlert, ArrowLeft, Loader2 } from 'lucide-react';

export interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: Array<'admin' | 'moderator' | 'author' | 'reader'>;
  redirectTo?: string;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles,
  redirectTo = '/sign-in',
}) => {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  // 1. Loading state during session bootstrap (GET /api/v1/auth/me)
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-slate-100">
        <div className="flex items-center gap-3 p-6 rounded-xl bg-slate-900 border border-slate-800 shadow-xl">
          <Loader2 className="w-6 h-6 text-sky-400 animate-spin" />
          <span className="text-sm font-medium text-slate-300">Authenticating session...</span>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated state -> redirect to /sign-in with return path
  if (!isAuthenticated || !user) {
    return <Navigate to={redirectTo} state={{ from: location }} replace />;
  }

  // 3. Role authorization check
  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-slate-100 p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center shadow-2xl">
          <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-rose-500/10 flex items-center justify-center border border-rose-500/20">
            <ShieldAlert className="w-8 h-8 text-rose-400" />
          </div>
          <h1 className="text-xl font-bold text-slate-100 mb-2">Access Restricted</h1>
          <p className="text-sm text-slate-400 mb-6 leading-relaxed">
            You do not have the required permissions to view this resource.
          </p>

          <div className="bg-slate-950/60 rounded-lg p-4 mb-6 border border-slate-800/80 text-left text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-500">Your Current Role:</span>
              <span className="font-semibold text-amber-400 capitalize">{user.role}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Required Roles:</span>
              <span className="font-semibold text-slate-300 capitalize">{allowedRoles.join(' or ')}</span>
            </div>
          </div>

          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors border border-slate-700"
          >
            <ArrowLeft className="w-4 h-4" /> Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
