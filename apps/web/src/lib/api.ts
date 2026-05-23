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
  /** On-chain DRep identity — source of truth for the DREP role (verified at login). */
  onchainDrep: { registered: boolean; drepId: string | null };
  /** DAO membership (admission) status — separate from on-chain registration. */
  daoMembership: { status: string; admittedAt: string | null } | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include', // send/receive the session cookie
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      // Never hang forever (e.g. API unreachable) — fail fast so the UI can recover.
      signal: init?.signal ?? AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error(`Cannot reach the API at ${API_BASE}. Is it running?`);
  }
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

  verify: (body: { stakeAddress: string; signature: string; key: string; drepKeyHex?: string }) =>
    request<UserProfile>('/auth/verify', { method: 'POST', body: JSON.stringify(body) }),

  me: () => request<UserProfile>('/auth/me'),

  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
};

export interface DrepApplicationInput {
  // drep_id is NOT supplied by the client — the backend derives it from the
  // wallet's CIP-95 DRep key and verifies on-chain registration.
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
  socials: Record<string, string> | null;
  contact: Record<string, string> | null;
  subcategoryIds: string[];
  kycOptin: boolean;
  callsOptin: boolean;
  admissionCallOptin: boolean;
  yes: number;
  no: number;
  threshold: number;
  admissionVotesReceived: { choice: string; feedback: string | null; voterName: string }[];
  anchorTxHash: string | null; // on-chain anchor of the admission decision (§C)
}

export interface DaoMember {
  drepId: string;
  displayName: string;
  isBoard: boolean;
  votingPowerAda: number; // on-chain DRep voting power (vote delegation), in ADA
  delegators: number; // accounts that delegated their vote to this DRep
  merit: number;
  basePower: number;
  meritMultiplier: number;
  adjustedPower: number; // log10(votingPowerAda) × (1 + merit/200)
  since: string | null; // board install date (board) or board-approval date (DAO member)
}

export const daoApi = {
  members: () => request<DaoMember[]>('/dao/members'),
  experts: () => request<DaoExpert[]>('/dao/experts'),
};

export interface GovParam {
  key: string;
  value: number | string;
  default: number | string;
  type: string;
}

export const governanceApi = {
  list: () => request<GovParam[]>('/admin/governance'),
  update: (key: string, value: number | string) =>
    request<{ key: string; value: number | string }>('/admin/governance', {
      method: 'PATCH',
      body: JSON.stringify({ key, value }),
    }),
};

export interface PendingApplication {
  drepId: string;
  drepIdOnchain: string;
  displayName: string | null;
  stakeAddress: string;
  bio: string | null;
  subcategoryIds: string[];
  contact: Record<string, string> | null;
  kycOptin: boolean;
  callsOptin: boolean;
  admissionCallOptin: boolean;
  yes: number;
  no: number;
  threshold: number;
  myVote: { choice: string; feedback: string | null } | null;
}

export interface RemovalVoteView {
  choice: string;
  rationale: string | null;
  voterName: string;
}
export interface MyRemoval {
  reason: string | null;
  proposedByName: string;
  yes: number;
  no: number;
  threshold: number;
  votes: RemovalVoteView[];
}
export interface ActiveRemoval extends MyRemoval {
  id: string;
  targetDrepId: string;
  targetName: string;
  myVote: string | null;
}
export interface RemovableMember {
  drepId: string;
  displayName: string;
  drepIdOnchain: string;
}

export const drepApi = {
  mine: () => request<MyDrep | null>('/me/drep'),
  apply: (input: DrepApplicationInput) =>
    request<MyDrep>('/me/drep-application', { method: 'POST', body: JSON.stringify(input) }),
  update: (input: Partial<DrepApplicationInput>) =>
    request<MyDrep>('/me/drep', { method: 'PATCH', body: JSON.stringify(input) }),
  myRemoval: () => request<MyRemoval | null>('/me/removal'),
};

export const removalApi = {
  list: () => request<ActiveRemoval[]>('/admin/removals'),
  removableMembers: () => request<RemovableMember[]>('/admin/removals/removable-members'),
  propose: (targetDrepId: string, reason?: string) =>
    request<{ id: string }>('/admin/removals', {
      method: 'POST',
      body: JSON.stringify({ targetDrepId, reason }),
    }),
  vote: (id: string, choice: 'YES' | 'NO', rationale: string) =>
    request<{ status: string; yes: number; no: number; threshold: number }>(`/admin/removals/${id}/vote`, {
      method: 'POST',
      body: JSON.stringify({ choice, rationale }),
    }),
};

export const boardApi = {
  listApplications: () => request<PendingApplication[]>('/admin/drep-applications'),
  vote: (
    drepId: string,
    body: { choice: 'YES' | 'NO'; feedback: string; signature?: string; signingKey?: string; ts?: string },
  ) =>
    request<{ status: string; yes: number; no: number; threshold: number; anchorTxHash: string | null }>(
      `/admin/drep-applications/${drepId}/vote`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
};

export interface ExpertApplicationInput {
  displayName: string;
  bio?: string;
  subcategoryIds?: string[];
}
export interface MyExpert {
  id: string;
  displayName: string;
  bio: string | null;
  subcategoryIds: string[];
  approvedByBoard: boolean;
}
export interface ExpertApplication {
  id: string;
  displayName: string;
  bio: string | null;
  stakeAddress: string;
  subcategoryIds: string[];
}
export interface DaoExpert {
  id: string;
  displayName: string;
  bio: string | null;
  subcategoryIds: string[];
}

export const expertApi = {
  mine: () => request<MyExpert | null>('/me/expert'),
  apply: (input: ExpertApplicationInput) =>
    request<MyExpert>('/me/expert-application', { method: 'POST', body: JSON.stringify(input) }),
};

export const boardExpertsApi = {
  applications: () => request<ExpertApplication[]>('/admin/experts/applications'),
  approve: (id: string) => request<MyExpert>(`/admin/experts/${id}/approve`, { method: 'POST' }),
  reject: (id: string) => request<{ ok: boolean }>(`/admin/experts/${id}/reject`, { method: 'POST' }),
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
