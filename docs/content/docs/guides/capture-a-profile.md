---
title: Capture a profile
description: Run mochi capture on a real device to produce a ProfileV1 + baseline Probe Manifest, then submit it to the catalog.
order: 2
category: guides
lastUpdated: 2026-05-10
---

The six baselines that ship today were captured on specific machines — a particular MacBook M4, a particular Linux x64 box, a particular Brave on macOS. If you want to add a new device class — Mac M3, Linux arm64, Edge on Win11 — `mochi capture` is the front door. This page walks the flow.

## Why capture your own

- The shipped baselines are tied to the maintainer's hardware. The fonts list, the GPU strings, the audio fingerprint bytes, the canvas hash maps — all are device-specific. A captured baseline drives the consistency engine for that exact device class.
- Five of the eleven catalog ids ship as **placeholders** today (`mac-m2-chrome-stable`, `mac-m1-chrome-stable`, `mac-intel-chrome-stable`, `win11-chrome-stable`, `win11-edge-stable`). `getProfile` throws `ProfileBaselineMissingError` for those and the launcher falls back to a synthesized placeholder. A real capture replaces the synthesis with byte-exact data.
- A captured profile can be used **inline** without a PR — pass the `ProfileV1` object to `mochi.launch({ profile: <object>, seed })` directly. Submitting it to the catalog is optional.

## What `mochi capture` does

It spawns a Chromium binary against a clean ephemeral user-data-dir under `bypassInject: true` so the inject pipeline does not run — the browser reports its bare, native fingerprint. It then drives the canonical probe-page fixture (`tests/fixtures/probe-page.html`), captures the resulting Probe Manifest, derives a `ProfileV1` from the captured surface values (UA, UA-CH, screen, GPU, audio sample rates, fonts list, behavior block), and writes the bundle to disk.

The output lives in `packages/profiles/data/<id>/` (or `--out <dir>`):

```
<id>/
├── profile.json              # ProfileV1 — drives the consistency engine
├── baseline.manifest.json    # ProbeManifestV1 — what the harness diffs against
├── expected-divergences.json # paths the harness should treat as intentional
├── audio/                    # precomputed OfflineAudioContext bytes (per sample-rate)
├── canvas/                   # precomputed canvas hash maps (per probe payload)
└── PROVENANCE.md             # capturer + machine + date + suspectScore
```

## Run it

```sh
bunx mochi capture \
  --profile-id mac-m3-chrome-stable \
  --browser /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --out packages/profiles/data/mac-m3-chrome-stable \
  --seed harness-canary
```

Selected flags (full list at [`api/cli`](/docs/api/cli)):

- `--profile-id <id>` — required. The catalog id this capture targets.
- `--browser <path>` — required when not auto-resolved. Point this at a stable Chrome / Edge / Brave binary, NOT a Chromium-for-Testing build — you want the same binary your real users run.
- `--out <dir>` — output directory. Defaults to `packages/profiles/data/<id>/`.
- `--seed <s>` — used to derive a deterministic capture run; `harness-canary` is the convention for committed baselines.
- `--browser-version <v>` — pin the captured `browser.minVersion` / `maxVersion` instead of probing.
- `--notes <text>` — committed verbatim into `PROVENANCE.md`.

The CLI is interactive past that point — it prompts for capturer name, machine model, date, and FingerprintJS Pro `suspectScore` to fill in `PROVENANCE.md`. CI cannot verify provenance; a maintainer reviews at PR time.

## What the launcher does with a fresh capture

`mochi.launch({ profile: "mac-m3-chrome-stable", seed: "x" })` calls `getProfile("mac-m3-chrome-stable")`, which loads `data/mac-m3-chrome-stable/profile.json` via `Bun.file().json()`. The 48-rule consistency engine derives a `MatrixV1`. The inject pipeline reads the matrix; the audio module looks up the precomputed bytes in `audio/`; the canvas module looks up the precomputed maps in `canvas/`.

If you commit only `profile.json` without the audio / canvas blobs, the matrix still derives — but R-047 (audio) and R-048 (canvas) fall through to a synthesized digest, which the harness will flag as material divergence against any real device baseline.

## Verify the capture round-trips

Run the conformance suite against the freshly captured profile:

```sh
bun run conformance:stealth
```

(or programmatically — see [Conformance suite](/docs/guides/conformance-suite)). The suite drives a `mochi.launch({ profile: <id>, seed: "harness-canary" })` session through the same probe-page fixture and diffs against the baseline you just captured. Verdict semantics:

