import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('auth_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const [rewardFx, setRewardFx] = useState(null);

  const persistUser = useCallback((nextUser) => {
    if (nextUser) {
      localStorage.setItem('auth_user', JSON.stringify(nextUser));
    } else {
      localStorage.removeItem('auth_user');
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      setLoading(false);
      return;
    }
    api.get('/auth/me')
      .then(res => {
        setUser(res.data);
        persistUser(res.data);
      })
      .catch(() => {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [persistUser]);

  const login = useCallback(async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    const { token, user } = res.data;
    localStorage.setItem('auth_token', token);
    persistUser(user);
    setUser(user);
    return user;
  }, [persistUser]);

  const registerGraReward = useCallback(({ amount, balanceAfter }) => {
    const amountNum = Number(amount || 0);
    const balanceNum = Number(balanceAfter);
    if (!Number.isFinite(amountNum) || amountNum === 0) return;

    setUser(prev => {
      if (!prev) return prev;
      const next = {
        ...prev,
        gra_balance: Number.isFinite(balanceNum)
          ? balanceNum
          : Number(prev.gra_balance || 0) + amountNum,
      };
      persistUser(next);
      return next;
    });

    setRewardFx({
      id: Date.now() + Math.random(),
      amount: amountNum,
      balanceAfter: Number.isFinite(balanceNum) ? balanceNum : null,
    });
  }, [persistUser]);

  const logout = useCallback(() => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setUser(null);
    setRewardFx(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, rewardFx, registerGraReward }),
    [user, loading, login, logout, rewardFx, registerGraReward]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
