import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ShieldCheck, AlertCircle, KeyRound, ArrowRight, Loader2, Lock, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { ApiError } from '../lib/api.js';

interface DemoUser {
  name: string;
  email: string;
  role: string;
  badgeColor: string;
}

const DEMO_ACCOUNTS: DemoUser[] = [
  { name: 'Arjun', email: 'arjun.maintainer@enterprise.internal', role: 'Maintainer', badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  { name: 'Priya', email: 'priya.sharma@enterprise.internal', role: 'Author', badgeColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
  { name: 'Rahul', email: 'rahul.viewer@enterprise.internal', role: 'Viewer', badgeColor: 'bg-sky-500/20 text-sky-300 border-sky-500/30' },
  { name: 'Marcus', email: 'marcus.chen@enterprise.internal', role: 'Moderator', badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
];

export const SignInView: React.FC = () => {
  const { login, isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Redirection target after successful login
  const from = (location.state as any)?.from?.pathname || '/';

  useEffect(() => {
    if (isAuthenticated && !authLoading) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, authLoading, navigate, from]);

  const handleQuickFillAdmin = () => {
    setEmail('admin@enterprise-blogger.local');
    setPassword('admin2026!');
    setErrorMessage(null);
  };

  const handleSelectDemoUser = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('admin2026!');
    setErrorMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!email || !password) {
      setErrorMessage('Please enter both email and password.');
      return;
    }

    try {
      setIsSubmitting(true);
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setErrorMessage('Invalid credentials or account inactive. Please check email and password.');
        } else if (err.status === 400) {
          setErrorMessage('Validation error: Please provide a valid email format.');
        } else {
          setErrorMessage(err.message || 'Authentication failed. Please contact your system administrator.');
        }
      } else {
        setErrorMessage('Failed to connect to the authentication service. Please verify server status.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 selection:bg-indigo-600 selection:text-white">
      {/* Background radial glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950 pointer-events-none" />

      <div className="relative w-full max-w-md">
        {/* Header Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 mb-4 shadow-lg shadow-indigo-500/10">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Glyphroom
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Sign in to your account
          </p>
        </div>

        {/* Main Sign-In Card */}
        <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl shadow-black/50">
          
          {/* Quick-Fill Break-Glass Helper */}
          <div className="mb-4 p-3.5 bg-slate-800/60 border border-slate-700/60 rounded-xl flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 text-amber-400">
                <KeyRound className="w-4 h-4" />
              </div>
              <div className="truncate">
                <div className="text-xs font-semibold text-slate-200">Break-Glass Admin</div>
                <div className="text-[11px] text-slate-400 font-mono truncate">admin@enterprise-blogger.local</div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleQuickFillAdmin}
              className="px-2.5 py-1.5 text-xs font-medium text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-colors shrink-0"
            >
              Fill
            </button>
          </div>

          {/* Seeded Test Accounts Quick Selector */}
          <div className="mb-6 p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 mb-2">
              <Users className="w-3.5 h-3.5 text-indigo-400" />
              <span>Quick Test Accounts (Spaces & Roles)</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => handleSelectDemoUser(acc.email)}
                  className={`text-left p-2 rounded-lg border text-xs transition-colors hover:brightness-125 flex flex-col justify-between ${acc.badgeColor}`}
                >
                  <span className="font-semibold text-slate-200">{acc.name}</span>
                  <span className="text-[10px] opacity-80">{acc.role}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Error Alert Banner */}
          {errorMessage && (
            <div
              role="alert"
              className="mb-6 p-4 rounded-xl bg-rose-950/50 border border-rose-500/30 text-rose-200 flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-200"
            >
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="text-sm font-medium leading-relaxed">{errorMessage}</div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-slate-300 mb-1.5">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="block text-xs font-medium text-slate-300">
                  Password
                </label>
              </div>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-2 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white text-sm font-semibold rounded-xl shadow-lg shadow-indigo-600/25 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Authenticating...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Footer note */}
          <div className="mt-6 pt-5 border-t border-slate-800 text-center">
            <div className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <Lock className="w-3.5 h-3.5" />
              <span>TLS 1.3 & HMAC-SHA256 Protected Session</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignInView;
