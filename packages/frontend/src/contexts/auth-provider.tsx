import { useEffect, useCallback, useMemo, useState, type ReactNode } from 'react';

import { AuthContext, type AuthContextValue } from '@/contexts/auth-context';
import { authStorage } from '@/lib/auth-storage';
import { authRepo, employeeRepo } from '@/lib/api/repositories';
import { registerSessionExpiredHandler } from '@/lib/api-client';
import { isRealBackend, mapRole } from '@/data/data-layer';
import { employees, permissionMatrix } from '@/data/mock-data';
import type { Employee, Role, User } from '@/types';

const STORAGE_KEY = 'elms-auth-user';

/** Build a frontend User from a backend login response user object. */
function toUser(apiUser: {
  id: string;
  email: string;
  role: string;
  employeeId: string | null;
  status?: string;
}): User {
  return {
    id: apiUser.id,
    email: apiUser.email,
    role: mapRole(apiUser.role),
    status: apiUser.status === 'deactivated' ? 'deactivated' : 'active',
    employeeId: apiUser.employeeId ?? undefined,
  };
}

/** Load the current user's own Employee profile from the real backend. */
async function fetchOwnEmployee(user: User): Promise<Employee | null> {
  if (!user.employeeId) return null;
  try {
    const emp = await employeeRepo.get(user.employeeId);
    return emp;
  } catch (err) {
    console.warn('[auth] Could not load own employee profile:', err);
    return null;
  }
}

interface AuthState {
  user: User | null;
  employee: Employee | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Data source mode: 'mock' when using local demo data, 'api' when signed in via the backend. */
  mode: 'mock' | 'api';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    employee: null,
    isAuthenticated: false,
    isLoading: true,
    mode: 'mock',
  });

  // When the API client can no longer refresh an expired session, clear the
  // auth state so ProtectedRoute redirects the user to the login page instead of
  // silently showing stale/mock data.
  useEffect(() => {
    registerSessionExpiredHandler(() => {
      authStorage.clear();
      setState((s) => ({
        ...s,
        user: null,
        employee: null,
        isAuthenticated: false,
      }));
    });
    return () => registerSessionExpiredHandler(null);
  }, []);

  // Restore session on mount
  useEffect(() => {
    const restore = async () => {
      try {
        if (isRealBackend()) {
          // Real mode: tokens live in memory only and do not survive reloads.
          // If a session is already in memory, restore it; otherwise silently
          // refresh via the httpOnly refresh-token cookie.
          const token = authStorage.getAccessToken();
          if (token) {
            const storedUser = authStorage.getSessionUser<User>();
            if (storedUser) {
              const employee = await fetchOwnEmployee(storedUser);
              setState({
                user: storedUser,
                employee,
                isAuthenticated: true,
                isLoading: false,
                mode: 'api',
              });
              return;
            }
          }
          try {
            const result = await authRepo.refresh();
            const user = toUser(result.user);
            authStorage.setSession(result.accessToken, user);
            const employee = await fetchOwnEmployee(user);
            setState({
              user,
              employee,
              isAuthenticated: true,
              isLoading: false,
              mode: 'api',
            });
          } catch {
            // No valid refresh cookie — stay signed out.
            setState((s) => ({ ...s, isLoading: false, mode: 'api' }));
          }
          return;
        }

        // Mock mode: restore the demo user from localStorage
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const user = JSON.parse(stored) as User;
          const employee = employees.find((e) => e.id === user.employeeId) ?? null;
          setState({
            user,
            employee,
            isAuthenticated: true,
            isLoading: false,
            mode: 'mock',
          });
          return;
        }
        setState((s) => ({ ...s, isLoading: false, mode: 'mock' }));
      } catch {
        setState((s) => ({ ...s, isLoading: false }));
      }
    };
    void restore();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    if (isRealBackend()) {
      try {
        const result = await authRepo.login(email, password);
        const user = toUser(result.user);
        authStorage.setSession(result.accessToken, user);
        const employee = await fetchOwnEmployee(user);
        setState({ user, employee, isAuthenticated: true, isLoading: false, mode: 'api' });
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Login failed.',
        };
      }
    }

    // Mock mode: the login request is intercepted at the network layer by MSW,
    // which validates credentials against the in-memory store. This keeps the
    // demo credentials out of the production bundle.
    try {
      const result = await authRepo.login(email, password);
      const user = toUser(result.user);
      if (user.status === 'deactivated') {
        return {
          success: false,
          error: 'Your account has been deactivated. Please contact HR.',
        };
      }
      const employee = employees.find((e) => e.id === user.employeeId) ?? null;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      setState({ user, employee, isAuthenticated: true, isLoading: false, mode: 'mock' });
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Login failed.',
      };
    }
  }, []);

  const logout = useCallback(async () => {
    if (isRealBackend()) {
      authStorage.clear();
      // The backend revokes the refresh token from its httpOnly cookie — no
      // token material is sent in the request body.
      try {
        await authRepo.logout();
      } catch {
        // ignore — local logout still proceeds
      }
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    setState({
      user: null,
      employee: null,
      isAuthenticated: false,
      isLoading: false,
      mode: isRealBackend() ? 'api' : 'mock',
    });
  }, []);

  const hasPermission = useCallback(
    (capability: keyof (typeof permissionMatrix)[Role]) => {
      if (!state.user) return false;
      // Guard against a stale/unknown role value (e.g. an outdated session
      // restored from localStorage or an unmapped backend role). Never throw.
      const grants = permissionMatrix[state.user.role];
      if (!grants) return false;
      return grants[capability];
    },
    [state.user],
  );

  const canViewEmployee = useCallback(
    (employee: Employee) => {
      if (!state.user) return false;
      if (state.user.role === 'Admin' || state.user.role === 'HR Manager') return true;
      // Manager sees direct reports + self
      if (employee.id === state.user.employeeId) return true;
      if (state.user.role === 'Manager') {
        return employee.managerId === state.user.employeeId;
      }
      // Employee sees self only
      return employee.id === state.user.employeeId;
    },
    [state.user],
  );

  const updateEmployee = useCallback((partial: Partial<Employee>) => {
    setState((s) => {
      if (!s.employee) return s;
      return { ...s, employee: { ...s.employee, ...partial } };
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      logout,
      hasPermission,
      canViewEmployee,
      updateEmployee,
    }),
    [state, login, logout, hasPermission, canViewEmployee, updateEmployee],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
