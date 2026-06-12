/**
 * §20 — Configurable Platform Parameters. Single source of truth for defaults.
 * Seeded into the `platform_config` table; the board edits them at runtime.
 * `*_ADA` values are denominated in ADA (whole units), not Lovelace.
 */
export const PLATFORM_CONFIG_DEFAULTS = {
  ADMISSION_APPROVAL_VOTES: 3, // §14.2 board YES votes needed to admit a DRep (3-of-5)
  INTERNAL_DEFAULT_THRESHOLD_PCT: 67,
  INTERNAL_IMPORTANT_THRESHOLD_PCT: 75,
  // §14.1 — DAO-entry gate, layer 1: a registered DRep may request to join only if it
  // meets the on-chain minimums. Two independent, separately-toggled groups (both OFF
  // by default so testnet entry is open; enable on mainnet).
  ENTRY_REQUIRE_VOTING_POWER: false, // switch for the voting-power/delegator group
  MIN_OWN_VOTING_POWER_ADA: 1_000_000, // own stake self-delegated to the DRep (ADA)
  MIN_DELEGATORS: 20, // OR: at least this many delegators…
  MIN_DELEGATOR_STAKE_ADA: 50_000, // …each delegating at least this much (ADA)
  ENTRY_REQUIRE_ACTIVITY: false, // switch for the on-chain voting-activity group
  MINIMUM_VOTES_CASTED: 50, // window: the DRep's last N governance votes considered
  MINIMUM_DREP_ACTIVITY: 50, // % of that window the DRep must have voted on (50% of 50 = 25)
  ONLY_VOTES_WITH_RATIONALE: false, // count only votes that carry an on-chain rationale
  AVOID_PERIOD_MAX_DAYS_PER_YEAR: 42,
  MERIT_POINT_MAX: 200,
  BOARD_REWARD_DEADLINE_DAYS: 30,
  // NOTE: the yearly board reward budget (BOARD_YEARLY_REWARD_ADA) is intentionally
  // NOT listed here — it has a single editing place in Rewards → Board rewards,
  // which writes the platform_config row directly (see RewardsService.setBoardYearly).
  ANCHOR_SCHEDULE_CRON: '0 2 * * *',
  // Block explorer used for all on-chain links (tx + address).
  CARDANO_EXPLORER: 'cardanoscan', // cardanoscan | cexplorer | adastat
  // §15 — board multisig signing ceremony. 1_PHASE: every member signs the tx once
  // (body built without required_signers — needs a wallet that signs native-script
  // inputs without being named in the body, e.g. Eternl). 2_PHASE: Authorize → Sign
  // ceremony that works with any CIP-30 wallet.
  TX_SIGNING_PROCESS: '1_PHASE', // 1_PHASE | 2_PHASE
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
  ENTRY_REQUIRE_VOTING_POWER:
    'Gate DAO entry on the DRep\'s on-chain voting power/delegators below. Turn OFF on testnet (entry stays open); ON for mainnet.',
  MIN_OWN_VOTING_POWER_ADA: "Entry: minimum OWN voting power (ADA the DRep self-delegated). Meeting this alone qualifies.",
  MIN_DELEGATORS: 'Entry (alternative to own power): minimum number of delegators, each ≥ the minimum stake below.',
  MIN_DELEGATOR_STAKE_ADA: 'Entry: a delegator only counts toward MIN_DELEGATORS if they delegated at least this much (ADA).',
  ENTRY_REQUIRE_ACTIVITY:
    'Gate DAO entry on the DRep\'s past on-chain voting activity below. Turn OFF on testnet; ON for mainnet.',
  MINIMUM_VOTES_CASTED: "Entry/activity window: how many of the DRep's most recent governance votes are considered.",
  MINIMUM_DREP_ACTIVITY: 'Entry: % of that window the DRep must have voted on (e.g. 50% of 50 = 25 votes).',
  ONLY_VOTES_WITH_RATIONALE: 'Entry: when ON, only votes carrying an on-chain rationale count toward the activity check.',
  AVOID_PERIOD_MAX_DAYS_PER_YEAR: 'Maximum days per year a DRep may mark themselves unavailable.',
  MERIT_POINT_MAX: "Cap on a DRep's merit score (also bounds the voting-power multiplier).",
  BOARD_REWARD_DEADLINE_DAYS: 'Days the board has to distribute rewards after a round before a penalty applies.',
  ANCHOR_SCHEDULE_CRON: 'Cron schedule for the daily on-chain anchoring job (informational).',
  CARDANO_EXPLORER: 'Block explorer for on-chain links: cardanoscan, cexplorer, or adastat.',
  TX_SIGNING_PROCESS:
    'Multisig signing ceremony. 1-Phase: each board member signs the tx once — requires the Eternl wallet (first 3 signatures broadcast). 2-Phase: Authorize → Sign, works with any CIP-30 wallet.',
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
  rewardExpertSharePct: 0, // §12.2 — % of the reward pool paid directly to experts (subtracted first)
  rewardDvSharePct: 60, // §12.2 — of the DReps' pool (after experts): % → Debate & Vote (rest → milestone review)
  rewardFixedPct: 70, // within the D&V slice: % fixed (bonus share = 100 - rewardFixedPct)
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
  boardPayoutDeadlineDays: 5,
  pledgeThresholdAda: 0,
  pledgeGraceDays: 14,
  // §7.4 — after a filtering rejection the submitter can revise + resubmit while the
  // round is still in FILTERING; this caps how many times. Each resubmit clears the
  // jury's filtering votes and they vote again on the revised content.
  filterResubmissionsAllowed: 2,
  // §12 — separately caps how many budget-change requests the submitter may make
  // while the round is in FILTERING. Each accepted change clears the jury's
  // filtering votes (so they re-vote on the revised budget). 0 disables in-filter
  // budget changes entirely.
  filterBudgetChangesAllowed: 2,
  // §3 — minimum word count enforced on each mandatory text field of a proposal
  // (title, pitch, every milestone's name/description/acceptance criteria,
  // ecosystem impact, success metrics, cost breakdown, team info). Validated on
  // submit + on post-submission edits. 0 disables the check entirely — useful
  // for test environments.
  mandatoryWords: 1,
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
  rewardExpertSharePct:
    "Share (%) of the round's reward pool paid directly to experts; it is subtracted first, and the rest is the DReps' pool split across the stages below.",
  rewardDvSharePct:
    "Share (%) of the DReps' pool (after the experts' cut) paid for Debate & Vote participation; the remainder funds milestone reviewers (D&V + milestone = 100%).",
  rewardFixedPct:
    'Within the Debate & Vote slice, the fixed share (%); the remainder is a performance bonus (fixed + bonus = 100%). Milestone-review rewards are always fixed.',
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
  boardPayoutDeadlineDays: 'Days the board has to pay an approved milestone before all board members lose merit (§13).',
  pledgeThresholdAda: 'Requested amount above which a proposer must post a refundable pledge (ADA; 0 disables pledges).',
  pledgeGraceDays: 'Days a proposer has to post the required pledge.',
  filterResubmissionsAllowed:
    'How many times a submitter may revise + resubmit a proposal that was rejected at filtering, while the round is still in FILTERING. Each resubmit clears the existing filtering votes and the jury votes again on the revised content. 0 disables resubmissions.',
  filterBudgetChangesAllowed:
    'How many in-filter budget changes the submitter may request while the round is in FILTERING. Each accepted change clears the jury\'s filtering votes — they vote again on the revised budget. Counted separately from resubmissions. 0 disables in-filter budget changes.',
  mandatoryWords:
    'Minimum word count required on each mandatory text field of a proposal: title, pitch, every milestone (name + description + acceptance criteria), ecosystem impact, success metrics, cost breakdown, team info. Checked on submit and on every post-submission edit. 0 disables the check entirely (test mode).',
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
  MILESTONE_CHECK: 'MILESTONE_CHECK', // +1
  INTERNAL_SUBMIT: 'INTERNAL_SUBMIT', // +1 (drep) / +5 (board)
  QUICK_POLL_VOTE: 'QUICK_POLL_VOTE', // +1
  APPLICATION_REVIEW: 'APPLICATION_REVIEW', // +1 — board member decided a submitter application
  MULTISIG_KEY_PROVIDED: 'MULTISIG_KEY_PROVIDED', // +1 — board member submitted their multisig key/address
  MULTISIG_READY: 'MULTISIG_READY', // +1 — multisig assembled (each contributing board member)
  TX_SIGNED: 'TX_SIGNED', // +1 — signed a multisig tx that reached the network
  TX_INITIATED: 'TX_INITIATED', // +1 — initiated a treasury action (e.g. hot-wallet top-up) that reached the network
  BOARD_ROUND_START: 'BOARD_ROUND_START', // +10
  BOARD_ROUND_END: 'BOARD_ROUND_END', // +10
  BOARD_ROUND_CONFIGURE: 'BOARD_ROUND_CONFIGURE', // +10
  BOARD_REWARD_DISTRIBUTE: 'BOARD_REWARD_DISTRIBUTE', // +10
  BOARD_LEDGER_MONTHLY: 'BOARD_LEDGER_MONTHLY', // +2
  BOARD_PAYOUT_SIGNED: 'BOARD_PAYOUT_SIGNED', // +5 per signer — paid a delivered milestone in time
  MISSED_DV: 'MISSED_DV', // -1
  MISSED_FILTER: 'MISSED_FILTER', // -1
  MISSED_MILESTONE: 'MISSED_MILESTONE', // -1
  MISSED_QUICK_POLL: 'MISSED_QUICK_POLL', // -1
  BOARD_REWARD_LATE: 'BOARD_REWARD_LATE', // -10
  BOARD_PAYOUT_LATE: 'BOARD_PAYOUT_LATE', // -10 collective — milestone payout missed the deadline
} as const;
export type MeritReason = (typeof MeritReason)[keyof typeof MeritReason];

