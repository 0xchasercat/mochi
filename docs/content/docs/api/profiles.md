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

The package's JS surface is intentionally tiny: a list of shipped IDs, the `getProfile(id) → ProfileV1` async lookup, the `hasProfile(id) → boolean` predicate, and two error classes. `mochi.launch({ profile: "<id>", seed })` resolves the id by calling `getProfile(id)` internally; if the id is in `KNOWN_PROFILE_IDS` but no captured baseline ships, the launcher catches `ProfileBaselineMissingError` and falls back to a synthesized placeholder profile.

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

The IDs that ship in the v1 catalog. Pass any of these as `LaunchOptions.profile`. **Six** of the eleven ship with a captured baseline (`profile.json` + `baseline.manifest.json` on disk): `linux-chrome-stable`, `mac-brave-stable`, `mac-chrome-beta`, `mac-chrome-stable`, `mac-m4-chrome-stable`, `windows-chrome-stable`. The other five (`mac-m2-chrome-stable`, `mac-m1-chrome-stable`, `mac-intel-chrome-stable`, `win11-chrome-stable`, `win11-edge-stable`) are declared in the catalog so the type system tracks them, but `getProfile` throws `ProfileBaselineMissingError` for those — `mochi.launch` catches the error and falls back to a synthesized placeholder profile.

### `type ProfileId`

```ts
type ProfileId = (typeof KNOWN_PROFILE_IDS)[number];
```

A string-literal union of every shipped id. Use when you want autocomplete in your editor; `LaunchOptions.profile` is typed as `string | ProfileV1` so any string works at runtime.

### `type ProfileV1`

Re-exported from `@mochi.js/consistency` through a generated shim. The canonical source-of-truth lives in `@mochi.js/consistency` (see [API → consistency](/docs/api/consistency)). Re-exported here so consumers of this package can type the JSON they load without pulling in the rule DAG.

### `function getProfile(id: ProfileId): Promise<ProfileV1>`

```ts
function getProfile(id: ProfileId): Promise<ProfileV1>;
```

Resolve a profile by id, loading the captured `data/<id>/profile.json` baseline that ships with this package. Uses `Bun.file().json()` under the hood and works both in-source (running from `packages/profiles/src/`) and after publish (the `data/` dir ships as a sibling of `src/`).

Throws:

- `UnknownProfileIdError` if `id` isn't in `KNOWN_PROFILE_IDS` at all (defensive — callers using `as ProfileId` may sneak unknown values past the type system).
- `ProfileBaselineMissingError` if `id` is known but no captured baseline ships in the package — callers may catch this and fall back to a placeholder synthesis. `mochi.launch` does exactly that internally.

```ts
import { getProfile, ProfileBaselineMissingError } from "@mochi.js/profiles";
import { deriveMatrix } from "@mochi.js/consistency";

try {
  const profile = await getProfile("linux-chrome-stable");
  const matrix = deriveMatrix(profile, "harness");
  console.log(matrix.userAgent);
} catch (err) {
  if (err instanceof ProfileBaselineMissingError) {
    // Known catalog id, no baseline yet — fall back to a synthesized placeholder.
  } else {
    throw err;
  }
}
```

### `function hasProfile(id: string): Promise<boolean>`

```ts
function hasProfile(id: string): Promise<boolean>;
```

True when `getProfile(id)` would successfully load — i.e. the id is in `KNOWN_PROFILE_IDS` AND a captured baseline ships AND the file exists on disk. Useful for callers that want to decide between the real-baseline path and a placeholder synthesis without catching exceptions. Accepts `string`, not `ProfileId`, so unknown ids return `false` rather than narrowing.

### `class UnknownProfileIdError extends Error`

```ts
class UnknownProfileIdError extends Error {
  readonly name: "UnknownProfileIdError";
  readonly id: string;
}
```

Thrown by `getProfile` when `id` isn't in `KNOWN_PROFILE_IDS`. Carries the bad id on `.id` for diagnostics. The error message lists every known id verbatim so a typo's fix is in the stack trace.

### `class ProfileBaselineMissingError extends Error`

```ts
class ProfileBaselineMissingError extends Error {
  readonly name: "ProfileBaselineMissingError";
  readonly id: ProfileId;
}
```

