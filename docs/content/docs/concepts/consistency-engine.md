---
title: The Consistency Engine
description: Relational fingerprint locking — how a (profile, seed) pair derives a Matrix that survives cross-surface probes.
order: 1
category: concepts
lastUpdated: 2026-05-09
---

The Consistency Engine is the reason mochi.js exists.

The standard pattern in stealth automation libraries is to randomize fingerprint surfaces independently — pick a UA string, pick a `hardwareConcurrency`, pick a WebGL renderer, hope nothing cross-references. That breaks the moment a probe checks two surfaces against each other. A `Mac OS` UA next to a `Mesa Intel` WebGL renderer is detectable in one comparison.

mochi flips it: every fingerprint surface derives from a single `(profile, seed)` pair, and a deterministic rule DAG enforces the relations between surfaces.

## The Matrix

A `ProfileV1` declares the *capabilities* of a device class — `device.cpuFamily`, `gpu.vendor`, `os.name`, fonts, timezone bands. A `MatrixV1` is the concrete instantiation for one `(profile, seed)` pair. Two distinct seeds produce two distinct Matrices, but each Matrix is internally consistent — every value is reachable from another value through the rule DAG.

```ts
import { deriveMatrix } from "@mochi.js/consistency";
import { getProfile } from "@mochi.js/profiles";

const profile = await getProfile("mac-m4-chrome-stable");
const matrix = deriveMatrix(profile, "user-12345");

// Same inputs → same output, byte-for-bit (excluding `derivedAt`).
matrix.webgl.unmaskedRenderer; // "ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)"
matrix.audio.contextSampleRate; // 44100
matrix.navigator.hardwareConcurrency; // 10
matrix.fonts.list; // ["...the curated mac M4 font set..."]
```

## The relational locking ruleset

Encoded as a DAG of rules. Each rule reads inputs and produces a deterministic output. The DAG is checked for acyclicity at engine load time.

A few examples (the full set lives in `packages/consistency/src/rules/`):

| Rule | Inputs | Output |
|---|---|---|
| `R-001` | `[gpu.vendor, gpu.renderer]` | `webgl.unmaskedVendor` |
| `R-002` | `[gpu.vendor, gpu.renderer]` | `webgl.unmaskedRenderer` |
| `R-004` | `[device.cpuFamily]` | `audio.contextSampleRate` |
| `R-006` | `[os.name, browser.name]` | `userAgent` (with seed-driven build variance) |
| `R-008` | `[device.memoryGB]` | `navigator.deviceMemory` (capped at 8) |
| `R-009` | `[device.cores]` | `navigator.hardwareConcurrency` |
| `R-010` | `[os.name]` | `fonts.list` |

At v1 the catalog is around 80 rules. Adding a rule is a structured change: write it as a `Rule` in `packages/consistency/src/rules/`, declare its inputs and outputs, and the DAG-validation tests confirm it integrates cleanly.

## What "deterministic" means

`deriveMatrix(profile, seed)` is a pure function of its inputs. Same `(profile, seed)` produces a byte-identical Matrix on every call (excluding the `derivedAt` ISO timestamp). This matters for two reasons:

1. **Reproducibility.** A test that passes today against `mac-m4-chrome-stable + seed=foo` will pass tomorrow with the same inputs. No flakes from per-run randomness.
2. **Probe-Manifest diffing.** The harness ([Probe Manifest](/docs/concepts/probe-manifest)) captures a manifest from a live session, normalizes per-session entropy, and diffs structurally. Without determinism, every run would surface false-positive divergences.

Determinism comes from the seeded PRNG primitive (`xoshiro256**`) shared between `@mochi.js/consistency` and `@mochi.js/behavioral`. A single seed produces a single deterministic universe across all surfaces.

## Where the data comes from

Profiles aren't synthesized. They're captured from real devices we own. `mochi capture` drives a real Chrome on a real Mac M4 / Win11 box / Linux laptop, scrapes the probe surface, and writes the result to `packages/profiles/data/<id>/`. Every profile carries a `PROVENANCE.md` naming the device, the date, and the capturer.

## What we cover, and what we don't

The 13 probe families from `chaser-recon/src/lib/fingerprint/*` are the v1 scope: navigator, screen, canvas, WebGL/WebGPU, audio, MediaDevices, speech-synthesis, fonts, storage, bot-detection, timing, FPJS Pro outputs.

What we don't cover (documented in [Limits](/docs/reference/limits)):

- WebRTC IP leak — depends on the user's network config; v1 tells you to use a proxy.
- Battery API — removed in modern Chrome; nothing to spoof.
- Trust Tokens / Topics / FedCM — passthrough.
- Sensor APIs on desktop — Chrome doesn't expose them.

## Honesty

Per invariant **I-5**, every fingerprint surface mochi spoofs derives from a single `(profile, seed)` pair. If you supply an override (e.g. `launchOptions.spoof.userAgent`), the override is logged as a *deliberate inconsistency* and the harness refuses to certify the resulting profile. mochi will let you do it; the framework just won't pretend the result is internally consistent.
