/**
 * Determinism contract — the load-bearing guarantee of the consistency
 * engine (PLAN.md I-5). Two derivations of the same `(profile, seed)`
 * must produce byte-identical Matrices, modulo `derivedAt`.
 */
import { describe, expect, it } from "bun:test";
import { deriveMatrix } from "../derive";
import { MAC_M2_CHROME, WIN11_EDGE } from "./fixture";

/** JSON-serialize a matrix with `derivedAt` stripped. */
function matrixSignature(m: ReturnType<typeof deriveMatrix>): string {
  const { derivedAt: _drop, ...rest } = m;
  return JSON.stringify(rest);
}

describe("deriveMatrix — determinism contract", () => {
  it("(profile, seed) yields byte-identical output 100x (excluding derivedAt)", () => {
    const reference = matrixSignature(deriveMatrix(MAC_M2_CHROME, "deterministic-seed"));
    for (let i = 0; i < 100; i++) {
      const sig = matrixSignature(deriveMatrix(MAC_M2_CHROME, "deterministic-seed"));
      expect(sig).toBe(reference);
    }
  });

  it("different seeds → different matrices", () => {
    const a = matrixSignature(deriveMatrix(MAC_M2_CHROME, "alpha"));
    const b = matrixSignature(deriveMatrix(MAC_M2_CHROME, "beta"));
    expect(a).not.toBe(b);
  });

  it("different profiles → different matrices (cross-profile isolation)", () => {
    const a = matrixSignature(deriveMatrix(MAC_M2_CHROME, "shared-seed"));
    const b = matrixSignature(deriveMatrix(WIN11_EDGE, "shared-seed"));
    expect(a).not.toBe(b);
  });

  it("matrix round-trips through JSON losslessly (excluding derivedAt)", () => {
    const m = deriveMatrix(MAC_M2_CHROME, "round-trip");
    const roundTripped = JSON.parse(JSON.stringify(m));
    expect(roundTripped).toEqual(m);
  });

  it("derivedAt is the only field that varies between runs", () => {
    const a = deriveMatrix(MAC_M2_CHROME, "stable-seed");
    const b = deriveMatrix(MAC_M2_CHROME, "stable-seed");
    expect(a.derivedAt).toBeDefined();
    expect(b.derivedAt).toBeDefined();
    // Even if they happen to land in the same ms (ISO timestamps have
    // ms precision), the signature comparison above is the main contract.
    expect(matrixSignature(a)).toBe(matrixSignature(b));
  });

  it("seed-driven fields actually differ between seeds (R-019, R-023)", () => {
    const a = deriveMatrix(MAC_M2_CHROME, "seed-A");
    const b = deriveMatrix(MAC_M2_CHROME, "seed-B");
    expect(a.uaCh["seed-derived-noise"]).not.toBe(b.uaCh["seed-derived-noise"]);
    expect(a.uaCh["ua-build-hash"]).not.toBe(b.uaCh["ua-build-hash"]);
  });
});