Thrown by `getProfile` when `id` is a valid catalog entry but no captured baseline (`data/<id>/profile.json`) ships in the package — typically a declared-but-not-yet-captured device class. `mochi.launch` catches this internally and falls back to a synthesized placeholder profile so end users see a working session even on the placeholder ids.

### `const VERSION: string`

The npm package version.

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
import { getProfile } from "@mochi.js/profiles";
import { deriveMatrix } from "@mochi.js/consistency";

const profile = await getProfile("linux-chrome-stable");
const matrix = deriveMatrix(profile, "harness");
console.log(matrix.userAgent);
```

### Probe whether a profile has a captured baseline

```ts
import { hasProfile, KNOWN_PROFILE_IDS } from "@mochi.js/profiles";

for (const id of KNOWN_PROFILE_IDS) {
  console.log(id, await hasProfile(id));
}
// linux-chrome-stable     true
// mac-m4-chrome-stable    true
// mac-m2-chrome-stable    false   ← placeholder; launcher synthesizes
// ...
```

### Enumerate the catalog

```ts
import { KNOWN_PROFILE_IDS } from "@mochi.js/profiles";

for (const id of KNOWN_PROFILE_IDS) {
  console.log(id);
}
```

## Errors

| Call | When it fires | How to recover |
| --- | --- | --- |
| `getProfile(id)` → `UnknownProfileIdError` | `id` is not in `KNOWN_PROFILE_IDS` (typo, custom id) | Pick from `KNOWN_PROFILE_IDS`, or use an inline `ProfileV1` |
| `getProfile(id)` → `ProfileBaselineMissingError` | `id` is in the catalog but no captured baseline ships yet | Catch and fall back to a placeholder, or pick a profile in the captured-baseline list |

## See also

- [Concepts → Profiles](/docs/concepts/profiles)
- [API → @mochi.js/consistency](/docs/api/consistency)
- [API → @mochi.js/core](/docs/api/core)
- [API → @mochi.js/harness](/docs/api/harness) — `loadProfile`, `loadBaseline`, `defaultProfilesDir`
- [API → mochi CLI](/docs/api/cli) — `mochi capture`, `mochi profiles import`
- [Guides → Capture a profile](/docs/guides/capture-a-profile)

<!-- llm-context:start
Package: @mochi.js/profiles
Public surface (verbatim from packages/profiles/src/index.ts):

  VERSION                                          (const string)
  ProfileV1                                        (type, re-exported from @mochi.js/consistency via generated shim)
  KNOWN_PROFILE_IDS                                (readonly tuple of profile ids)
  ProfileId = (typeof KNOWN_PROFILE_IDS)[number]
  getProfile(id: ProfileId): Promise<ProfileV1>
  hasProfile(id: string): Promise<boolean>
  UnknownProfileIdError                            (class, thrown by getProfile for unknown ids)
  ProfileBaselineMissingError                      (class, thrown by getProfile for declared-but-unsupplied baselines)

Shipped IDs (verbatim, 11 total):
  mac-m4-chrome-stable, mac-m2-chrome-stable, mac-m1-chrome-stable, mac-intel-chrome-stable,
  win11-chrome-stable, win11-edge-stable, linux-chrome-stable,
  mac-chrome-stable, mac-chrome-beta, windows-chrome-stable, mac-brave-stable

Of those 11, exactly 6 ship with a captured baseline:
  linux-chrome-stable, mac-brave-stable, mac-chrome-beta, mac-chrome-stable,
  mac-m4-chrome-stable, windows-chrome-stable
The other 5 throw `ProfileBaselineMissingError` from getProfile; mochi.launch catches and falls back to a synthesized placeholder.

Common LLM hallucinations (DO NOT USE):
- `getProfile(id)` is sync — false; it returns Promise<ProfileV1>
- `loadProfile(id)` exported here — NOT exported; use `getProfile`
- `Profile` (without V1 suffix) — the type is `ProfileV1`, re-exported through a generated shim
- `import profile from "@mochi.js/profiles/data/linux-chrome-stable"` — there is no per-id import path; use `getProfile`
- `getBaseline(id)` / `getProvenance(id)` — not exposed in this package
- `addProfile(id, profile)` / mutation API — profiles are file-system fixtures; mutate via `mochi capture` / `mochi profiles import`

Cross-references:
- /docs/concepts/profiles
- /docs/api/consistency
- /docs/api/core
- /docs/api/harness
- /docs/api/cli
- /docs/guides/capture-a-profile
llm-context:end -->
