/**
 * On-chain governance events as transaction metadata (label 80808081), inspired
 * by WingRiders' open-source on-chain DAO governance (MIT) — the "votes are
 * tx metadata, anyone can re-tally" pattern — adapted to our model: DRep IDs,
 * an explicit **voting style**, and our subjects (admission / filtering /
 * milestone / debate-&-vote / removal / internal).
 *
 * Design choices kept from WingRiders:
 *  - votes recorded as immutable on-chain metadata (transparent, re-tallyable);
 *  - a result event anchors the final tally;
 *  - long/free-form text is committed by hash (full text stays off-chain),
 *    mirroring their "IPFS link + on-chain commitment" approach.
 * Differences: voting power is OUR weight (1p1v count, or balanced DRep power ×
 * merit), not a token-balance snapshot; and we tag every event with `style`.
 */

export const GOVERNANCE_METADATA_LABEL = 80808081;

/** §4.1 — which voting system a context uses (must be shown in the UI). */
export const VotingStyle = {
  ONE_PERSON_ONE_VOTE: '1P1V', // admission, filtering jury, milestone review, board-only internal
  BALANCED: 'BAL', // debate & vote (funding), internal proposals, quick polls
} as const;
export type VotingStyle = (typeof VotingStyle)[keyof typeof VotingStyle];

/** What is being voted on. */
export const GovSubject = {
  ADMISSION: 'admission',
  FILTERING: 'filtering',
  MILESTONE: 'milestone',
  DV: 'dv',
  REMOVAL: 'removal',
  INTERNAL: 'internal',
  SUBMISSION: 'submission', // a funding proposal accepted into the round (fee paid / not required)
} as const;
export type GovSubject = (typeof GovSubject)[keyof typeof GovSubject];

export type Choice = 'YES' | 'NO' | 'ABSTAIN';

interface BaseEvent {
  v: 1;
  subject: GovSubject;
  style: VotingStyle;
  ts: string; // ISO-8601 UTC
}

/** Anchors the thing being decided (e.g. a DRep admission application). */
export interface GovApplicationEvent extends BaseEvent {
  t: 'application';
  ref: string; // stable id tying votes/result together (e.g. applicant DRep ID)
  name?: string; // ≤64 bytes
  uri?: string; // off-chain docs (platform URL / IPFS), ≤64 bytes
}

/** A single vote. For 1P1V `weight` is omitted (each vote counts as 1). */
export interface GovVoteEvent extends BaseEvent {
  t: 'vote';
  ref: string; // the application/proposal this vote is for
  voter: string; // voter DRep ID (the tx is signed by this wallet)
  choice: Choice;
  weight?: number; // balanced voting power (omit for 1P1V)
  rh?: string; // rationale hash (hex), full rationale stays off-chain
}

/** Anchors the final, computed result + a commitment to the full vote set. */
export interface GovResultEvent extends BaseEvent {
  t: 'result';
  ref: string;
  outcome: 'PASSED' | 'FAILED' | 'ADMITTED' | 'REJECTED' | 'REMOVED';
  yes: number; // count (1P1V) or summed power (BAL)
  no: number;
  threshold: number; // votes needed (1P1V) or threshold % (BAL)
  h?: string; // hash of the off-chain preimage (all signed votes) — recompute to verify
}

export type GovEvent = GovApplicationEvent | GovVoteEvent | GovResultEvent;

/** Human-readable titles so the on-chain JSON is understandable on its own. */
export const SUBJECT_TITLE: Record<GovSubject, string> = {
  admission: 'Admission of new DAO member',
  removal: 'Removal of a DAO member',
  filtering: 'Proposal filtering review',
  milestone: 'Milestone review',
  dv: 'Debate & Vote (funding)',
  internal: 'Internal proposal',
  submission: 'Funding proposal accepted',
};
export const STYLE_LABEL: Record<VotingStyle, string> = {
  '1P1V': '1 member, 1 vote',
  BAL: 'Balanced voting power',
};

/**
 * The self-describing on-chain result anchor — readable by anyone parsing the
 * JSON: a clear title, the full list of voters + how each voted, the tally, and
 * the outcome. `proofHash` commits to the off-chain preimage (full signed votes).
 */
