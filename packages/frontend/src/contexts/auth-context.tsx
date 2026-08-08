import { createContext, useContext } from 'react';

import { permissionMatrix } from '@/data/mock-data';
import type { Employee, Role, User } from '@/types';

interface AuthState {
  user: User | null;
  employee: Employee | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Data source mode: 'mock' when using local demo data, 'api' when signed in via the backend. */
  mode: 'mock' | 'api';
}

export interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  hasPermission: (capability: keyof (typeof permissionMatrix)[Role]) => boolean;
  canViewEmployee: (employee: Employee) => boolean;
  /** Merge a partial update into the cached employee state (e.g. after self-edit). */
  updateEmployee: (partial: Partial<Employee>) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
