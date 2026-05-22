'use client';

const API_BASE = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/sysadmin`;

export interface AdminMe {
  adminId: string;
  username: string;
  email: string;
}

export interface AdminHealth {
  database: string;
  redis: string;
  genesisApproved: boolean;
  maintenanceMode: boolean;
  paused: boolean;
  boardCount: number;
  adminCount: number;
  time: string;
}

export interface AdminRow {
  id: string;
  username: string;
  email: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuditRow {
  action: string;
  target: string | null;
  adminUsername: string | null;
  ip: string | null;
  occurredAt: string;
}

export interface GenesisState {
  boardCount: number;
  maxBoard: number;
  canAddMore: boolean;
  board: { displayName: string; drepId: string }[];
  genesisApprovedAt: string | null;
  maintenanceMode: boolean;
  paused: boolean;
  proposedBoard: { name: string; drep_id: string }[] | null;
}

export type LoginResult =
  | { status: 'ok'; admin: AdminMe }
  | { status: '2fa_required'; pendingToken: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      signal: init?.signal ?? AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error(`Cannot reach the admin API at ${API_BASE}.`);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.message ?? detail;
    } catch {
      /* non-JSON */
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const adminApi = {
  login: (username: string, password: string) =>
    request<LoginResult>('/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login2fa: (pendingToken: string, code: string) =>
    request<{ status: 'ok'; admin: AdminMe }>('/login/2fa', {
      method: 'POST',
      body: JSON.stringify({ pendingToken, code }),
    }),
  loginRecovery: (pendingToken: string, code: string) =>
    request<{ status: 'ok'; admin: AdminMe }>('/login/recovery', {
      method: 'POST',
      body: JSON.stringify({ pendingToken, code }),
    }),
  logout: () => request<{ ok: boolean }>('/logout', { method: 'POST' }),
  me: () => request<AdminMe>('/me'),
  health: () => request<AdminHealth>('/health'),
  admins: () => request<AdminRow[]>('/admins'),
  auditLog: () => request<AuditRow[]>('/audit-log'),
  accounts: {
    invite: (username: string, email: string) =>
      request<{ token: string; expiresAt: string }>('/admins/invite', {
        method: 'POST',
        body: JSON.stringify({ username, email }),
      }),
    accept: (token: string, password: string) =>
      request<{
        adminId: string;
        totpUri: string;
        totpBase32: string;
        totpQrDataUrl: string;
        recoveryCodes: string[];
      }>('/admins/accept-invite', { method: 'POST', body: JSON.stringify({ token, password }) }),
    remove: (id: string) => request<{ ok: boolean }>(`/admins/${id}/remove`, { method: 'POST' }),
    disable: (id: string) => request<{ ok: boolean }>(`/admins/${id}/disable`, { method: 'POST' }),
  },
  genesis: {
    state: () => request<GenesisState>('/genesis'),
    upload: (genesis: unknown) =>
      request<{ proposedBoard: unknown[] }>('/genesis/upload', {
        method: 'POST',
        body: JSON.stringify({ genesis }),
      }),
    approve: () =>
      request<{ seated: number; boardCount: number; maxBoard: number }>('/genesis/approve', {
        method: 'POST',
      }),
    reject: () => request<{ ok: boolean }>('/genesis/reject', { method: 'POST' }),
  },
};
