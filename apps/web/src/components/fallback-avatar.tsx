'use client';

/**
 * §2.1 — universal placeholder avatar when no photo/logo was provided: a person
 * (head + shoulders) silhouette on a light background, with a few hair variants
 * picked deterministically from the display name so the same person always gets
 * the same silhouette. Used for DAO members, submitters and experts.
 */

// Shared head + neck + shoulders bust (filled black).
const BUST =
  '<path d="M4 64 C4 48 17 42 32 42 C47 42 60 48 60 64 Z"/>' + // shoulders
  '<path d="M26 35 h12 v9 h-12 z"/>' + // neck
  '<ellipse cx="32" cy="24" rx="12.5" ry="14.5"/>' + // head
  '<circle cx="19.6" cy="25" r="3.1"/><circle cx="44.4" cy="25" r="3.1"/>'; // ears

// Top-of-head treatments (hair), drawn in the same fill so they merge with the head.
const HAIRS: string[] = [
  // short / smooth
  '<path d="M19 20 Q19 7 32 7 Q45 7 45 20 Q45 13 32 13 Q19 13 19 20 Z"/>',
  // spiky
  '<path d="M19 20 L21 9 L25 16 L28 6 L31 15 L34 5 L37 15 L40 9 L45 20 Q45 13 32 13 Q19 13 19 20 Z"/>',
  // side part
  '<path d="M18 20 Q20 6 34 8 Q44 9 46 20 Q44 12 33 12 Q23 11 18 20 Z"/>',
  // curly / bumps
  '<path d="M18 21 Q15 10 24 10 Q24 4 32 6 Q40 4 40 10 Q49 10 46 21 Q44 13 32 13 Q20 13 18 21 Z"/>',
  // bald (no hair — clean silhouette)
  '',
];

export function FallbackAvatar({ name, className = 'h-9 w-9 rounded' }: { name: string; className?: string }) {
  let h = 0;
  for (const c of name || '?') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="#e5e7eb"/>` +
    `<g fill="#111827">${BUST}${HAIRS[h % HAIRS.length]}</g>` +
    `</svg>`;
  return <img src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} alt="" className={className} />;
}
