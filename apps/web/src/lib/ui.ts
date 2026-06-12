import { DEFAULT_SUBCATEGORIES } from '@drep-dao/shared';

/** Shared Tailwind class constants (were re-declared per component — D25). */
export const card = 'rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900';
export const inputCls = 'w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';

/** Subcategory id → human label lookup (single copy). */
export const SUBCAT_LABEL: Record<string, string> = Object.fromEntries(
  DEFAULT_SUBCATEGORIES.map((s) => [s.id, s.label]),
);

/** §2.1 — human label for a profile link, derived from its domain (GitHub, X, LinkedIn…). */
export function linkLabel(url: string, fallback = 'Web'): string {
  try {
    const host = new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
    const map: [RegExp, string][] = [
      [/github\.com$/, 'GitHub'], [/gitlab\.com$/, 'GitLab'], [/bitbucket\.org$/, 'Bitbucket'],
      [/(^|\.)x\.com$|twitter\.com$/, 'X (Twitter)'], [/linkedin\.com$/, 'LinkedIn'],
      [/t\.me$|telegram\.(me|org)$/, 'Telegram'], [/discord\.(gg|com)$/, 'Discord'],
      [/youtube\.com$|youtu\.be$/, 'YouTube'], [/facebook\.com$/, 'Facebook'],
      [/instagram\.com$/, 'Instagram'], [/medium\.com$/, 'Medium'], [/reddit\.com$/, 'Reddit'],
    ];
    for (const [re, label] of map) if (re.test(host)) return label;
    return host || fallback;
  } catch {
    return fallback;
  }
}
