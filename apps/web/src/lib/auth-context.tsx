'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authApi, type UserProfile } from './api';
import { getStakeAddress, listInjectedWallets, utf8ToHex, type Cip30WalletEntry } from './cip30';

interface AuthState {
  profile: UserProfile | null;
  loading: boolean; // restoring session on mount
  wallets: Cip30WalletEntry[];
  login: (entry: Cip30WalletEntry) => Promise<void>;
  logout: () => Promise<void>;
  refreshWallets: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [wallets, setWallets] = useState<Cip30WalletEntry[]>([]);

  const refreshWallets = useCallback(() => setWallets(listInjectedWallets()), []);

  // Restore an existing session (cookie) and enumerate wallets on mount.
  useEffect(() => {
    refreshWallets();
    authApi
      .me()
      .then(setProfile)
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [refreshWallets]);

  const login = useCallback(async (entry: Cip30WalletEntry) => {
    // 1) connect + resolve stake address → 2) request nonce →
    // 3) sign the exact message → 4) verify and receive the session cookie
    const { api, stakeHex, stakeAddress } = await getStakeAddress(entry);
    const { message } = await authApi.nonce(stakeAddress);
    const sig = await api.signData(stakeHex, utf8ToHex(message));
    const result = await authApi.verify({
      stakeAddress,
      signature: sig.signature,
      key: sig.key,
    });
    setProfile(result);
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider value={{ profile, loading, wallets, login, logout, refreshWallets }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
