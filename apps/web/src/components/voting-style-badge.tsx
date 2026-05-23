/** §4.1 — shows which voting system a context uses (must be visible to users). */
export function VotingStyleBadge({ style }: { style: '1P1V' | 'BAL' }) {
  const oneVote = style === '1P1V';
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        oneVote
          ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'
          : 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300'
      }`}
      title={
        oneVote
          ? 'One member, one vote (board admission, filtering jury, milestone review)'
          : 'Balanced voting power: log₁₀(stake) × (1 + merit/200)'
      }
    >
      {oneVote ? '1 member · 1 vote' : 'Balanced voting power'}
    </span>
  );
}
