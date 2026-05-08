/**
 * Unit tests for the inline JSON-Schema validator (validate.ts).
 *
 * Pinned at the surface required by `schemas/profile.schema.json` —
 * `type`, `enum`, `required`, `properties`, `additionalProperties:false`,
 * `items`, `minItems`, `minLength`, `minimum`, `exclusiveMinimum`,
 * `pattern`. Anything beyond that is out of scope until we need it.
 */

import { describe, expect, it } from "bun:test";
import { loadProfileSchema, validate } from "../validate";

describe("validate() — JSON Schema 2020-12 subset", () => {
  it("returns {valid:true, errors:[]} for a literal value matching its schema", () => {
    expect(validate("hello", { type: "string" })).toEqual({ valid: true, errors: [] });
    expect(validate(42, { type: "integer" })).toEqual({ valid: true, errors: [] });
    expect(validate(true, { type: "boolean" })).toEqual({ valid: true, errors: [] });
    expect(validate([1, 2], { type: "array", items: { type: "integer" } })).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("flags type mismatches with a useful path", () => {
    const r = validate({ a: "x" }, { type: "object", properties: { a: { type: "integer" } } });
    expect(r.valid).toBe(false);
    expect(r.errors[0]?.path).toBe("/a");
    expect(r.errors[0]?.message).toContain("expected type integer");
  });

  it("flags missing required properties", () => {
    const r = validate(
      {},
      { type: "object", required: ["x"], properties: { x: { type: "string" } } },
    );
    expect(r.valid).toBe(false);
    expect(r.errors[0]?.message).toContain("missing required property 'x'");
  });

  it("flags additional properties when additionalProperties:false", () => {
    const r = validate(
      { a: 1, b: 2 },
      {
        type: "object",
        additionalProperties: false,
        properties: { a: { type: "integer" } },
      },
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("'b'"))).toBe(true);
  });

  it("validates enum, minimum, exclusiveMinimum, pattern, minLength, minItems", () => {
    expect(validate("y", { enum: ["x", "y"] }).valid).toBe(true);
    expect(validate("z", { enum: ["x", "y"] }).valid).toBe(false);
    expect(validate(0, { type: "integer", minimum: 1 }).valid).toBe(false);
    expect(validate(0, { type: "number", exclusiveMinimum: 0 }).valid).toBe(false);
    expect(validate(0.0001, { type: "number", exclusiveMinimum: 0 }).valid).toBe(true);
    expect(validate("", { type: "string", minLength: 1 }).valid).toBe(false);
    expect(validate("abc", { type: "string", pattern: "^a" }).valid).toBe(true);
    expect(validate("xyz", { type: "string", pattern: "^a" }).valid).toBe(false);
    expect(validate([], { type: "array", minItems: 1, items: { type: "string" } }).valid).toBe(
      false,
    );
  });
});

describe("loadProfileSchema()", () => {
  it("reads schemas/profile.schema.json from the repo root", async () => {
    const schema = await loadProfileSchema();
    expect(schema.title).toBe("ProfileV1");
    expect(typeof schema.properties).toBe("object");
  });
});
