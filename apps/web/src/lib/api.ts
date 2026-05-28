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
  // 204, or any response with an empty body, yields undefined — calling res.json() on an
  // empty body throws "Unexpected end of JSON input", so parse only when there's a body.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
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
  image: string | null; // CIP-119 on-chain DRep image, else null (generic avatar)
  isBoard: boolean;
  votingPowerAda: number; // on-chain DRep voting power (vote delegation), in ADA
  delegators: number; // accounts that delegated their vote to this DRep
  merit: number;
  basePower: number;
  meritMultiplier: number;
  adjustedPower: number; // log10(votingPowerAda) × (1 + merit/200)
  since: string | null; // board install date (board) or board-approval date (DAO member)
  meetsEntryRequirements: boolean; // §14.1 — still meets the power/delegator minimum (board always true)
}

export interface OnChainProof {
  id: string;
  title: string;
  detail: string;
  kind: string;
  label: number;
  hash: string;
  txHash: string | null;
  createdAt: string;
}

export const daoApi = {
  members: () => request<DaoMember[]>('/dao/members'),
  experts: () => request<DaoExpert[]>('/dao/experts'),
  proofs: () => request<OnChainProof[]>('/dao/proofs'),
};

// §18 — board force-submits anchors recorded but not yet posted on-chain.
export const boardProofsApi = {
  submit: (id: string) =>
    request<{ hash: string; txHash: string | null; submitted: boolean }>(`/admin/proofs/${id}/submit`, { method: 'POST' }),
  submitAll: () =>
    request<{ submitted: number; failed: number; total: number }>('/admin/proofs/submit-all', { method: 'POST' }),
};

export interface WalletStatus {
  hotWallet: { address: string | null; balanceAda: number; configured: boolean };
  treasury: { address: string | null; balanceAda: number; configured: boolean };
}

export interface TreasuryBucket {
  key: string;
  name: string;
  allocatedAda: number;
  spentAda: number;
  remainingAda: number;
  address: string | null;
}
export interface TreasuryOverview {
  treasury: { address: string | null; balanceAda: number; configured: boolean };
  hotWallet: { address: string | null; balanceAda: number; minAda: number };
  buckets: TreasuryBucket[];
  totalAllocatedAda: number;
  totalSpentAda: number;
}
export interface BoardAction {
  id: string;
  kind: string;
  description: string | null;
  amountAda: number | null;
  status: string;
  txHash: string | null;
  approvals: number;
  threshold: number;
  mineApproved: boolean;
  createdAt: string;
}