- **OK / EQUIVALENT** — every divergence is `guid-class` (allowlisted per-session entropy) or `intentional` (listed in `expected-divergences.json`). The capture is consistent.
- **WARN** — small drift that may be acceptable. Read the diffs.
- **FAIL / DIVERGED** — material divergence. Either the capture is wrong (re-run on a clean profile), or the inject pipeline doesn't yet cover a surface the new device exposes (file an issue).

## Submit to the catalog

If you want the capture to ship in `@mochi.js/profiles`:

1. **Verify the FPJS Pro `suspectScore`.** The committed baseline must score `<= 20` on FingerprintJS Pro v4 (a residual-trust metric). A residential IP, a real device, a session with browsing history pre-warmed clears this.
2. **Verify the harness round-trip.** `bun run conformance:stealth` against the new id must produce zero material diffs.
3. **Open a PR.** Include:
   - Every file under `data/<id>/`.
   - The `PROVENANCE.md` line filled out (capturer, machine model, date, suspectScore).
   - A note in [Limits](/docs/reference/limits) if any expected-divergence entries were added.

   The captures themselves are large (audio bytes + canvas maps), so the PR will be sizable — that's expected. The maintainer reviews provenance + harness output + scope.

4. **Bump `KNOWN_PROFILE_IDS` and `PROFILES_WITH_CAPTURED_BASELINE`** in `packages/profiles/src/index.ts` if the id wasn't already declared. New ids land alongside the data; placeholder→real flips just move the id from the placeholder list into `PROFILES_WITH_CAPTURED_BASELINE`.

## Use the capture inline (no PR)

You don't have to ship to the catalog. The captured `profile.json` is a plain `ProfileV1` you can pass to `mochi.launch` directly:

```ts
import { mochi } from "@mochi.js/core";
import type { ProfileV1 } from "@mochi.js/consistency";

const profile = (await Bun.file("./mac-m3-chrome-stable/profile.json").json()) as ProfileV1;

const session = await mochi.launch({ profile, seed: "user-1" });
```

Inline profiles work the same as catalog ones; the launcher's `resolveProfileSource` accepts both. You'll need to load the audio / canvas precomputed bytes through the same path the catalog uses if you want byte-exact R-047 / R-048 — for that, check `packages/inject/src/modules/audio-fingerprint.ts` and `canvas-fingerprint.ts`.

## See also

- [Profiles concept page](/docs/concepts/profiles) — the catalog, the on-disk layout, the FPJS suspectScore gate.
- [Probe Manifest](/docs/concepts/probe-manifest) — the schema the baseline manifest matches.
- [Conformance suite](/docs/guides/conformance-suite) — how to validate a capture.
- [`api/cli`](/docs/api/cli) — full CLI reference for `mochi capture`.

<!-- llm-context:start
Page purpose: walk a contributor through running `mochi capture` against a real device, validating the capture, and (optionally) submitting it to the catalog.

Key facts:
- Output: profile.json + baseline.manifest.json + PROVENANCE.md + audio/ + canvas/ + expected-divergences.json (optional) in <out>/
- Capture runs with bypassInject: true so the bare browser fingerprint is recorded.
- Capture runs with hermetic: true so update-traffic / default-apps / sync don't inject non-determinism.
- The captured manifest is what later harness runs diff against.
- Six profiles ship with captured baselines: linux-chrome-stable, mac-brave-stable, mac-chrome-beta, mac-chrome-stable, mac-m4-chrome-stable, windows-chrome-stable.
- Five profiles are placeholders (no captured baseline ships): mac-m2-chrome-stable, mac-m1-chrome-stable, mac-intel-chrome-stable, win11-chrome-stable, win11-edge-stable.
- A profile cannot land in the public catalog without: profile.json validated against schemas/profile.schema.json, baseline.manifest.json captured on real hardware, PROVENANCE.md, FPJS Pro suspectScore <= 20, harness Zero-Diff round-trip against itself.

CLI shape (verified, packages/cli/src/capture/subcommand.ts):
  mochi capture --profile-id <id> [--browser <path>] [--out <dir>] [--seed <s>]
                [--browser-version <v>] [--mochi-version <v>] [--notes <text>]

Common LLM hallucinations to avoid:
- "mochi capture --device <name>" — flag is --profile-id, NOT --device
- "Synthesize a profile from scratch" — not supported by the public capture flow
- "FPJS suspectScore is the only acceptance criterion" — also requires PROVENANCE.md and Zero-Diff harness pass
- "The CLI accepts a Chromium-for-Testing binary" — yes it does, but you want the SAME binary your real users run; CfT is fine for the bot side, not for capturing a real-user baseline

Cross-references:
- /docs/concepts/probe-manifest
- /docs/concepts/profiles
- /docs/guides/conformance-suite
- /docs/api/cli
llm-context:end -->
