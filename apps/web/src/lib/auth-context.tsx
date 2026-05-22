'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { authApi, type UserProfile } from './api';
import {
  detectDRepId,
  getDRepKeyHex,
  getStakeAddress,
  listInjectedWallets,
  utf8ToHex,
  type Cip30Api,
  type Cip30WalletEntry,
} from './cip30';

interface AuthState {
  profile: UserProfile | null;
  loading: boolean; // restoring session on mount
  wallets: Cip30WalletEntry[];
  login: (entry: Cip30WalletEntry) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshWallets: () => void;
  /** Best-effort DRep ID from the connected wallet (CIP-95); null if unavailable. */
  detectDRepId: () => Promise<string | null>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [wallets, setWallets] = useState<Cip30WalletEntry[]>([]);
  const walletApiRef = useRef<Cip30Api | null>(null);

  const refreshWallets = useCallback(() => setWallets(listInjectedWallets()), []);

  const refresh = useCallback(async () => {
    try {
      setProfile(await authApi.me());
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    refreshWallets();
    void refresh().finally(() => setLoading(false));
  }, [refreshWallets, refresh]);

  const login = useCallback(async (entry: Cip30WalletEntry) => {
    const { api, stakeHex, stakeAddress } = await getStakeAddress(entry);
    walletApiRef.current = api; // keep for CIP-95 DRep detection
    const { message } = await authApi.nonce(stakeAddress);
    const sig = await api.signData(stakeHex, utf8ToHex(message));
    const drepKeyHex = await getDRepKeyHex(api); // CIP-95 → board/DRep recognition
    setProfile(
      await authApi.verify({ stakeAddress, signature: sig.signature, key: sig.key, drepKeyHex }),
    );
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    walletApiRef.current = null;
    setProfile(null);
  }, []);

  const detect = useCallback(async () => {
    if (!walletApiRef.current) return null;
    return detectDRepId(walletApiRef.current);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        profile,
        loading,
        wallets,
        login,
        logout,
        refresh,
        refreshWallets,
        detectDRepId: detect,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
