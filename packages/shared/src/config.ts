/**
 * §20 — Configurable Platform Parameters. Single source of truth for defaults.
 * Seeded into the `platform_config` table; the board edits them at runtime.
 * `*_ADA` values are denominated in ADA (whole units), not Lovelace.
 */
export const PLATFORM_CONFIG_DEFAULTS = {
  ADMISSION_APPROVAL_VOTES: 3, // §14.2 board YES votes needed to admit a DRep (3-of-5)
  INTERNAL_DEFAULT_THRESHOLD_PCT: 67,
  INTERNAL_IMPORTANT_THRESHOLD_PCT: 75,
  MIN_OWN_VOTING_POWER_ADA: 1_000_000,
  MIN_DELEGATORS: 20,
  MIN_DELEGATOR_STAKE_ADA: 50_000,
  AVOID_PERIOD_MAX_DAYS_PER_YEAR: 42,
  MERIT_POINT_MAX: 200,
  BOARD_REWARD_DEADLINE_DAYS: 30,
  ANCHOR_SCHEDULE_CRON: '0 2 * * *',
  // Block explorer used for all on-chain links (tx + address).
  CARDANO_EXPLORER: 'cardanoscan', // cardanoscan | cexplorer | adastat
} as const;

export type PlatformConfigKey = keyof typeof PLATFORM_CONFIG_DEFAULTS;

/**
 * §20 — one-line, human-readable description of each platform parameter, shown in
 * the board's Platform setup so everyone understands what each setting controls.
 * Keep a description for every key in PLATFORM_CONFIG_DEFAULTS.
 *
 * NOTE: round-specific parameters (filtering/milestone reviewers, reward split,
 * fees, quick-poll, milestone timing, pledge) live in ROUND_SETTING_DEFAULTS and
 * are set per round in the round setup — not here.
 */
export const PLATFORM_CONFIG_META: Record<PlatformConfigKey, string> = {
  ADMISSION_APPROVAL_VOTES: 'Board YES votes needed to admit a new DAO member (3-of-5).',
  INTERNAL_DEFAULT_THRESHOLD_PCT: 'Approval threshold (%) for ordinary internal proposals.',
  INTERNAL_IMPORTANT_THRESHOLD_PCT: 'Approval threshold (%) for internal proposals flagged as important.',
  MIN_OWN_VOTING_POWER_ADA: 'Minimum own voting power a DRep needs to be eligible to vote (ADA).',
  MIN_DELEGATORS: 'Minimum number of delegators a DRep needs to be eligible.',
  MIN_DELEGATOR_STAKE_ADA: 'Minimum delegated stake a DRep needs to be eligible (ADA).',
  AVOID_PERIOD_MAX_DAYS_PER_YEAR: 'Maximum days per year a DRep may mark themselves unavailable.',
  MERIT_POINT_MAX: "Cap on a DRep's merit score (also bounds the voting-power multiplier).",
  BOARD_REWARD_DEADLINE_DAYS: 'Days the board has to distribute rewards after a round before a penalty applies.',
  ANCHOR_SCHEDULE_CRON: 'Cron schedule for the daily on-chain anchoring job (informational).',
  CARDANO_EXPLORER: 'Block explorer for on-chain links: cardanoscan, cexplorer, or adastat.',
};

/**
 * §6/§12 — per-round settings. The board configures these in the round setup; each
 * is stored on the round (nullable column) and these are the defaults used when a
 * round leaves one blank. They are intentionally NOT in the platform-wide config.
 *
 * `rewardFixedPct` is the left side of the round's Fixed↔Bonus reward slider; the
 * bonus share is the remainder (`100 - rewardFixedPct`).
 */
export const ROUND_SETTING_DEFAULTS = {
  filterReviewerCount: 5,
  filterApprovalVotes: 3,
  milestoneReviewerCount: 3,
  milestoneApprovalVotes: 2,
  dvApprovalThresholdPct: 67,
  rewardFixedPct: 70, // bonus share = 100 - rewardFixedPct
  feeCommercialPct: 3,
  feeCommercialCapAda: 5_000,
  feeOssPct: 1,
  feeOssCapAda: 1_000,
  feeCapPerRoundAda: 50_000,
  quickPollParticipationPct: 51,
  quickPollDurationHours: 48,
  quickPollMaxExtensions: 3,
  milestoneNotificationDaysBeforeEnd: 3,
  milestoneAutoExtensionDays: 28,
  milestoneCheckPeriodDays: 10,
  milestoneBoardExtraExtensionDays: 90,
  pledgeThresholdAda: 0,
  pledgeGraceDays: 14,
} as const;

