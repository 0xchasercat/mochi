---
title: "@mochi.js/profiles"
description: "Pre-captured device-class profiles — the data fixtures mochi.launch resolves against."
order: 7
category: api
lastUpdated: 2026-05-09
---

`@mochi.js/profiles` is a **data package**, not a code package. Each profile lives under `data/<id>/` as a directory containing:

- `profile.json` — the `ProfileV1` spec the consistency engine consumes
- `baseline.manifest.json` — the Probe Manifest captured from the real device
- `expected-divergences.json` (optional) — paths the harness expects to differ
- `audio/*.bin` (where applicable) — precomputed `OfflineAudioContext` fingerprint bytes
- `canvas/*.json` (where applicable) — precomputed canvas hash maps
- `PROVENANCE.md` — capturer + machine + date

The package's JS surface is intentionally tiny: a list of shipped IDs and a `getProfile()` placeholder that throws until a future minor wires real lookup. `mochi.launch({ profile: "<id>", seed })` resolves the id by reading `<repo-root>/packages/profiles/data/<id>/profile.json` directly via the harness's `loadProfile` (when running in-tree) or via `@mochi.js/core`'s placeholder profile (when the id doesn't match a shipped profile yet).

## Installation

```sh
bun add @mochi.js/profiles
```

## Public exports

### `const KNOWN_PROFILE_IDS`

```ts
const KNOWN_PROFILE_IDS = [
  "mac-m4-chrome-stable",
  "mac-m2-chrome-stable",
  "mac-m1-chrome-stable",
  "mac-intel-chrome-stable",
  "win11-chrome-stable",
  "win11-edge-stable",
  "linux-chrome-stable",
  "mac-chrome-stable",
  "mac-chrome-beta",
  "windows-chrome-stable",
  "mac-brave-stable",
] as const satisfies readonly string[];
```

The IDs that ship in the v1 catalog. Pass any of these as `LaunchOptions.profile`. The first batch (`mac-m4-chrome-stable`, `linux-chrome-stable`, `windows-chrome-stable`) was captured natively on real hardware; the second cohort (`mac-chrome-stable`, `mac-chrome-beta`, `windows-chrome-stable`, `mac-brave-stable`) was imported from a real-user telemetry corpus (see PROVENANCE.md).

### `type ProfileId`

```ts
type ProfileId = (typeof KNOWN_PROFILE_IDS)[number];
```

A string-literal union of every shipped id. Use when you want autocomplete in your editor; `LaunchOptions.profile` is typed as `string | ProfileV1` so any string works at runtime.

### `type ProfileV1`

Re-exported from `@mochi.js/consistency` through a generated shim. The canonical source-of-truth lives in `@mochi.js/consistency` (see [API → consistency](/docs/api/consistency)). Re-exported here so consumers of this package can type the JSON they load without pulling in the rule DAG.

### `function getProfile(id: ProfileId): never`

```ts
function getProfile(_id: ProfileId): never;
```

**Phase 0.4 placeholder — currently throws.** Lands in a future minor as the canonical lookup function. For now, if you need to load a profile from disk programmatically:

```ts
import { loadProfile } from "@mochi.js/harness";
import { defaultProfilesDir } from "@mochi.js/harness";
import { join } from "node:path";

const profile = await loadProfile(
  join(defaultProfilesDir(), "linux-chrome-stable"),
);
```

The standard path — `mochi.launch({ profile: "linux-chrome-stable", seed: "x" })` — does this for you internally; you only need `loadProfile` when you want the `ProfileV1` object in hand (e.g. to derive a Matrix ahead of launch for a contract test).

### `const VERSION: string`

The npm package version (`"0.0.1"` — claim release).

## Profile directory layout

```
packages/profiles/data/<id>/
├── profile.json              # ProfileV1 — drives the consistency engine
├── baseline.manifest.json    # ProbeManifestV1 — what the harness diffs against
├── expected-divergences.json # optional; paths the harness should treat as intentional
├── PROVENANCE.md             # capturer + machine + date + suspectScore
├── audio/                    # optional; precomputed OfflineAudioContext bytes
│   └── *.bin
└── canvas/                   # optional; precomputed canvas hash maps
    └── *.json
```

