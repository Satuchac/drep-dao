'use client';

import { useEffect, useState } from 'react';
import { EXPLORERS } from '@drep-dao/shared';
import { configApi, meApi, type PublicConfig } from './api';

let cached: PublicConfig | null = null;
let inflight: Promise<PublicConfig> | null = null;

/**
 * The effective config = the public platform config, with the logged-in member's
 * personal explorer preference (§20) layered on top when set. Cached for the session;
 * call invalidateConfig() after the user changes their preference.
 */
export function loadConfig(): Promise<PublicConfig> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = (async () => {
      const base = await configApi.get();
      let merged = base;
      try {
        const pref = await meApi.preferences(); // 401 when logged out → keep platform default
        if (pref?.explorer) merged = { ...base, explorer: pref.explorer, explorerCustomTxUrl: pref.explorerCustomTxUrl ?? base.explorerCustomTxUrl };
      } catch {
        /* not logged in / no preference → platform default */
      }
      cached = merged;
      return merged;
    })();
  }
  return inflight;
}

/** Drop the cached config so the next read reflects a just-saved preference. */
export function invalidateConfig() {
  cached = null;
  inflight = null;
}

const fill = (tpl: string, hash: string, address = '') => tpl.replace('{hash}', hash).replace('{address}', address);

export function txUrl(cfg: PublicConfig, hash: string): string {
  if (cfg.explorer === 'custom' && cfg.explorerCustomTxUrl) return fill(cfg.explorerCustomTxUrl, hash);
  const ex = EXPLORERS[cfg.explorer] ?? EXPLORERS.cardanoscan;
  return fill(ex.tx[cfg.network] ?? ex.tx.Preprod, hash);
}
export function addressUrl(cfg: PublicConfig, address: string): string {
  const ex = EXPLORERS[cfg.explorer] ?? EXPLORERS.cardanoscan;
  return fill(ex.address[cfg.network] ?? ex.address.Preprod, '', address);
}

/** React hook: the cached config + ready-made link builders (configurable explorer). */
export function useExplorer() {
  const [cfg, setCfg] = useState<PublicConfig | null>(cached);
  useEffect(() => {
    let alive = true;
    loadConfig().then((c) => alive && setCfg(c)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return {
    cfg,
    txUrl: (hash: string) => (cfg ? txUrl(cfg, hash) : '#'),
    addressUrl: (address: string) => (cfg ? addressUrl(cfg, address) : '#'),
  };
}
