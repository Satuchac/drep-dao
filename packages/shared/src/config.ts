/**
 * §20 — Configurable Platform Parameters. Single source of truth for defaults.
 * Seeded into the `platform_config` table; the board edits them at runtime.
 * `*_ADA` values are denominated in ADA (whole units), not Lovelace.
 */
export const PLATFORM_CONFIG_DEFAULTS = {
  NUMBER_OF_ROUNDS_PER_BUDGET: 3,
  STAGES_REWARD_SPLIT_DV_PCT: 60, // §12.2 — % of round bucket to D&V (rest → milestones)
  BONUS_SHARE_DV_PCT: 30, // within D&V slice, % that is bonus (rest = fixed)
  FILTER_REVIEWER_COUNT: 5,
  FILTER_APPROVAL_VOTES: 3,
  MILESTONE_REVIEWER_COUNT: 3,
  MILESTONE_APPROVAL_VOTES: 2,
  ADMISSION_APPROVAL_VOTES: 3, // §14.2 board YES votes needed to admit a DRep (3-of-5)
  DV_APPROVAL_THRESHOLD_PCT: 67,
  INTERNAL_DEFAULT_THRESHOLD_PCT: 67,
  INTERNAL_IMPORTANT_THRESHOLD_PCT: 75,
  QUICK_POLL_PARTICIPATION_PCT: 51,
  QUICK_POLL_DURATION_HOURS: 48,
  QUICK_POLL_MAX_EXTENSIONS: 3,
  FEE_COMMERCIAL_PCT: 3,
  FEE_COMMERCIAL_CAP_ADA: 5_000,
  FEE_OSS_PCT: 1,
  FEE_OSS_CAP_ADA: 1_000,
  FEE_CAP_PER_ROUND_ADA: 50_000,
  MILESTONE_NOTIFICATION_DAYS_BEFORE_END: 3,
  MILESTONE_AUTO_EXTENSION_DAYS: 28,
  MILESTONE_CHECK_PERIOD_DAYS: 10,
  MILESTONE_BOARD_EXTRA_EXTENSION_DAYS: 90,
  PLEDGE_THRESHOLD_ADA: 0,
  PLEDGE_GRACE_DAYS: 14,
  MIN_OWN_VOTING_POWER_ADA: 1_000_000,
  MIN_DELEGATORS: 20,
  MIN_DELEGATOR_STAKE_ADA: 50_000,
  AVOID_PERIOD_MAX_DAYS_PER_YEAR: 42,
  MERIT_POINT_MAX: 200,
  BOARD_REWARD_DEADLINE_DAYS: 30,
  ANCHOR_SCHEDULE_CRON: '0 2 * * *',
} as const;

export type PlatformConfigKey = keyof typeof PLATFORM_CONFIG_DEFAULTS;

/**
 * §20 — one-line, human-readable description of each platform parameter, shown in
 * the board's Platform setup so everyone understands what each setting controls.
 * Keep a description for every key in PLATFORM_CONFIG_DEFAULTS.
 */
