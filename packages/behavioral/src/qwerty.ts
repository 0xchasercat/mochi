/**
 * QWERTY hand assignment + adjacency map for keystroke synthesis.
 *
 * Hand assignment follows the standard touch-typing convention (left/right
 * index fingers split at the T-G-B and Y-H-N columns). Space is assigned to
 * the right thumb by default; the `hand` profile parameter does NOT change
 * this — typists of either dominance use both hands. The `hand` flag affects
 * mouse-trajectory bias (PLAN.md §11.1) rather than typing.
 *
 * Adjacency map is the touch-typing nearest-neighbor set used to choose a
 * mistake key — when the synthesizer rolls a typo, we pick uniformly from
 * the adjacency set of the intended key. Keys outside the alphanumeric grid
 * (digits, symbols, modifiers) deliberately have no adjacency entry; mistakes
 * on those keys fall through to "no typo this time" — a documented limit
 * (see docs/limits.md, "realistic typing-error correction beyond …").
 */

export type Hand = "left" | "right";

/** Lowercase letters by hand on a standard QWERTY layout. */
const LEFT = "qwertasdfgzxcvb";
const RIGHT = "yuiophjklnm";

const HAND_TABLE: Record<string, Hand> = (() => {
  const table: Record<string, Hand> = {};
  for (const c of LEFT) table[c] = "left";
  for (const c of RIGHT) table[c] = "right";
  return table;
})();

/**
 * Return the typing hand for the given character. Letters outside the
 * 26-letter set return `null` (the synthesizer falls back to the
 * cross-hand timing model for those — empirically a reasonable default
 * for digits and most punctuation, which most touch-typists don't have
 * a strong hand for).
 */
export function handFor(char: string): Hand | null {
  if (char.length === 0) return null;
  const ch = char.toLowerCase();
  return HAND_TABLE[ch] ?? null;
}

/** True if `char` is an ASCII space (or tab — treated identically). */
export function isSpaceLike(char: string): boolean {
  return char === " " || char === "\t";
}

/** True if `char` is one of the `,.;:!?` punctuation marks. */
export function isPunctuation(char: string): boolean {
  return ",.;:!?".includes(char);
}

/**
 * Adjacency map for QWERTY. Each entry lists the immediate neighbours an
 * inattentive typist might hit by mistake (left, right, upper-row, lower-row).
 * The set is intentionally narrow — one-finger errors only.
 */
const ADJ: Record<string, string> = {
  q: "wa",
  w: "qeas",
  e: "wrsd",
  r: "etdf",
  t: "ryfg",
  y: "tugh",
  u: "yihj",
  i: "uojk",
  o: "ipkl",
  p: "ol",
  a: "qwsz",
  s: "awedxz",
  d: "serfcx",
  f: "drtgvc",
  g: "ftyhbv",
  h: "gyujnb",
  j: "huiknm",
  k: "jiolm",
  l: "kop",
  z: "asx",
  x: "zsdc",
  c: "xdfv",
  v: "cfgb",
  b: "vghn",
  n: "bhjm",
  m: "njk",
};

/**
 * Pick a plausible mistake-key for the intended character. Returns `null`
 * when the intended character has no adjacency entry (digits, symbols,
 * non-letters) — caller skips the mistake injection in that case.
 *
 * `pickIndex` is a pure mapping `[0, n) -> int`, supplied by the caller's
 * seeded PRNG so the mistake choice is deterministic.
 */
export function adjacentKey(intended: string, pickIndex: (n: number) => number): string | null {
  if (intended.length === 0) return null;
  const lower = intended.toLowerCase();
  const adj = ADJ[lower];
  if (adj === undefined || adj.length === 0) return null;
  const idx = pickIndex(adj.length);
  const choice = adj.charAt(idx);
  // Preserve case of the intended key (a typo on "Q" is "W", not "w").
  return intended === lower ? choice : choice.toUpperCase();
}

/**
 * Map a character to a CDP `Input.dispatchKeyEvent.key` string. We follow
 * the DOM `KeyboardEvent.key` convention (the literal character for printable
 * keys; named for control keys). The dispatch layer additionally fills `text`
 * with the same character for printable keys — see `KeystrokeEvent.text`.
 */
export function cdpKeyFor(char: string): string {
  if (char === " ") return " ";
  if (char === "\t") return "Tab";
  if (char === "\n") return "Enter";
  // Single character printable: the literal char IS the `key` value per
  // the DOM `KeyboardEvent.key` spec.
  return char;
}
