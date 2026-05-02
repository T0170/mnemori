import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { normalizeRole, can as checkCan, getRoleName } from './permissions';

const AuthContext = createContext(null);
const AUTH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function AuthProvider({ children }) {
  const [identity, setIdentity] = useState(() => {
    try {
      const stored = localStorage.getItem('mnemori:identity');
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      if (parsed.lastRefresh && Date.now() - parsed.lastRefresh > AUTH_MAX_AGE_MS) {
        localStorage.removeItem('mnemori:identity');
        return null;
      }
      return parsed;
    } catch (_) {
      return null;
    }
  });

  const signIn = useCallback(async () => {
    const result = await window.api.auth.signIn();
    if (result.ok) {
      const user = { ...result.user, lastRefresh: Date.now() };
      setIdentity(user);
      localStorage.setItem('mnemori:identity', JSON.stringify(user));
    }
    return result;
  }, []);

  const signOut = useCallback(async () => {
    await window.api.auth.signOut();
    setIdentity(null);
    localStorage.removeItem('mnemori:identity');
  }, []);

  const role = identity?.role || 'owner';
  const normalized = normalizeRole(role);
  const can = useCallback((capability) => checkCan(role, capability), [role]);

  const value = useMemo(() => ({
    isSignedIn: !!identity,
    user: identity,
    role: normalized,
    roleName: getRoleName(role),
    can,
    signIn,
    signOut,
  }), [identity, normalized, role, can, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