export const PLATFORM_CONFIG_META: Record<PlatformConfigKey, string> = {
  NUMBER_OF_ROUNDS_PER_BUDGET: 'How many funding rounds a single budget allocation is split across.',
  STAGES_REWARD_SPLIT_DV_PCT:
    "Share of a round's reward pool paid for Debate & Vote participation (the rest funds milestone reviews).",
  BONUS_SHARE_DV_PCT:
    'Within the Debate & Vote reward slice, the portion paid as a performance bonus (the rest is a fixed share).',
  FILTER_REVIEWER_COUNT: 'Number of DReps randomly drawn to review each proposal in the Filtering stage.',
  FILTER_APPROVAL_VOTES:
    'YES votes among the filter reviewers needed to advance a proposal to Debate & Vote (the same count of NO votes rejects it).',
  MILESTONE_REVIEWER_COUNT: 'Number of DReps drawn to review each funded milestone delivery.',
  MILESTONE_APPROVAL_VOTES: 'YES votes among milestone reviewers needed to approve a milestone payout.',
  ADMISSION_APPROVAL_VOTES: 'Board YES votes needed to admit a new DAO member (3-of-5).',
  DV_APPROVAL_THRESHOLD_PCT: 'Percentage of balanced voting power required to approve a proposal in Debate & Vote.',
  INTERNAL_DEFAULT_THRESHOLD_PCT: 'Approval threshold (%) for ordinary internal proposals.',
  INTERNAL_IMPORTANT_THRESHOLD_PCT: 'Approval threshold (%) for internal proposals flagged as important.',
  QUICK_POLL_PARTICIPATION_PCT: 'Minimum participation (%) for a quick-poll result to be valid.',
  QUICK_POLL_DURATION_HOURS: 'Default time a quick poll stays open, in hours.',
  QUICK_POLL_MAX_EXTENSIONS: 'How many times a quick poll may be extended when participation is too low.',
  FEE_COMMERCIAL_PCT: 'Submission fee for commercial proposals, as a percent of the requested amount.',
  FEE_COMMERCIAL_CAP_ADA: 'Maximum submission fee for a commercial proposal (ADA).',
  FEE_OSS_PCT: 'Submission fee for open-source / non-commercial proposals, as a percent of the requested amount.',
  FEE_OSS_CAP_ADA: 'Maximum submission fee for an open-source proposal (ADA).',
  FEE_CAP_PER_ROUND_ADA: 'Cap on total submission fees collected in a single round (ADA).',
  MILESTONE_NOTIFICATION_DAYS_BEFORE_END: 'Days before a milestone deadline to notify the team.',
  MILESTONE_AUTO_EXTENSION_DAYS: 'Automatic grace extension granted to a late milestone (days).',
  MILESTONE_CHECK_PERIOD_DAYS: 'Window reviewers have to check a delivered milestone (days).',
  MILESTONE_BOARD_EXTRA_EXTENSION_DAYS: 'Extra milestone extension the board may grant on request (days).',
  PLEDGE_THRESHOLD_ADA: 'Requested amount above which a proposer must post a refundable pledge (ADA; 0 disables pledges).',
  PLEDGE_GRACE_DAYS: 'Days a proposer has to post the required pledge.',
  MIN_OWN_VOTING_POWER_ADA: 'Minimum own voting power a DRep needs to be eligible to vote (ADA).',
  MIN_DELEGATORS: 'Minimum number of delegators a DRep needs to be eligible.',
  MIN_DELEGATOR_STAKE_ADA: 'Minimum delegated stake a DRep needs to be eligible (ADA).',
  AVOID_PERIOD_MAX_DAYS_PER_YEAR: 'Maximum days per year a DRep may mark themselves unavailable.',
  MERIT_POINT_MAX: "Cap on a DRep's merit score (also bounds the voting-power multiplier).",
  BOARD_REWARD_DEADLINE_DAYS: 'Days the board has to distribute rewards after a round before a penalty applies.',
  ANCHOR_SCHEDULE_CRON: 'Cron schedule for the daily on-chain anchoring job (informational).',
};

/** §5.3 — default cross-cutting subcategories used to match proposals to reviewers. */
export const DEFAULT_SUBCATEGORIES: { id: string; label: string }[] = [
  { id: 'governance', label: 'Governance' },
  { id: 'defi', label: 'DeFi' },
  { id: 'rwa-tokenization', label: 'RWA & Tokenization' },
  { id: 'l2s', label: 'L2s' },
  { id: 'liquidity', label: 'Liquidity' },
  { id: 'infrastructure', label: 'Infrastructure' },
  { id: 'hackathon', label: 'Hackathon' },
  { id: 'meetup', label: 'Meetup' },
  { id: 'ecosystem', label: 'Ecosystem' },
  { id: 'tooling', label: 'Tooling' },
  { id: 'libraries', label: 'Libraries' },
  { id: 'documentation', label: 'Documentation' },
  { id: 'marketing', label: 'Marketing' },
];

/** §13 merit reason codes (gain/loss). Stored in merit_ledger.reason_code. */
export const MeritReason = {
  DV_VOTE: 'DV_VOTE', // +1
  DV_VOTE_INTERNAL: 'DV_VOTE_INTERNAL', // +1
  FILTER_COMPLETE: 'FILTER_COMPLETE', // +1
  MILESTONE_CHECK: 'MILESTONE_CHECK', // +0.5
  INTERNAL_SUBMIT: 'INTERNAL_SUBMIT', // +1 (drep) / +5 (board)
  QUICK_POLL_VOTE: 'QUICK_POLL_VOTE', // +1
  BOARD_ROUND_START: 'BOARD_ROUND_START', // +10
  BOARD_ROUND_END: 'BOARD_ROUND_END', // +10
  BOARD_ROUND_CONFIGURE: 'BOARD_ROUND_CONFIGURE', // +10
  BOARD_REWARD_DISTRIBUTE: 'BOARD_REWARD_DISTRIBUTE', // +10
  BOARD_LEDGER_MONTHLY: 'BOARD_LEDGER_MONTHLY', // +2
  MISSED_DV: 'MISSED_DV', // -1
  MISSED_FILTER: 'MISSED_FILTER', // -1
  MISSED_MILESTONE: 'MISSED_MILESTONE', // -1
  MISSED_QUICK_POLL: 'MISSED_QUICK_POLL', // -0.5
  BOARD_REWARD_LATE: 'BOARD_REWARD_LATE', // -10
} as const;
export type MeritReason = (typeof MeritReason)[keyof typeof MeritReason];
