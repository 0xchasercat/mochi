/**
 * match.ts — tiny glob-style pattern matcher for dotted JSON paths.
 *
 * Used by `categorize` to test a `DiffEntry.path` against the entries of a
 * profile's `expected-divergences.json`. Patterns are dotted paths with
 * three glob tokens:
 *
 *   - `*`     — matches one path segment (any chars except `.` and `[`)
 *   - `**`    — matches across path segments (any chars including `.` and `[`)
 *   - `[*]`   — matches any single bracketed array index, e.g. `[12]`
 *
 * Examples:
 *
 *   `probes.audio.fingerprintBytes`     literal match
 *   `probes.audio.*`                    matches `probes.audio.<segment>`
 *   `probes.fonts.list[*]`              matches `probes.fonts.list[3]` etc.
 *   `probes.webgl.extensions[*]`        matches each extension index
 *   `probes.**`                         every probe descendant
 *
 * No regex anchors — patterns must match the full path. No deps.
 */

/** Per-process compile cache. Keys are tiny; collisions are impossible. */
const compileCache = new Map<string, RegExp>();

/**
 * Compile a glob pattern into a `RegExp` that matches the FULL path.
 *
 * Implementation: walk the pattern character-by-character emitting the
 * regex source. This avoids any sentinel-substitution fragility.
 */
function compile(pattern: string): RegExp {
  const cached = compileCache.get(pattern);
  if (cached !== undefined) return cached;

  const SEG = "[^.\\[]"; // chars that DO NOT start a new path segment

  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];

    // [*]  → \[\d+\]
    if (c === "[" && pattern[i + 1] === "*" && pattern[i + 2] === "]") {
      out += "\\[\\d+\\]";
      i += 3;
      continue;
    }

    // **   → .*
    if (c === "*" && pattern[i + 1] === "*") {
      out += ".*";
      i += 2;
      continue;
    }

    // *    → SEG*
    if (c === "*") {
      out += `${SEG}*`;
      i += 1;
      continue;
    }

    // Regex meta — escape.
    if (c !== undefined && /[.+?^${}()|[\]\\]/.test(c)) {
      out += `\\${c}`;
      i += 1;
      continue;
    }

    // Plain char.
    out += c ?? "";
    i += 1;
  }

  const compiled = new RegExp(`^${out}$`);
  compileCache.set(pattern, compiled);
  return compiled;
}

/**
 * Returns true if `path` matches `pattern`. See module docstring for the
 * supported glob tokens.
 */
export function match(pattern: string, path: string): boolean {
  return compile(pattern).test(path);
}

/**
 * Returns true if any pattern in `patterns` matches `path`.
 */
export function matchAny(patterns: readonly string[], path: string): boolean {
  for (const p of patterns) {
    if (match(p, path)) return true;
  }
  return false;
}

/** Internal — exposed for tests that mutate cache state. */
export function _resetCacheForTest(): void {
  compileCache.clear();
}
