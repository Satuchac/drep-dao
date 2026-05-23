'use client';

import { useEffect, useState } from 'react';
import { EXPLORERS } from '@drep-dao/shared';
import { configApi, type PublicConfig } from './api';

let cached: PublicConfig | null = null;
let inflight: Promise<PublicConfig> | null = null;

/** Fetch the public config once (explorer, network, fee address) and cache it. */
export function loadConfig(): Promise<PublicConfig> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) inflight = configApi.get().then((c) => ((cached = c), c));
  return inflight;
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