export interface AnchorVote {
  drep: string;
  vote: string;
  power?: number; // balanced voting power this DRep's vote carried (BAL only)
}
export interface AnchorResultMetadata {
  title: string;
  subject: GovSubject;
  proposalId?: string; // structured public id (e.g. "R3-P2" or "Internal 4") when about a proposal
  docHash?: string; // sha256 of the proposal's title+content (internal proposals) — date-independent
  electedBoard?: { drep: string; name: string }[]; // §14 — the elected candidates on a board election
  voting: string; // human-readable voting style
  applicant: string; // subject DRep id (admission/removal) or proposal reference (filtering/dv/milestone)
  votes: AnchorVote[];
  // For 1P1V: yes/no are vote counts, threshold is the count needed. For BAL:
  // yes/no are summed voting power, threshold is the % of total power required,
  // and totalPower is the snapshot's total eligible power.
  tally: { yes: number; no: number; threshold: number; unit: 'votes' | 'power'; totalPower?: number };
  outcome: string;
  decidedAt: string;
  proofHash?: string;
  verify?: string;
}

export function buildResultMetadata(p: {
  subject: GovSubject;
  style: VotingStyle;
  applicant: string;
  proposalId?: string | null; // structured public id when the decision concerns a proposal
  docHash?: string | null; // sha256 of title+content (internal proposals)
  electedBoard?: { drep: string; name: string }[] | null; // §14 — set for board-election anchors
  votes: AnchorVote[];
  yes: number;
  no: number;
  threshold: number;
  totalPower?: number;
  outcome: string;
  proofHash?: string;
  verify?: string;
}): Record<string, AnchorResultMetadata> {
  const balanced = p.style === VotingStyle.BALANCED;
  // Cardano tx metadata forbids floats, but balanced voting power is fractional, so
  // round every numeric field to an integer here. The full-precision values live in
  // the off-chain preimage that `proofHash` commits to; this is the readable summary.
  const r = (n: number) => Math.round(n);
  const meta: AnchorResultMetadata = {
    title: SUBJECT_TITLE[p.subject],
    subject: p.subject,
    ...(p.proposalId ? { proposalId: p.proposalId } : {}),
    ...(p.docHash ? { docHash: p.docHash } : {}),
    ...(p.electedBoard && p.electedBoard.length ? { electedBoard: p.electedBoard } : {}),
    voting: STYLE_LABEL[p.style],
    applicant: p.applicant,
    votes: p.votes.map((v) => (v.power == null ? v : { ...v, power: r(v.power) })),
    tally: {
      yes: r(p.yes),
      no: r(p.no),
      threshold: r(p.threshold),
      unit: balanced ? 'power' : 'votes',
      ...(balanced && p.totalPower != null ? { totalPower: r(p.totalPower) } : {}),
    },
    outcome: p.outcome,
    decidedAt: new Date().toISOString(),
    ...(p.proofHash ? { proofHash: p.proofHash } : {}),
    ...(p.verify ? { verify: p.verify } : {}),
  };
  return { [GOVERNANCE_METADATA_LABEL]: meta };
}

/**
 * §3/§12 — the self-describing on-chain anchor written when a funding proposal is **accepted**
 * into a round (its submission fee was paid + confirmed, or no fee was required). Records the
 * unique proposal id, who submitted it (DRep id, or stake/wallet id if not a DRep), and the
 * fee facts (paid? amount? which tx paid it). `proofHash` commits to the off-chain preimage.
 */
export interface AnchorSubmissionMetadata {
  title: string;
  subject: 'submission';
  proposalId: string; // structured public id, e.g. "R6-P3"
  round?: number;
  submitter: string; // DRep id (CIP-129) or stake/wallet address
  submitterType: 'DRep' | 'Wallet';
  fee: { required: boolean; paid: boolean; ada: number; txHash?: string };
  acceptedAt: string;
  proofHash?: string;
}

export function buildSubmissionMetadata(p: {
  proposalId: string;
  round?: number | null;
  submitter: string;
  submitterType: 'DRep' | 'Wallet';
  feeRequired: boolean;
  feePaid: boolean;
  feeAda: number;
  feeTxHash?: string | null;
  acceptedAt?: string;
  proofHash?: string;
}): Record<string, AnchorSubmissionMetadata> {
  const meta: AnchorSubmissionMetadata = {
    title: SUBJECT_TITLE.submission,
    subject: 'submission',
    proposalId: p.proposalId,
    ...(p.round != null ? { round: p.round } : {}),
    submitter: p.submitter,
    submitterType: p.submitterType,
    fee: {
      required: p.feeRequired,
      paid: p.feePaid,
      ada: Math.round(p.feeAda),
      ...(p.feeTxHash ? { txHash: p.feeTxHash } : {}),
    },
    acceptedAt: p.acceptedAt ?? new Date().toISOString(),
    ...(p.proofHash ? { proofHash: p.proofHash } : {}),
  };
  return { [GOVERNANCE_METADATA_LABEL]: meta };
}

