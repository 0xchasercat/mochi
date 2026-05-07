/**
 * PRNG unit tests — determinism, isolation, and basic distribution sanity.
 *
 * These are the floor of the consistency engine's correctness story: if the
 * PRNG isn't deterministic, nothing downstream is.
 */
import { describe, expect, it } from "bun:test";
import { deriveSeedState, seedToPrng } from "../prng/seed";
import { makeXoshiro256ss } from "../prng/xoshiro256ss";

describe("xoshiro256** PRNG", () => {
  it("produces the same sequence for the same state", () => {
    const stateA = [1n, 2n, 3n, 4n] as const;
    const stateB = [1n, 2n, 3n, 4n] as const;
    const a = makeXoshiro256ss(stateA);
    const b = makeXoshiro256ss(stateB);
    for (let i = 0; i < 16; i++) {
      expect(a.nextU64()).toBe(b.nextU64());
    }
  });

  it("produces different sequences for differing states", () => {
    const a = makeXoshiro256ss([1n, 2n, 3n, 4n]);
    const b = makeXoshiro256ss([1n, 2n, 3n, 5n]);
    let divergedAt = -1;
    for (let i = 0; i < 8; i++) {
      if (a.nextU64() !== b.nextU64()) {
        divergedAt = i;
        break;
      }
    }
    expect(divergedAt).toBeGreaterThanOrEqual(0);
  });

  it("rejects the all-zero state", () => {
    expect(() => makeXoshiro256ss([0n, 0n, 0n, 0n])).toThrow(/all zero/);
  });

  it("nextFloat01 falls strictly in [0, 1)", () => {
    const prng = makeXoshiro256ss([42n, 43n, 44n, 45n]);
    for (let i = 0; i < 256; i++) {
      const v = prng.nextFloat01();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("nextIntInclusive respects bounds", () => {
    const prng = makeXoshiro256ss([10n, 20n, 30n, 40n]);
    for (let i = 0; i < 256; i++) {
      const v = prng.nextIntInclusive(5, 9);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(9);
    }
  });

  it("nextIntInclusive throws on inverted bounds", () => {
    const prng = makeXoshiro256ss([10n, 20n, 30n, 40n]);
    expect(() => prng.nextIntInclusive(10, 5)).toThrow();
  });

  it("pick selects a member; throws on empty array", () => {
    const prng = makeXoshiro256ss([10n, 20n, 30n, 40n]);
    const choices = [1, 2, 3, 4, 5] as const;
    for (let i = 0; i < 32; i++) {
      const v = prng.pick(choices);
      expect(choices).toContain(v);
    }
    expect(() => prng.pick([])).toThrow();
  });

  it("nextHex produces hex string of the requested byte length", () => {
    const prng = makeXoshiro256ss([1n, 2n, 3n, 4n]);
    expect(prng.nextHex(16)).toMatch(/^[0-9a-f]{32}$/);
    expect(prng.nextHex(4).length).toBe(8);
    expect(prng.nextHex(12).length).toBe(24);
  });

  it("distribution sanity: 1k draws don't all collide in any 8-bit bin", () => {
    // Weak test, but catches obvious bugs (e.g. PRNG returning a constant).
    const prng = makeXoshiro256ss([0xfeedfacecafebeefn, 0xdeadbeefn, 0xbabec0den, 0x1n]);
    const buckets = new Array<number>(256).fill(0);
    for (let i = 0; i < 1000; i++) {
      const lowByte = Number(prng.nextU64() & 0xffn);
      buckets[lowByte] = (buckets[lowByte] ?? 0) + 1;
    }
    let nonzero = 0;
    for (const b of buckets) if (b > 0) nonzero++;
    // 1000 uniform draws over 256 buckets should fill > 200 of them.
    expect(nonzero).toBeGreaterThan(200);
  });
});

describe("seed derivation", () => {
  it("same (profileId, seed) → same xoshiro state", () => {
    const a = deriveSeedState("profile-a", "seed-1");
    const b = deriveSeedState("profile-a", "seed-1");
    expect(a).toEqual(b);
  });

  it("different profile.id → different state", () => {
    const a = deriveSeedState("profile-a", "seed-1");
    const b = deriveSeedState("profile-b", "seed-1");
    expect(a).not.toEqual(b);
  });

  it("different seed → different state", () => {
    const a = deriveSeedState("profile-a", "seed-1");
    const b = deriveSeedState("profile-a", "seed-2");
    expect(a).not.toEqual(b);
  });

  it("same (profile, seed) PRNG produces identical first sequence", () => {
    const a = seedToPrng("profile-x", "abc");
    const b = seedToPrng("profile-x", "abc");
    for (let i = 0; i < 8; i++) {
      expect(a.nextU64()).toBe(b.nextU64());
    }
  });
});
