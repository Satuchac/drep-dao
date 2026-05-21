'use client';

const API_BASE = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1`;

export interface UserProfile {
  user: {
    id: string;
    stakeAddress: string;
    stakeKeyHash: string;
    displayName: string | null;
    createdAt: string;
  };
  roles: string[];
  drep: { status: string; admittedAt: string | null } | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include', // send/receive the session cookie
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.message ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const authApi = {
  nonce: (stakeAddress: string) =>
    request<{ message: string; expiresInSeconds: number }>('/auth/nonce', {
      method: 'POST',
      body: JSON.stringify({ stakeAddress }),
    }),

  verify: (body: { stakeAddress: string; signature: string; key: string }) =>
    request<UserProfile>('/auth/verify', { method: 'POST', body: JSON.stringify(body) }),

  me: () => request<UserProfile>('/auth/me'),

  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
};