const MAX_STR = 64;
/** UTF-8 byte length, dependency-free (no Buffer/TextEncoder) so the lib stays isomorphic. */
function utf8Len(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++; // surrogate pair → one 4-byte code point
    } else n += 3;
  }
  return n;
}
function assertShort(label: string, value: string | undefined) {
  if (value !== undefined && utf8Len(value) > MAX_STR) {
    throw new Error(`${label} exceeds ${MAX_STR} bytes (Cardano metadata limit) — hash or shorten it`);
  }
}

/** Wrap an event as the metadata object posted under the governance label. */
export function buildGovMetadata(e: GovEvent): Record<string, GovEvent> {
  assertShort('ref', e.ref);
  if (e.t === 'application') {
    assertShort('name', e.name);
    assertShort('uri', e.uri);
  }
  if (e.t === 'vote') {
    assertShort('voter', e.voter);
    assertShort('rh', e.rh);
  }
  if (e.t === 'result') assertShort('h', e.h);
  return { [GOVERNANCE_METADATA_LABEL]: e };
}

/** Parse the event back from on-chain metadata JSON (e.g. Koios `/tx_metadata`). */
export function decodeGovEvent(metadataForLabel: unknown): GovEvent {
  const o = metadataForLabel as Record<string, unknown>;
  if (!o || typeof o !== 'object') throw new Error('not a governance metadatum');
  if (o.v !== 1) throw new Error(`unsupported governance metadata version: ${String(o.v)}`);
  if (o.t !== 'application' && o.t !== 'vote' && o.t !== 'result') {
    throw new Error(`unknown governance event type: ${String(o.t)}`);
  }
  return o as unknown as GovEvent;
}

export interface TallyResult {
  yes: number;
  no: number;
  passed: boolean;
}

/** 1-person-1-vote tally (admission, filtering, milestone): count YES vs threshold. */
export function tallyOnePersonOneVote(votes: GovVoteEvent[], threshold: number): TallyResult {
  const latest = dedupeLatestByVoter(votes);
  const yes = latest.filter((v) => v.choice === 'YES').length;
  const no = latest.filter((v) => v.choice === 'NO').length;
  return { yes, no, passed: yes >= threshold };
}

/**
 * §4.4 balanced tally (debate & vote): yes_power / (total − abstain) ≥ threshold%.
 * `totalPower` is the snapshot's total eligible power (missing = implicit NO).
 */
export function tallyBalanced(
  votes: GovVoteEvent[],
  totalPower: number,
  thresholdPct: number,
): TallyResult {
  const latest = dedupeLatestByVoter(votes);
  const sum = (c: Choice) =>
    latest.filter((v) => v.choice === c).reduce((a, v) => a + (v.weight ?? 0), 0);
  const yes = sum('YES');
  const no = sum('NO');
  const abstain = sum('ABSTAIN');
  const denom = totalPower - abstain;
  return { yes, no, passed: denom > 0 && yes / denom >= thresholdPct / 100 };
}

/**
 * Canonical message a voter signs with CIP-30 `signData` (free, no tx) to
 * authenticate a vote. The backend reconstructs the SAME string from stored
 * fields and verifies the signature (CIP-8) against the voter's address — so
 * anyone can confirm the vote was authorized by that key. Built identically on
 * the frontend and backend to guarantee byte-for-byte agreement.
 */
export function admissionVoteMessage(p: {
  applicantDrepId: string;
  voterStakeAddress: string;
  choice: Choice;
  rationale: string;
  ts: string;
}): string {
  return [
    'DRep DAO — admission vote v1',
    `applicant: ${p.applicantDrepId}`,
    `voter: ${p.voterStakeAddress}`,
    `choice: ${p.choice}`,
    `rationale: ${p.rationale}`,
    `ts: ${p.ts}`,
  ].join('\n');
}

/** Canonical message a board member signs (CIP-30, free) to approve a treasury/board action. */
export function boardActionMessage(p: {
  actionId: string;
  kind: string;
  amountAda: number;
  voterStakeAddress: string;
  ts: string;
}): string {
  return [
    'DRep DAO — board action approval v1',
    `action: ${p.actionId}`,
    `kind: ${p.kind}`,
    `amount: ${p.amountAda} ADA`,
    `by: ${p.voterStakeAddress}`,
    `ts: ${p.ts}`,
  ].join('\n');
}

/** A voter may re-vote; keep only their last vote (metadata is append-only). */
function dedupeLatestByVoter(votes: GovVoteEvent[]): GovVoteEvent[] {
  const byVoter = new Map<string, GovVoteEvent>();
  for (const v of votes) byVoter.set(v.voter, v); // input assumed in chain order
  return [...byVoter.values()];
}
