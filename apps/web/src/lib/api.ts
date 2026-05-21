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

export interface DrepApplicationInput {
  drepIdOnchain: string;
  displayName?: string;
  bio?: string;
  subcategoryIds?: string[];
  socials?: Record<string, string>;
  contact?: Record<string, string>;
  kycOptin?: boolean;
  callsOptin?: boolean;
  admissionCallOptin?: boolean;
}

export interface MyDrep {
  id: string;
  status: string;
  drepIdOnchain: string;
  bio: string | null;
  subcategoryIds: string[];
  admissionVotesReceived: { choice: string; feedback: string | null }[];
}

export interface PendingApplication {
  drepId: string;
  drepIdOnchain: string;
  displayName: string | null;
  stakeAddress: string;
  bio: string | null;
  subcategoryIds: string[];
  yes: number;
  no: number;
  threshold: number;
}

export const drepApi = {
  mine: () => request<MyDrep | null>('/me/drep'),
  apply: (input: DrepApplicationInput) =>
    request<MyDrep>('/me/drep-application', { method: 'POST', body: JSON.stringify(input) }),
  update: (input: Partial<DrepApplicationInput>) =>
    request<MyDrep>('/me/drep', { method: 'PATCH', body: JSON.stringify(input) }),
};

export const boardApi = {
  listApplications: () => request<PendingApplication[]>('/admin/drep-applications'),
  vote: (drepId: string, body: { choice: 'YES' | 'NO'; feedback?: string }) =>
    request<{ status: string; yes: number; no: number; threshold: number }>(
      `/admin/drep-applications/${drepId}/vote`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
};

export interface RoundCategoryInput {
  name: string;
  allocatedAda: number;
  minAda?: number;
  maxAda?: number;
  description?: string;
}
export interface RoundScheduleInput {
  stageKey: string;
  startsAt: string;
  endsAt: string;
}
export interface CreateRoundInput {
  name?: string;
  budgetAda: number;
  rewardsPoolAda: number;
  categories: RoundCategoryInput[];
  schedule?: RoundScheduleInput[];
}
export interface RoundSummary {
  id: string;
  number: number;
  name: string | null;
  status: string;
  budgetAda: number;
  rewardsPoolAda: number;
  categoryCount: number;
  eligibleCount: number;
  proposalCount: number;
}
export interface RoundDetail extends RoundSummary {
  multisigAddress: string;
  categories: {
    id: string;
    name: string;
    type: string;
    allocatedAda: number;
    minAda: number | null;
    maxAda: number | null;
    description: string | null;
  }[];
  schedule: { stageKey: string; startsAt: string; endsAt: string }[];
}

export const roundsApi = {
  list: () => request<RoundSummary[]>('/rounds'),
  get: (id: string) => request<RoundDetail>(`/rounds/${id}`),
};

export const boardRoundsApi = {
  create: (input: CreateRoundInput) =>
    request<RoundDetail>('/admin/rounds', { method: 'POST', body: JSON.stringify(input) }),
  startStage: (id: string, stage: string) =>
    request<RoundDetail>(`/admin/rounds/${id}/start-stage/${stage}`, { method: 'POST' }),
};

export interface ProposalMilestoneInput {
  description: string;
  amountAda: number;
}
export interface CreateProposalInput {
  roundId: string;
  categoryId: string;
  title: string;
  contentMd: string;
  isCommercial: boolean;
  requestedAmountAda: number;
  milestones: ProposalMilestoneInput[];
}
export interface ProposalSummary {
  id: string;
  type: string;
  status: string;
  stage: string | null;
  title: string;
  categoryName: string | null;
  roundId: string | null;
  isCommercial: boolean | null;
  requestedAmountAda: number;
}
export interface ProposalDetail extends ProposalSummary {
  contentMd: string;
  submissionFeeAda: number;
  submissionFeeTxHash: string | null;
  milestones: { id: string; idx: number; description: string; amountAda: number; status: string }[];
}

export const proposalsApi = {
  byRound: (roundId: string) => request<ProposalSummary[]>(`/rounds/${roundId}/proposals`),
  get: (id: string) => request<ProposalDetail>(`/proposals/${id}`),
  mine: () => request<ProposalSummary[]>('/me/proposals'),
  create: (input: CreateProposalInput) =>
    request<ProposalDetail>('/proposals', { method: 'POST', body: JSON.stringify(input) }),
  submit: (id: string, submissionFeeTxHash: string) =>
    request<ProposalDetail>(`/proposals/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify({ submissionFeeTxHash }),
    }),
};

export interface FilterAssignment {
  proposalId: string;
  title: string;
  myVote: string | null;
}
export interface FilterResult {
  reviewers: number;
  yes: number;
  no: number;
  abstain: number;
  threshold: number;
  status: string;
  stage: string | null;
}

export const filteringApi = {
  myAssignments: () => request<FilterAssignment[]>('/me/assignments/filter'),
  result: (proposalId: string) => request<FilterResult>(`/proposals/${proposalId}/filter-result`),
  vote: (proposalId: string, choice: 'YES' | 'NO' | 'ABSTAIN', rationale?: string) =>
    request<FilterResult>(`/proposals/${proposalId}/filter-vote`, {
      method: 'POST',
      body: JSON.stringify({ choice, rationale }),
    }),
};

// Board: confirm fee / draw reviewers / open D&V voting / finalize.
export const boardProposalsApi = {
  confirmFee: (id: string) =>
    request<ProposalDetail>(`/admin/proposals/${id}/confirm-fee`, { method: 'POST' }),
  drawReviewers: (id: string) =>
    request<FilterResult>(`/admin/proposals/${id}/draw-reviewers`, { method: 'POST' }),
  openDvVote: (id: string) =>
    request<DvResult>(`/admin/proposals/${id}/open-dv-vote`, { method: 'POST' }),
  finalizeDv: (id: string) =>
    request<DvResult>(`/admin/proposals/${id}/finalize-dv`, { method: 'POST' }),
};

export interface DvResult {
  open: boolean;
  eligible?: number;
  cast?: number;
  yesPower?: number;
  abstainPower?: number;
  totalPower?: number;
  denominator?: number;
  ratioPct?: number;
  thresholdPct?: number;
  approved?: boolean;
  status?: string;
  stage?: string | null;
}

export const dvApi = {
  result: (id: string) => request<DvResult>(`/proposals/${id}/dv-result`),
  vote: (id: string, choice: 'YES' | 'NO' | 'ABSTAIN', rationale: string) =>
    request<DvResult>(`/proposals/${id}/dv-vote`, {
      method: 'POST',
      body: JSON.stringify({ choice, rationale }),
    }),
};