The shape is documented in `PLAN.md §12`. Don't author profiles by hand — capture them with `mochi capture --profile-id <id>` (see [API → mochi CLI](/docs/api/cli)) or import from a harvester with `mochi profiles import`.

## Common patterns

### Type-safe profile id

```ts
import { type ProfileId, KNOWN_PROFILE_IDS } from "@mochi.js/profiles";
import { mochi } from "@mochi.js/core";

function pickProfile(): ProfileId {
  return KNOWN_PROFILE_IDS[0]; // "mac-m4-chrome-stable"
}

const session = await mochi.launch({ profile: pickProfile(), seed: "x" });
```

### Load a `ProfileV1` for a contract test

```ts
import { loadProfile, defaultProfilesDir } from "@mochi.js/harness";
import { deriveMatrix } from "@mochi.js/consistency";
import { join } from "node:path";

const profile = await loadProfile(join(defaultProfilesDir(), "linux-chrome-stable"));
const matrix = deriveMatrix(profile, "harness");
console.log(matrix.userAgent);
```

### Enumerate the catalog

```ts
import { KNOWN_PROFILE_IDS } from "@mochi.js/profiles";

for (const id of KNOWN_PROFILE_IDS) {
  console.log(id);
}
```

## Errors

| Call | Behavior |
| --- | --- |
| `getProfile(id)` | Always throws at v0.0.1 with a "not yet implemented" message; lands in a future minor |

## See also

- [Concepts → Profiles](/docs/concepts/profiles)
- [API → @mochi.js/consistency](/docs/api/consistency)
- [API → @mochi.js/core](/docs/api/core)
- [API → @mochi.js/harness](/docs/api/harness) — `loadProfile`, `loadBaseline`, `defaultProfilesDir`
- [API → mochi CLI](/docs/api/cli) — `mochi capture`, `mochi profiles import`
- [Guides → Capture a profile](/docs/guides/capture-a-profile)

<!-- llm-context:start
Package: @mochi.js/profiles
Public surface (verbatim from packages/profiles/src/index.ts as of 2026-05-09):

  VERSION                                          (const "0.0.1")
  ProfileV1                                        (type, re-exported from @mochi.js/consistency via generated shim)
  KNOWN_PROFILE_IDS                                (readonly tuple of profile ids)
  ProfileId = (typeof KNOWN_PROFILE_IDS)[number]
  getProfile(_id: ProfileId): never                — PLACEHOLDER, throws at v0.0.1, lands in a future minor

Shipped IDs (verbatim):
  mac-m4-chrome-stable, mac-m2-chrome-stable, mac-m1-chrome-stable, mac-intel-chrome-stable,
  win11-chrome-stable, win11-edge-stable, linux-chrome-stable,
  mac-chrome-stable, mac-chrome-beta, windows-chrome-stable, mac-brave-stable

Common LLM hallucinations (DO NOT USE):
- `getProfile("linux-chrome-stable")` returns a Profile — it THROWS at v0.0.1; use `loadProfile` from @mochi.js/harness instead
- `loadProfile(id)` exported here — NOT exported from @mochi.js/profiles; lives in @mochi.js/harness
- `Profile` (without V1 suffix) — the type is `ProfileV1`, re-exported through a generated shim
- `import profile from "@mochi.js/profiles/data/linux-chrome-stable"` — there is no per-id import path; load via `loadProfile`
- `getBaseline(id)` / `getProvenance(id)` — not exposed; use `loadBaseline` from @mochi.js/harness
- `KNOWN_PROFILE_IDS.includes(s)` returns boolean — true, but TS narrowing requires `s as ProfileId` because the tuple is a const-narrowed readonly array
- A `getProfileSync(id)` — does not exist
- `addProfile(id, profile)` / mutation API — profiles are file-system fixtures; mutate via mochi capture / mochi profiles import

To programmatically load a ProfileV1 today:
  import { loadProfile, defaultProfilesDir } from "@mochi.js/harness";
  import { join } from "node:path";
  const p = await loadProfile(join(defaultProfilesDir(), "<id>"));

Cross-references:
- /docs/concepts/profiles
- /docs/api/consistency
- /docs/api/core
- /docs/api/harness
- /docs/api/cli
- /docs/guides/capture-a-profile
llm-context:end -->