/** §13.2/13.3 — point delta per reason. Gains are awarded when the action happens;
 *  misses are deducted by the daily sweep when a window/deadline lapses (skipped if
 *  an avoid period covers it). Board rewards are collective except the per-signer payout. */
export const MERIT_DELTAS: Record<MeritReason, number> = {
  DV_VOTE: 1,
  DV_VOTE_INTERNAL: 1,
  FILTER_COMPLETE: 1,
  MILESTONE_CHECK: 1,
  INTERNAL_SUBMIT: 1,
  QUICK_POLL_VOTE: 1,
  APPLICATION_REVIEW: 1,
  MULTISIG_KEY_PROVIDED: 1,
  MULTISIG_READY: 1,
  TX_SIGNED: 1,
  TX_INITIATED: 1,
  BOARD_ROUND_START: 10,
  BOARD_ROUND_END: 10,
  BOARD_ROUND_CONFIGURE: 10,
  BOARD_REWARD_DISTRIBUTE: 10,
  BOARD_LEDGER_MONTHLY: 2,
  BOARD_PAYOUT_SIGNED: 5,
  MISSED_DV: -1,
  MISSED_FILTER: -1,
  MISSED_MILESTONE: -1,
  MISSED_QUICK_POLL: -1,
  BOARD_REWARD_LATE: -10,
  BOARD_PAYOUT_LATE: -10,
};
