import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api, enableDemoMode, isDemoMode, type User } from './api';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const demoUser: User = {
    id: 0,
    email: 'admin@mspi.io',
    fullName: 'Admin (Demo)',
    roleId: 1,
    roleName: 'Admin',
  };

  const refreshUser = useCallback(async () => {
    try {
      const u = await api.me();
      setUser(u);
    } catch {
      if (isDemoMode()) {
        setUser(demoUser);
      } else {
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const { user } = await api.login(email, password);
      setUser(user);
    } catch (err) {
      if (isDemoMode()) {
        setUser(demoUser);
        return;
      }
      throw err;
    }
  }, []);

  const signup = useCallback(async (email: string, password: string, fullName: string) => {
    try {
      const { user } = await api.signup(email, password, fullName);
      setUser(user);
    } catch (err) {
      if (isDemoMode()) {
        setUser(demoUser);
        return;
      }
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