export const treasuryApi = {
  overview: () => request<TreasuryOverview>('/dao/treasury'),
  boardActions: (history = false) =>
    request<{ count: number; actions: BoardAction[]; history: BoardAction[] }>(`/me/board-actions${history ? '?history=1' : ''}`),
  prepareTopUp: (amountAda: number) =>
    request<{ id: string }>('/admin/treasury/prepare-topup', { method: 'POST', body: JSON.stringify({ amountAda }) }),
  approveAction: (id: string, body: { signature?: string; signingKey?: string; ts?: string }) =>
    request<{ approvals: number; threshold: number; status: string }>(`/admin/board-actions/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export interface GovParam {
  key: string;
  value: number | string | boolean;
  default: number | string | boolean;
  type: string;
  description: string;
}

export const governanceApi = {
  list: () => request<GovParam[]>('/admin/governance'),
  update: (key: string, value: number | string | boolean) =>
    request<{ key: string; value: number | string | boolean }>('/admin/governance', {
      method: 'PATCH',
      body: JSON.stringify({ key, value }),
    }),
  wallets: () => request<WalletStatus>('/admin/governance/wallets'),
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
  status: string; // PENDING_ADMISSION | ADMITTED | REJECTED
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
  status: string; // PENDING | APPROVED (removed) | REJECTED (kept)
  resolvedAt: string | null;
  myVote: string | null;
}
export interface RemovableMember {
  drepId: string;
  displayName: string;
  drepIdOnchain: string;
}

export interface EntryEligibility {
  gatingEnabled: boolean;
  eligible: boolean;
  requirements: { group: 'power' | 'activity'; label: string; met: boolean; detail: string }[];
}

export const drepApi = {
  mine: () => request<MyDrep | null>('/me/drep'),
  apply: (input: DrepApplicationInput) =>
    request<MyDrep>('/me/drep-application', { method: 'POST', body: JSON.stringify(input) }),
  update: (input: Partial<DrepApplicationInput>) =>
    request<MyDrep>('/me/drep', { method: 'PATCH', body: JSON.stringify(input) }),
  myRemoval: () => request<MyRemoval | null>('/me/removal'),
  leaveDao: () => request<{ status: string }>('/me/leave-dao', { method: 'POST' }),
  entryEligibility: () => request<EntryEligibility>('/me/entry-eligibility'),
};

export const removalApi = {
  list: (history = false) => request<ActiveRemoval[]>(`/admin/removals${history ? '?history=1' : ''}`),
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
  listApplications: (history = false) =>
    request<PendingApplication[]>(`/admin/drep-applications${history ? '?history=1' : ''}`),
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
  approved: boolean;
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
  applications: (history = false) =>
    request<ExpertApplication[]>(`/admin/experts/applications${history ? '?history=1' : ''}`),
  approve: (id: string) => request<MyExpert>(`/admin/experts/${id}/approve`, { method: 'POST' }),
  reject: (id: string) => request<{ ok: boolean }>(`/admin/experts/${id}/reject`, { method: 'POST' }),
};

export interface RoundCategoryInput {
  id?: string; // present when editing an existing category (update in place)
  name: string;
  type?: string; // GRANT | RFP
  allocatedAda: number;
  minAda?: number; // min funding request per proposal (§5.2)
  maxAda?: number; // max funding request per proposal (§5.2)
  conditions?: string;
  description?: string;
}
export interface RoundScheduleInput {
  stageKey: string;
  startsAt: string;
  endsAt: string;
}
export interface RoundSettingsInput {
  filterReviewerCount?: number;
  filterApprovalVotes?: number;
  milestoneReviewerCount?: number;
  milestoneApprovalVotes?: number;
  dvApprovalThresholdPct?: number;
  rewardExpertSharePct?: number;
  rewardDvSharePct?: number;
  rewardFixedPct?: number;
  feeCommercialPct?: number;
  feeCommercialCapAda?: number;
  feeOssPct?: number;
  feeOssCapAda?: number;
  feeCapPerRoundAda?: number;
  quickPollParticipationPct?: number;
  quickPollDurationHours?: number;
  quickPollMaxExtensions?: number;
  milestoneNotificationDaysBeforeEnd?: number;
  milestoneAutoExtensionDays?: number;
  milestoneCheckPeriodDays?: number;
  milestoneBoardExtraExtensionDays?: number;
  pledgeThresholdAda?: number;
  pledgeGraceDays?: number;
}
export interface CreateRoundInput extends RoundSettingsInput {
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
  active: boolean;
  budgetAda: number;
  rewardsPoolAda: number;
  categoryCount: number;
  eligibleCount: number;
  proposalCount: number;
  proposalCounts: Record<string, number>;
  /** ACTIVE proposals broken down by stage (FILTERING / DEBATE_VOTE / FUNDING). */
  activeStageCounts?: Record<string, number>;
}
export interface RoundScheduleEntry {
  stageKey: string;
  startsAt: string;
  endsAt: string;
  autoStart: boolean;
  confirmedAt: string | null;
  prolongedFrom: string | null;
}
export interface RoundNextStage {
  status: string;
  stageKey: string | null;
  manualOnly: boolean;
  planned: { startsAt: string; endsAt: string } | null;
  autoStart: boolean;
  confirmed: boolean;
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
    conditions: string | null;
    description: string | null;
  }[];
  schedule: RoundScheduleEntry[];
  settings: { [K in keyof Required<RoundSettingsInput>]: number | null };
  nextStage: RoundNextStage | null;
}

export const roundsApi = {
  list: () => request<RoundSummary[]>('/rounds'),
  active: () => request<RoundDetail | null>('/rounds/active'),
  get: (id: string) => request<RoundDetail>(`/rounds/${id}`),
};

export interface ConfirmStageInput {
  autoStart: boolean;
  startsAt?: string;
  endsAt?: string;
}
export const boardRoundsApi = {
  create: (input: CreateRoundInput) =>
    request<RoundDetail>('/admin/rounds', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: Partial<CreateRoundInput>) =>
    request<RoundDetail>(`/admin/rounds/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  startStage: (id: string, stage: string) =>
    request<RoundDetail>(`/admin/rounds/${id}/start-stage/${stage}`, { method: 'POST' }),
  confirmStage: (id: string, stageKey: string, input: ConfirmStageInput) =>
    request<RoundDetail>(`/admin/rounds/${id}/stages/${stageKey}/confirm`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  launchNext: (id: string) => request<RoundDetail>(`/admin/rounds/${id}/launch-next`, { method: 'POST' }),
  close: (id: string) => request<RoundDetail>(`/admin/rounds/${id}/close`, { method: 'POST' }),
};

export interface ProposalMilestoneInput {
  title?: string;
  description: string;
  acceptanceCriteria?: string;
  amountAda: number;
}
export interface CreateProposalInput {
  roundId: string;
  categoryId: string;
  title: string;
  contentMd: string;
  isCommercial: boolean;
  requestedAmountAda: number;
  subcategoryIds?: string[];
  costBreakdownMd?: string;
  teamInfoMd?: string;
  revenueSharingMd?: string;
  payoutAddress?: string;
  submissionFeeTxHash?: string;
  milestones: ProposalMilestoneInput[];
}
export interface ProposalProgress {
  stage: string;
  label: string;
  tone: 'amber' | 'emerald' | 'neutral' | 'red';
}
export interface ProposalRejectionReason {
  stage: string;
  from: string | null;
  rationale: string;
}
export interface ProposalSummary {
  id: string;
  publicId: string | null;
  type: string;
  status: string;
  stage: string | null;
  title: string;
  categoryName: string | null;
  roundId: string | null;
  isCommercial: boolean | null;
  requestedAmountAda: number;
  submissionFeeTxHash: string | null;
  submitter: string | null;
  /** §26.2 — "what's needed now" for ACTIVE rows (filtering reviewers, D&V, milestones). */
  progress?: ProposalProgress | null;
  /** §7/§8/§16 — DRep / board rationales that decided a REJECTED proposal. */
  rejectionReasons?: ProposalRejectionReason[] | null;
}
export interface ProposalDetail extends ProposalSummary {
  categoryId: string;
  contentMd: string;
  costBreakdownMd: string | null;
  teamInfoMd: string | null;
  revenueSharingMd: string | null;
  subcategoryIds: string[];
  submissionFeeAda: number;
  submissionFeeTxHashes: string[];
  feeReviewFeedback: string | null;
  payoutAddress: string | null;
  categoryAsk: { minAda: number | null; maxAda: number | null; conditions: string | null };
  milestones: { id: string; idx: number; title: string | null; description: string; acceptanceCriteria: string | null; amountAda: number; status: string }[];
}

export const proposalsApi = {
  byRound: (roundId: string) => request<ProposalSummary[]>(`/rounds/${roundId}/proposals`),
  get: (id: string) => request<ProposalDetail>(`/proposals/${id}`),
  mine: () => request<ProposalSummary[]>('/me/proposals'),
  create: (input: CreateProposalInput) =>
    request<ProposalDetail>('/proposals', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: Partial<CreateProposalInput>) =>
    request<ProposalDetail>(`/proposals/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  budgetChange: (id: string, input: { requestedAmountAda: number; milestones: ProposalMilestoneInput[] }) =>
    request<ProposalDetail>(`/proposals/${id}/budget-change`, { method: 'POST', body: JSON.stringify(input) }),
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
  proposalStatus?: string;
  proposalStage?: string | null;
}
/** A vote with its public rationale (filtering / D&V / milestone). */
export interface VoteRationale {
  drep: string | null;
  displayName: string | null;
  choice: string;
  rationale: string | null;
  weight?: number;
}
export interface FilterAssignee {
  drep: string | null;
  displayName: string | null;
  voted: boolean;
  choice: string | null;
  expertiseMatch: boolean;
}
export interface FilterResult {
  reviewers: number;
  assigned: FilterAssignee[];
  yes: number;
  no: number;
  abstain: number;
  threshold: number;
  status: string;
  stage: string | null;
  votes: VoteRationale[];
  anchorTxHash: string | null;
  anchorHash: string | null;
}

export interface VotingTasksCount { filtering: number; dv: number; milestone: number; total: number }
export const filteringApi = {
  myAssignments: (history = false) => request<FilterAssignment[]>(`/me/assignments/filter${history ? '?history=1' : ''}`),
  votingTasks: () => request<VotingTasksCount>('/me/voting-tasks'),
  result: (proposalId: string) => request<FilterResult>(`/proposals/${proposalId}/filter-result`),
  vote: (proposalId: string, choice: 'YES' | 'NO' | 'ABSTAIN', rationale?: string) =>
    request<FilterResult>(`/proposals/${proposalId}/filter-vote`, {
      method: 'POST',
      body: JSON.stringify({ choice, rationale }),
    }),
};

// Board: confirm fee / draw reviewers / open D&V voting / finalize.
export const boardProposalsApi = {
  reviewFee: (id: string, decision: 'APPROVE' | 'REJECT', feedback?: string) =>
    request<ProposalDetail>(`/admin/proposals/${id}/review-fee`, { method: 'POST', body: JSON.stringify({ decision, feedback }) }),
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
  votes?: VoteRationale[];
  anchorTxHash?: string | null;
  anchorHash?: string | null;
}

export const dvApi = {
  result: (id: string) => request<DvResult>(`/proposals/${id}/dv-result`),
  vote: (id: string, choice: 'YES' | 'NO' | 'ABSTAIN', rationale: string) =>
    request<DvResult>(`/proposals/${id}/dv-vote`, {
      method: 'POST',
      body: JSON.stringify({ choice, rationale }),
    }),
  optIn: (id: string) => request<DvResult>(`/proposals/${id}/dv-opt-in`, { method: 'POST' }),
};

// -------- Public platform config (explorer, network, fee address) --------
export interface PublicConfig {
  network: string;
  explorer: string;
  submissionFeeAddress: string | null;
  anchorMetadataLabel: number;
  internalThresholds: { default: number; important: number };
}
export const configApi = { get: () => request<PublicConfig>('/config') };

// -------- Per-user preferences (§20): personal block explorer --------
export interface UserPreferences {
  explorer: string | null; // cardanoscan | cexplorer | adastat | custom | null (=platform default)
  explorerCustomTxUrl: string | null;
}
export const meApi = {
  preferences: () => request<UserPreferences>('/me/preferences'),
  setPreferences: (p: { explorer?: string; explorerCustomTxUrl?: string }) =>
    request<UserPreferences>('/me/preferences', { method: 'PATCH', body: JSON.stringify(p) }),
};

// -------- Proposal version history (diff view) --------
export interface ProposalVersionEntry {
  version: number;
  contentMd: string;
  editedAt: string;
  editor: string | null;
  current: boolean;
}
export const proposalVersionsApi = {
  list: (id: string) => request<ProposalVersionEntry[]>(`/proposals/${id}/versions`),
};
export const proposalEditApi = {
  update: (
    id: string,
    patch: {
      title?: string;
      contentMd?: string;
      requestedAmountAda?: number;
      costBreakdownMd?: string;
      teamInfoMd?: string;
      revenueSharingMd?: string;
      subcategoryIds?: string[];
      payoutAddress?: string;
      submissionFeeTxHash?: string;
    },
  ) => request<ProposalDetail>(`/proposals/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
};

// -------- Comments (§20.1) --------
export interface CommentNode {
  id: string;
  parentId: string | null;
  author: { displayName: string | null; drepId: string | null; role: string | null };
  contentMd: string | null;
  deleted: boolean;
  createdAt: string;
  replies?: CommentNode[];
}
export const commentsApi = {
  list: (proposalId: string) => request<CommentNode[]>(`/proposals/${proposalId}/comments`),
  create: (proposalId: string, contentMd: string, parentId?: string) =>
    request<{ id: string }>(`/proposals/${proposalId}/comments`, { method: 'POST', body: JSON.stringify({ contentMd, parentId }) }),
  edit: (id: string, contentMd: string) =>
    request<{ ok: boolean }>(`/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ contentMd }) }),
  remove: (id: string) => request<{ ok: boolean }>(`/comments/${id}`, { method: 'DELETE' }),
};

// -------- Milestones (§11) --------
export interface MilestoneReviewer { drepIdOnchain: string | null; displayName: string | null }
export interface MilestoneView {
  id: string;
  idx: number;
  title: string | null;
  description: string | null;
  acceptanceCriteria: string | null;
  amountAda: number;
  status: string;
  reviewers: MilestoneReviewer[];
  latestPoa: { contentMd: string | null; submittedAt: string; attempt: number } | null;
  poaCount: number;
  yes: number;
  no: number;
  threshold: number;
  votes: VoteRationale[];
  anchorTxHash: string | null;
}
export interface MilestoneAssignmentView {
  milestoneId: string;
  proposalId: string;
  proposalTitle: string;
  milestoneIdx: number;
  myVote: string | null;
  milestoneStatus?: string;
}
export interface StopFundingView {
  id: string;
  proposerRole: 'REVIEWER' | 'BOARD' | string;
  proposerName: string | null;
  proposerDrep: string | null;
  reason: string;
  status: 'ACTIVE' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | string;
  createdAt: string;
  decidedAt: string | null;
  anchorTxHash: string | null;
  threshold: number;
  yes: number;
  no: number;
  votes: { drep: string | null; displayName: string | null; choice: string; rationale: string | null }[];
}
export interface ActiveStopFunding extends StopFundingView {
  proposalId: string;
  proposalTitle: string;
  proposalPublicId: string | null;
  roundLabel: string | null;
  myChoice: 'YES' | 'NO' | null;
}
export const milestonesApi = {
  forProposal: (proposalId: string) => request<MilestoneView[]>(`/proposals/${proposalId}/milestones`),
  myAssignments: (history = false) => request<MilestoneAssignmentView[]>(`/me/assignments/milestone${history ? '?history=1' : ''}`),
  submitPoa: (milestoneId: string, contentMd: string) =>
    request<unknown>(`/milestones/${milestoneId}/poa`, { method: 'POST', body: JSON.stringify({ contentMd }) }),
  vote: (milestoneId: string, choice: 'YES' | 'NO', rationale?: string) =>
    request<unknown>(`/milestones/${milestoneId}/vote`, { method: 'POST', body: JSON.stringify({ choice, rationale }) }),
  // §11 — stop funding (reviewer or board can propose; board votes 1p1v).
  stopFundings: (proposalId: string) => request<StopFundingView[]>(`/proposals/${proposalId}/stop-fundings`),
  proposeStop: (proposalId: string, reason: string) =>
    request<StopFundingView>(`/proposals/${proposalId}/stop-funding`, { method: 'POST', body: JSON.stringify({ reason }) }),
  withdrawStop: (stopId: string) =>
    request<StopFundingView>(`/stop-fundings/${stopId}/withdraw`, { method: 'POST' }),
  voteStop: (stopId: string, choice: 'YES' | 'NO', rationale?: string) =>
    request<StopFundingView>(`/stop-fundings/${stopId}/vote`, { method: 'POST', body: JSON.stringify({ choice, rationale }) }),
  pendingStopFunding: () => request<{ count: number }>('/me/pending-stop-funding'),
};

// -------- Board: submission-fee confirmations (§16) + milestone admin --------
export interface PendingFee {
  id: string;
  title: string;
  roundNumber: number | null;
  categoryName: string | null;
  isCommercial: boolean | null;
  requestedAmountAda: number;
  submissionFeeAda: number;
  submissionFeeTxHash: string | null;
  // Every fee tx the submitter entered, each with its own on-chain verification.
  txs: { hash: string; found: boolean; paid: boolean; paidAda: number }[];
  submitter: string | null;
  submittedAt: string;
  // Summary on-chain verification (paid if ANY entered tx covered the fee).
  feeVerified: { found: boolean; paid: boolean; paidAda: number };
}
export const boardFeeApi = {
  pending: () => request<PendingFee[]>('/admin/proposals/pending-fee'),
};

// §12 — fee settlements from budget changes (board task: My Area → Payments).
export interface FeePayment {
  id: string;
  kind: 'TOPUP' | 'REFUND';
  status: string; // PENDING | SETTLED
  txHash: string | null;
  settledAt: string | null;
  amountAda: number;
  prevAmountAda: number;
  newAmountAda: number;
  prevFeeAda: number | null;
  newFeeAda: number | null;
  note: string | null;
  proposalId: string;
  proposalPublicId: string | null;
  proposalTitle: string | null;
  submitter: string | null;
  payoutAddress: string | null;
  createdAt: string;
}
export const boardPaymentsApi = {
  pending: (history = false) => request<FeePayment[]>(`/admin/proposals/payments${history ? '?history=1' : ''}`),
  settle: (id: string, txHash: string) =>
    request<{ status: string }>(`/admin/proposals/payments/${id}/settle`, { method: 'POST', body: JSON.stringify({ txHash }) }),
};
export interface MilestoneCandidate {
  drepId: string;
  drepIdOnchain: string;
  displayName: string | null;
  subcategoryIds: string[];
  expertiseMatch: boolean;
  loadInRound: number;
}
export const boardMilestoneApi = {
  /** Ranked candidate DReps with expertise + per-round milestone-review load count. */
  candidates: (proposalId: string) =>
    request<MilestoneCandidate[]>(`/admin/proposals/${proposalId}/milestone-candidates`),
  /** Board selects exactly `milestoneReviewerCount` DReps for the proposal. */
  assign: (proposalId: string, drepIds: string[]) =>
    request<MilestoneView[]>(`/admin/proposals/${proposalId}/assign-milestone-reviewers`, {
      method: 'POST',
      body: JSON.stringify({ drepIds }),
    }),
  /** Release the currently-assigned reviewers (only before any POA has been submitted). */
  release: (proposalId: string) =>
    request<{ released: boolean }>(`/admin/proposals/${proposalId}/release-milestone-reviewers`, { method: 'POST' }),
  terminate: (proposalId: string) => request<{ status: string }>(`/admin/proposals/${proposalId}/terminate`, { method: 'POST' }),
  /** Board-wide list of every ACTIVE stop-funding awaiting board votes. */
  activeStopFundings: () => request<ActiveStopFunding[]>('/admin/stop-fundings/active'),
};

// -------- §10 Internal proposals --------
export type InternalTally =
  | {
      kind: 'THRESHOLD';
      eligible: number;
      cast: number;
      yesPower: number;
      abstainPower: number;
      totalPower: number;
      denominator: number;
      ratioPct: number;
      thresholdPct: number;
      approved: boolean;
    }
  | {
      kind: 'POLL';
      eligible: number;
      voted: number;
      abstain: { power: number; voters: number };
      options: { option: string; power: number; voters: number }[];
    };

export interface InternalProposalSummary {
  id: string;
  publicId: string | null;
  title: string;
  internalType: string; // INSTRUCTIVE | INFORMATIVE | POLL
  votersScope: string; // DREPS_ONLY | BOARD_ONLY | BOTH
  votingType: string; // ONE_PERSON_ONE_VOTE | BALANCED
  thresholdKind: string; // DEFAULT | IMPORTANT
  isPrivate: boolean;
  status: string; // ACTIVE | APPROVED | REJECTED
  submitter: string | null;
  votingEndAt: string | null;
  thresholdPct: number | null;
  tally: InternalTally;
  isMine: boolean;
  myVotes: string[];
  canVote: boolean;
  isBoardElection: boolean;
  boardInstalledAt: string | null;
}
export interface BoardCandidate {
  drepId: string;
  drepKeyHash: string;
  drepIdOnchain: string;
  displayName: string;
}
export interface InternalProposalVoter {
  drep: string; // on-chain DRep id
  displayName: string | null;
  choice: string; // YES | NO | ABSTAIN | <poll option label>
  weight: number; // final voting power
  rationale: string | null;
}
export interface InternalProposalDetail extends InternalProposalSummary {
  contentMd: string;
  submitterDrepId: string | null;
  actors: string[] | null;
  candidates: BoardCandidate[] | null; // §14 — set when isBoardElection
  deliveryDate: string | null;
  poll: { multiple: boolean; options: string[] } | null;
  votingStartAt: string | null;
  resultFinalizedAt: string | null;
  voters: InternalProposalVoter[]; // who voted how + their rationales
  anchorTxHash: string | null;
  anchorHash: string | null;
}
export interface CreateInternalInput {
  title: string;
  contentMd: string;
  internalType: string;
  votersScope: string;
  thresholdKind: string;
  votingType: string;
  votingEndAt?: string;
  votingPeriodDays?: number;
  isPrivate?: boolean;
  pollOptions?: string[];
  pollMultiple?: boolean;
  actors?: string[];
  deliveryDate?: string;
  // §14 board-member election: when true, candidates (5 admitted-DRep UUIDs) become the new
  // board on approval + deliveryDate. Voters scope / voting type / threshold are forced by
  // the server (BOTH / BALANCED / IMPORTANT).
  isBoardElection?: boolean;
  candidates?: string[];
}
export interface VoteInternalInput {
  choice?: 'YES' | 'NO' | 'ABSTAIN';
  options?: string[];
  rationale?: string;
}
export const internalProposalsApi = {
  list: () => request<InternalProposalSummary[]>('/internal-proposals'),
  pendingCount: () => request<{ count: number }>('/internal-proposals/pending-count'),
  get: (id: string) => request<InternalProposalDetail>(`/internal-proposals/${id}`),
  submit: (input: CreateInternalInput) =>
    request<InternalProposalDetail>('/internal-proposals', { method: 'POST', body: JSON.stringify(input) }),
  vote: (id: string, input: VoteInternalInput) =>
    request<InternalProposalDetail>(`/internal-proposals/${id}/vote`, { method: 'POST', body: JSON.stringify(input) }),
  extend: (id: string, votingEndAt: string) =>
    request<InternalProposalDetail>(`/internal-proposals/${id}/extend`, { method: 'POST', body: JSON.stringify({ votingEndAt }) }),
  installBoard: (id: string) =>
    request<{ id: string; publicId: string | null; boardInstalledAt: string | null }>(
      `/internal-proposals/${id}/install-board`,
      { method: 'POST' },
    ),
};
