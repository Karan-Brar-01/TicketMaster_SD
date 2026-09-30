import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiFetch } from '../api/client';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readUser(): User | null {
  const raw = localStorage.getItem('tm_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem('tm_token')
  );
  const [user, setUser] = useState<User | null>(() => readUser());

  const persist = useCallback((nextUser: User, nextToken: string) => {
    localStorage.setItem('tm_token', nextToken);
    localStorage.setItem('tm_user', JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const { data } = await apiFetch<{ user: User; token: string }>(
        '/api/auth/login',
        { method: 'POST', body: JSON.stringify({ email, password }) }
      );
      persist(data.user, data.token);
    },
    [persist]
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const { data } = await apiFetch<{ user: User; token: string }>(
        '/api/auth/register',
        { method: 'POST', body: JSON.stringify({ name, email, password }) }
      );
      persist(data.user, data.token);
    },
    [persist]
  );

  const logout = useCallback(() => {
    localStorage.removeItem('tm_token');
    localStorage.removeItem('tm_user');
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, token, login, register, logout }),
    [user, token, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth requires AuthProvider');
  return ctx;
}
