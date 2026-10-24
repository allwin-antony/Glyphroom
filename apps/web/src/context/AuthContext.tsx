import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { api, setCsrfToken, getCsrfToken, ApiError } from '../lib/api.js';

export type UserRole = 'admin' | 'moderator' | 'author' | 'reader';

export interface AuthUser {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  role: UserRole;
  ssoProvider?: string | null;
}

export interface AuthContextValue {
  user: AuthUser | null;
  csrfToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<AuthUser | null>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeUser(raw: any): AuthUser {
  const id = raw.id || raw.userId;
  return {
    id,
    userId: id,
    email: raw.email,
    fullName: raw.fullName,
    role: raw.role,
    ssoProvider: raw.ssoProvider ?? null,
  };
}

export interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [csrfToken, setCsrfTokenState] = useState<string | null>(getCsrfToken());
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const applySession = useCallback((rawUser: any, token?: string | null) => {
    const normalized = normalizeUser(rawUser);
    setUser(normalized);
    if (token) {
      setCsrfTokenState(token);
      setCsrfToken(token);
    }
    return normalized;
  }, []);

  const clearSession = useCallback(() => {
    setUser(null);
    setCsrfTokenState(null);
    setCsrfToken(null);
  }, []);

  const refreshSession = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const res = await api.get<{ user: any; csrfToken?: string }>('/auth/me');
      if (res?.user) {
        return applySession(res.user, res.csrfToken);
      }
      clearSession();
      return null;
    } catch {
      clearSession();
      return null;
    }
  }, [applySession, clearSession]);

  // Session bootstrap on application mount
  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      try {
        setIsLoading(true);
        const res = await api.get<{ user: any; csrfToken?: string }>('/auth/me');
        if (isMounted && res?.user) {
          applySession(res.user, res.csrfToken);
        }
      } catch {
        if (isMounted) {
          clearSession();
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    bootstrap();

    return () => {
      isMounted = false;
    };
  }, [applySession, clearSession]);

  const login = useCallback(
    async (email: string, password: string): Promise<AuthUser> => {
      const res = await api.post<{ user: any; csrfToken: string }>('/auth/login', {
        email: email.trim().toLowerCase(),
        password,
      });

      if (!res?.user) {
        throw new ApiError(500, 'Internal Server Error', null, 'Invalid server response during authentication');
      }

      return applySession(res.user, res.csrfToken);
    },
    [applySession]
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      // Ignore network errors on logout to allow local teardown
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      csrfToken,
      isLoading,
      isAuthenticated: !!user,
      login,
      logout,
      refreshSession,
    }),
    [user, csrfToken, isLoading, login, logout, refreshSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
