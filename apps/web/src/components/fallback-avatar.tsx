'use client';

/**
 * §2.1 — universal placeholder avatar when no photo/logo was provided: a set of funny
 * black-and-white heads, picked deterministically from the display name so the same
 * person always gets the same face.
 */
const HEADS: string[] = [
  // round head, big smile
  '<circle cx="32" cy="32" r="26" fill="#e5e5e5" stroke="#222" stroke-width="3"/><circle cx="23" cy="26" r="3.5" fill="#222"/><circle cx="41" cy="26" r="3.5" fill="#222"/><path d="M20 40 q12 12 24 0" stroke="#222" stroke-width="3" fill="none" stroke-linecap="round"/>',
  // square head, moustache
  '<rect x="10" y="10" width="44" height="44" rx="10" fill="#f0f0f0" stroke="#222" stroke-width="3"/><circle cx="24" cy="28" r="3" fill="#222"/><circle cx="40" cy="28" r="3" fill="#222"/><path d="M22 41 q5 -6 10 0 q5 -6 10 0" stroke="#222" stroke-width="3" fill="none" stroke-linecap="round"/>',
  // egg head, surprised
  '<ellipse cx="32" cy="33" rx="22" ry="27" fill="#ededed" stroke="#222" stroke-width="3"/><circle cx="24" cy="27" r="4" fill="#fff" stroke="#222" stroke-width="2"/><circle cx="40" cy="27" r="4" fill="#fff" stroke="#222" stroke-width="2"/><circle cx="24" cy="27" r="1.6" fill="#222"/><circle cx="40" cy="27" r="1.6" fill="#222"/><circle cx="32" cy="43" r="5" fill="none" stroke="#222" stroke-width="3"/>',
  // round head, glasses
  '<circle cx="32" cy="32" r="26" fill="#f5f5f5" stroke="#222" stroke-width="3"/><circle cx="23" cy="28" r="6" fill="none" stroke="#222" stroke-width="2.5"/><circle cx="41" cy="28" r="6" fill="none" stroke="#222" stroke-width="2.5"/><line x1="29" y1="28" x2="35" y2="28" stroke="#222" stroke-width="2.5"/><path d="M24 43 q8 6 16 0" stroke="#222" stroke-width="3" fill="none" stroke-linecap="round"/>',
  // head with hat, wink
  '<circle cx="32" cy="35" r="23" fill="#ececec" stroke="#222" stroke-width="3"/><rect x="14" y="10" width="36" height="9" rx="4" fill="#222"/><rect x="22" y="2" width="20" height="12" rx="4" fill="#222"/><line x1="20" y1="31" x2="28" y2="31" stroke="#222" stroke-width="3" stroke-linecap="round"/><circle cx="41" cy="31" r="3.5" fill="#222"/><path d="M24 45 q8 7 16 0" stroke="#222" stroke-width="3" fill="none" stroke-linecap="round"/>',
  // fluffy hair, grin
  '<circle cx="32" cy="36" r="22" fill="#f1f1f1" stroke="#222" stroke-width="3"/><path d="M12 28 q2 -16 20 -16 q18 0 20 16 q-6 -8 -20 -8 q-14 0 -20 8z" fill="#222"/><circle cx="24" cy="34" r="3" fill="#222"/><circle cx="40" cy="34" r="3" fill="#222"/><path d="M22 46 q10 8 20 0 l-3 4 q-7 5 -14 0z" fill="#222"/>',
];

export function FallbackAvatar({ name, className = 'h-9 w-9 rounded' }: { name: string; className?: string }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${HEADS[h % HEADS.length]}</svg>`;
  return <img src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} alt="" className={className} />;
}