export type RoundSettingKey = keyof typeof ROUND_SETTING_DEFAULTS;

/** One-line description of each per-round setting, shown in the round setup form. */
export const ROUND_SETTING_META: Record<RoundSettingKey, string> = {
  filterReviewerCount: 'Number of DReps randomly drawn to review each proposal in the Filtering stage.',
  filterApprovalVotes:
    'YES votes among the filter reviewers needed to advance a proposal to Debate & Vote (the same count of NO votes rejects it). Max = filtering reviewers.',
  milestoneReviewerCount: 'Number of DReps drawn to review each funded milestone delivery.',
  milestoneApprovalVotes:
    'YES votes among milestone reviewers needed to approve a milestone payout. Max = milestone reviewers.',
  dvApprovalThresholdPct: 'Percentage of balanced voting power required to approve a proposal in Debate & Vote.',
  rewardFixedPct:
    "Fixed share (%) of the round's reward pool; the remainder is paid as a performance bonus (fixed + bonus = 100%).",
  feeCommercialPct: 'Submission fee for commercial proposals, as a percent of the requested amount.',
  feeCommercialCapAda: 'Maximum submission fee for a commercial proposal (ADA).',
  feeOssPct: 'Submission fee for open-source / non-commercial proposals, as a percent of the requested amount.',
  feeOssCapAda: 'Maximum submission fee for an open-source proposal (ADA).',
  feeCapPerRoundAda:
    'Cap on the filtering reward pool funded by submission fees; fees above the cap spill into the Debate & Vote reward slice.',
  quickPollParticipationPct: 'Minimum participation (%) for a quick-poll result to be valid.',
  quickPollDurationHours: 'Default time a quick poll stays open, in hours.',
  quickPollMaxExtensions: 'How many times a quick poll may be extended when participation is too low.',
  milestoneNotificationDaysBeforeEnd: 'Days before a milestone deadline to notify the team.',
  milestoneAutoExtensionDays: 'Automatic grace extension granted to a late milestone (days).',
  milestoneCheckPeriodDays: 'Window reviewers have to check a delivered milestone (days).',
  milestoneBoardExtraExtensionDays: 'Extra milestone extension the board may grant on request (days).',
  pledgeThresholdAda: 'Requested amount above which a proposer must post a refundable pledge (ADA; 0 disables pledges).',
  pledgeGraceDays: 'Days a proposer has to post the required pledge.',
};

/** Known block explorers → tx/address URL templates per network ({hash}/{address} placeholders). */
export const EXPLORERS: Record<string, { label: string; tx: Record<string, string>; address: Record<string, string> }> = {
  cardanoscan: {
    label: 'Cardanoscan',
    tx: {
      Mainnet: 'https://cardanoscan.io/transaction/{hash}',
      Preprod: 'https://preprod.cardanoscan.io/transaction/{hash}',
      Preview: 'https://preview.cardanoscan.io/transaction/{hash}',
    },
    address: {
      Mainnet: 'https://cardanoscan.io/address/{address}',
      Preprod: 'https://preprod.cardanoscan.io/address/{address}',
      Preview: 'https://preview.cardanoscan.io/address/{address}',
    },
  },
  cexplorer: {
    label: 'Cexplorer',
    tx: {
      Mainnet: 'https://cexplorer.io/tx/{hash}',
      Preprod: 'https://preprod.cexplorer.io/tx/{hash}',
      Preview: 'https://preview.cexplorer.io/tx/{hash}',
    },
    address: {
      Mainnet: 'https://cexplorer.io/address/{address}',
      Preprod: 'https://preprod.cexplorer.io/address/{address}',
      Preview: 'https://preview.cexplorer.io/address/{address}',
    },
  },
  adastat: {
    label: 'AdaStat',
    tx: {
      Mainnet: 'https://adastat.net/transactions/{hash}',
      Preprod: 'https://preprod.adastat.net/transactions/{hash}',
      Preview: 'https://preview.adastat.net/transactions/{hash}',
    },
    address: {
      Mainnet: 'https://adastat.net/addresses/{address}',
      Preprod: 'https://preprod.adastat.net/addresses/{address}',
      Preview: 'https://preview.adastat.net/addresses/{address}',
    },
  },
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
