/**
 * validate.ts — minimal JSON-Schema 2020-12 validator for the
 * `ProfileV1` schema.
 *
 * We deliberately ship a tiny hand-rolled validator instead of pulling in
 * an external dep (`@cfworker/json-schema`, `ajv`, etc.):
 *   - The
 *     brief calls this out as the preferred path.
 *   - The profile schema only uses a closed subset of JSON Schema:
 *     `type`, `enum`, `required`, `properties`, `additionalProperties:false`,
 *     `items`, `minItems`, `minLength`, `minimum`/`exclusiveMinimum`,
 *     `pattern`. No `$ref`, no `anyOf`, no `if/then/else`.
 *   - Validation runs at dev/capture-time only — it's never on the
 *     critical path for a user-facing launch. Bundle weight matters.
 *
 * If we ever need full 2020-12 fidelity (e.g. for the Probe Manifest's
 * many `$defs`), we revisit this and pull in a real validator.
 *
 * @see schemas/profile.schema.json
 */

/** A single validation error with a JSONPointer-ish path. */
export interface ValidationError {
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
}

interface SchemaNode {
  readonly type?: string | readonly string[];
  readonly enum?: readonly unknown[];
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, SchemaNode>>;
  readonly additionalProperties?: boolean | SchemaNode;
  readonly items?: SchemaNode;
  readonly minItems?: number;
  readonly minLength?: number;
  readonly minimum?: number;
  readonly exclusiveMinimum?: number;
  readonly pattern?: string;
  readonly description?: string;
  readonly $schema?: string;
  readonly $id?: string;
  readonly title?: string;
}

/**
 * Validate `value` against `schema`. Returns all errors discovered;
 * does NOT short-circuit on the first error. Implementation matches
 * the JSON Schema 2020-12 draft for the keyword subset listed in the
 * module docs.
 */
export function validate(value: unknown, schema: SchemaNode): ValidationResult {
  const errors: ValidationError[] = [];
  walk(value, schema, "", errors);
  return { valid: errors.length === 0, errors };
}

function walk(value: unknown, schema: SchemaNode, path: string, errors: ValidationError[]): void {
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push({
        path: path || "/",
        message: `expected type ${types.join("|")}, got ${typeOf(value)}`,
      });
      return;
    }
  }
  if (schema.enum !== undefined) {
    if (!schema.enum.some((e) => deepEqual(e, value))) {
      errors.push({
        path: path || "/",
        message: `value must be one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`,
      });
    }
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({ path: path || "/", message: `must be ≥ ${schema.minimum}, got ${value}` });
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      errors.push({
        path: path || "/",
        message: `must be > ${schema.exclusiveMinimum}, got ${value}`,
      });
    }
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({
        path: path || "/",
        message: `string shorter than minLength=${schema.minLength}`,
      });
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push({
        path: path || "/",
        message: `string does not match pattern ${schema.pattern}`,
      });
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({
        path: path || "/",
        message: `array shorter than minItems=${schema.minItems}`,
      });
    }
    if (schema.items !== undefined) {
      for (let i = 0; i < value.length; i++) {
        walk(value[i], schema.items, `${path}/${i}`, errors);
      }
    }
  }
  if (isPlainObject(value)) {
    if (schema.required !== undefined) {
      for (const k of schema.required) {
        if (!(k in value)) {
          errors.push({ path: path || "/", message: `missing required property '${k}'` });
        }
      }
    }
    const props = schema.properties ?? {};
    for (const [k, child] of Object.entries(props)) {
      if (k in value) {
        walk((value as Record<string, unknown>)[k], child, `${path}/${k}`, errors);
      }
    }
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) {
        if (!(k in props)) {
          errors.push({
            path: path || "/",
            message: `additional property '${k}' not allowed`,
          });
        }
      }
    } else if (typeof schema.additionalProperties === "object") {
      const addl = schema.additionalProperties;
      for (const k of Object.keys(value)) {
        if (!(k in props)) {
          walk((value as Record<string, unknown>)[k], addl, `${path}/${k}`, errors);
        }
      }
    }
  }
}

function matchesType(value: unknown, t: string): boolean {
  switch (t) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as Record<string, unknown>).sort();
    const bk = Object.keys(b as Record<string, unknown>).sort();
    if (ak.length !== bk.length || !ak.every((k, i) => k === bk[i])) return false;
    return ak.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

/**
 * Load `schemas/profile.schema.json` from disk, walking up from cwd to
 * find the repo root. Throws if not found.
 */
export async function loadProfileSchema(start: string = process.cwd()): Promise<SchemaNode> {
  const { dirname, join, isAbsolute } = await import("node:path");
  const { existsSync } = await import("node:fs");
  let dir = start;
  if (!isAbsolute(dir)) dir = join(process.cwd(), dir);
  for (let i = 0; i < 32; i++) {
    const candidate = join(dir, "schemas", "profile.schema.json");
    if (existsSync(candidate)) {
      const text = await Bun.file(candidate).text();
      return JSON.parse(text) as SchemaNode;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "[mochi capture] could not locate schemas/profile.schema.json walking up from cwd",
  );
}
