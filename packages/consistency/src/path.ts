/**
 * Tiny dotted-path getter/setter for navigating the matrix-under-construction.
 *
 * Supports `a.b.c`-style paths only; no array indices, no escaping, no
 * wildcards. Sufficient for the consistency-engine surface — every input/
 * output path used by rules is a static string declared in the rule's
 * `inputs` / `output` fields.
 *
 * @internal
 */

/** Mutable, deeply-nested record. Used as the in-progress matrix shape. */
export type DeepRecord = { [k: string]: unknown };

/** Resolve a dotted path. Returns `undefined` if any segment is missing. */
export function getByPath(obj: DeepRecord, path: string): unknown {
  if (path.length === 0) return undefined;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as DeepRecord)[part];
  }
  return cur;
}

/**
 * Write `value` at the dotted path, creating intermediate objects as needed.
 * The caller owns `obj`. Throws if a non-final segment exists but is not a
 * plain object (i.e. we'd otherwise overwrite a primitive).
 */
export function setByPath(obj: DeepRecord, path: string, value: unknown): void {
  if (path.length === 0) {
    throw new Error("[mochi/consistency] setByPath: empty path");
  }
  const parts = path.split(".");
  const last = parts.pop();
  if (last === undefined) {
    throw new Error("[mochi/consistency] setByPath: empty path");
  }
  let cur: DeepRecord = obj;
  for (const part of parts) {
    const next = cur[part];
    if (next === undefined || next === null) {
      const fresh: DeepRecord = {};
      cur[part] = fresh;
      cur = fresh;
      continue;
    }
    if (typeof next !== "object" || Array.isArray(next)) {
      throw new Error(
        `[mochi/consistency] setByPath: cannot descend through non-object at "${part}" of "${path}"`,
      );
    }
    cur = next as DeepRecord;
  }
  cur[last] = value;
}

/** True iff every dotted-path segment is non-empty and matches `[A-Za-z0-9_-]+`. */
export function isValidPath(path: string): boolean {
  if (path.length === 0) return false;
  const parts = path.split(".");
  for (const part of parts) {
    if (part.length === 0) return false;
    if (!/^[A-Za-z0-9_-]+$/.test(part)) return false;
  }
  return true;
}
