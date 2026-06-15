'use client';

/**
 * §2.1 — universal placeholder avatar when no photo/logo was provided: a detailed
 * side-profile head silhouette (black on a light background) with white
 * negative-space accents (hair strands, ear, brow, beard). A few hair/beard
 * variants are picked deterministically from the display name, so the same
 * person always gets the same face. Used for DAO members, submitters and experts.
 */

// Face + neck outline (facing right), shared by every variant. The crown is left
// fairly plain so each hairstyle overlay sits on top of it naturally.
const FACE =
  'M13 34 C11 20 19 8 33 8 ' +            // back-head up and over the crown
  'C46 8 53 15 53 26 ' +                  // forehead → front hairline
  'C53 28 52 30 54 31 ' +                 // brow ridge
  'C58 33 61 36 61 39 ' +                 // nose bridge → tip
  'C61 41 57 42 55 43 ' +                 // nostril / under nose
  'C57 44 57 46 54 47 ' +                 // upper lip
  'C56 48 55 51 52 52 ' +                 // mouth → lower lip
  'C52 55 50 57 47 58 ' +                 // chin
  'C42 62 34 62 30 61 ' +                 // jawline back
  'L39 64 L23 64 ' +                      // neck front → bottom
  'C19 56 14 46 13 34 Z';                 // back of neck/head up to the start

// Hair overlays (black) — the part above/around the crown that gives the style.
const HAIR: string[] = [
  // short, smooth
  'M13 34 C10 18 19 6 33 6 C47 6 54 15 53 26 C50 16 44 13 36 13 C24 13 16 22 13 34 Z',
  // spiky / textured
  'M13 34 C10 16 19 5 31 6 L29 11 L37 3 L39 10 L46 5 L47 12 C51 15 54 20 53 26 C50 15 42 12 35 12 C24 12 16 22 13 34 Z',
  // swept-back, taller
  'M13 34 C9 15 20 4 35 6 C49 8 55 16 53 26 C53 18 50 14 45 13 C52 12 55 10 40 9 C26 8 16 20 13 34 Z',
  // curly / bumps
  'M13 35 C10 20 17 16 21 18 C19 9 28 7 31 12 C37 6 45 9 44 15 C51 14 54 20 53 26 C50 16 42 13 34 13 C24 13 16 23 13 35 Z',
];

// Beard overlays (black mass over the jaw). Empty = clean-shaven.
const BEARD: string[] = [
  '', // clean
  'M30 61 C38 62 45 58 50 51 C49 55 47 58 44 60 C40 63 34 63 30 62 Z', // light jaw beard
  'M30 61 C40 62 48 57 52 49 C53 52 51 56 47 59 C42 63 34 63 29 62 Z', // fuller
  '', // clean
];

// White negative-space accents (ear, brow, eye, hairline), shared.
const ACCENTS =
  '<g fill="none" stroke="#e5e7eb" stroke-width="1.5" stroke-linecap="round">' +
  '<path d="M26 41 C22 37 23 31 29 32"/>' +   // ear outer
  '<path d="M27 39 C26 36 28 35 30 36"/>' +   // ear inner
  '<path d="M48 31 L53 29"/>' +               // brow
  '<path d="M53 34 L56 34"/>' +               // eye
  '<path d="M33 13 C39 11 46 12 51 16"/>' +   // hairline strand
  '</g>';

export function FallbackAvatar({ name, className = 'h-9 w-9 rounded' }: { name: string; className?: string }) {
  let h = 0;
  for (const c of name || '?') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const i = h % HAIR.length;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="#e5e7eb"/>` +
    `<g fill="#111827"><path d="${FACE}"/><path d="${HAIR[i]}"/>${BEARD[i] ? `<path d="${BEARD[i]}"/>` : ''}</g>` +
    ACCENTS +
    `</svg>`;
  return <img src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} alt="" className={className} />;
}
