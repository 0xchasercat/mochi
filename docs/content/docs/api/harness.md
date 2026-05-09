---
title: "@mochi.js/harness"
description: "Probe Manifest validation — capture, normalize, diff, categorize, report. The CI gate."
order: 5
category: api
lastUpdated: 2026-05-09
---

`@mochi.js/harness` closes mochi's correctness loop. It drives a Mochi-spoofed `Session` through `tests/fixtures/probe-page.html`, normalizes per-session entropy on both the captured manifest and the committed baseline, structurally diffs the two, categorizes each divergence as `guid-class | intentional | material`, and gates PRs on `material === 0`. The package also re-exports the stealth conformance helpers (`launchSharedSession`, `withPage`, `withRetries`, `evalExpr`) used by the Bun:test suite under `packages/harness/src/conformance/stealth/__tests__/`. CI calls this; humans call `mochi harness <profile-id>` (which wraps the same orchestrator).

## Installation

```sh
bun add @mochi.js/harness
```

## Public exports

### `function runHarnessAgainstProfile(profileId: string, opts?: RunHarnessOptions): Promise<DiffReportV1>`

The orchestrator. Resolves `<profilesDir>/<profileId>/{profile.json, baseline.manifest.json, expected-divergences.json?}`, launches a Mochi session with the full inject pipeline active (`hermetic: true`), drives it through the probe fixture, normalizes both sides, diffs, categorizes, and returns a `DiffReportV1`. The phase-0.5 PR gate is `report.counts.material === 0`.

```ts
import { runHarnessAgainstProfile } from "@mochi.js/harness";

const report = await runHarnessAgainstProfile("linux-chrome-stable", {
  headless: true,
});
console.log(`verdict: ${report.verdict} (material=${report.counts.material})`);
process.exit(report.counts.material === 0 ? 0 : 1);
```

### `interface RunHarnessOptions`

```ts
interface RunHarnessOptions {
  readonly online?: boolean;          // plumbed but throws at v0.5.x
  readonly profilesDir?: string;      // default: <repo-root>/packages/profiles/data
  readonly cwd?: string;              // start dir for repo-root resolution
  readonly seed?: string;             // default: `harness-${profileId}`
  readonly headless?: boolean;        // default: true
  readonly browserPath?: string;      // falls back to MOCHI_CHROMIUM_PATH
  readonly probeTimeoutMs?: number;   // default: 30000
}
```

### `function diffAndReport(args): DiffReportV1`

Pure post-capture half of the orchestrator. Accepts pre-captured + pre-loaded manifests; useful in unit tests that want to exercise diff/categorize/report without spawning a browser.

```ts
function diffAndReport(args: {
  profileId: string;
  baseline: CapturedProbeManifest;
  captured: CapturedProbeManifest;
  expectedDivergencePaths?: readonly string[];
  now?: () => Date;
}): DiffReportV1;
```

### `function capture(session, opts?: CaptureOptions): Promise<CapturedProbeManifest>`

Drive a `Session` through the probe-page fixture and collect a `ProbeManifestV1`-shaped record.

```ts
import { mochi } from "@mochi.js/core";
import { capture } from "@mochi.js/harness";

const session = await mochi.launch({ profile: "linux-chrome-stable", seed: "x", hermetic: true });
const manifest = await capture(session);
await session.close();
console.log(Object.keys(manifest));
```

### `type CapturedProbeManifest = Record<string, JsonValue>`

Free-form record — the manifest is loosely typed at this layer because new probes land iteratively. Validate against `ProbeManifestV1` (generated from `schemas/probe-manifest.schema.json`) when you need stricter type guarantees.

### `interface CaptureOptions`

```ts
interface CaptureOptions {
  readonly probeTimeoutMs?: number;  // default 30000
  readonly cwd?: string;             // for fixture resolution
  // ... — see packages/harness/src/capture.ts for the full shape
}
```

### `function defaultFixtureUrl(start?: string): string`

Resolve `tests/fixtures/probe-page.html` from the repo root into a `file://` URL.

### `function normalize(manifest): NormalizedManifest`

Strip GUIDs, CSP nonces, timestamps, bundle URLs, hostnames — replace each with the corresponding `SENTINELS.*` token so per-session entropy doesn't show up as a diff.

```ts
import { normalize, SENTINELS, ALL_SENTINELS, isNormalized } from "@mochi.js/harness";

const norm = normalize(captured);
isNormalized(norm); // true
```

### `const SENTINELS` + `type Sentinel` + `const ALL_SENTINELS`

```ts
const SENTINELS = {
  guid: "<GUID>",
  nonce: "<CSP_NONCE>",
  timestamp: "<TIMESTAMP>",
  hostname: "<HOSTNAME>",
  bundleUrl: "<BUNDLE_URL>",
  // ...
} as const;
type Sentinel = (typeof SENTINELS)[keyof typeof SENTINELS];
const ALL_SENTINELS: readonly string[];
```

### `function isNormalized(v: unknown): v is NormalizedManifest`

Type guard — useful when threading a normalized manifest through generic JSON helpers.

### `function diff(expected, actual): DiffEntry[]`

Flat structural deep-diff with path-based output. `expected` is the baseline; `actual` is the captured manifest. Returns one entry per divergence.

```ts
function diff(expected: JsonValue | undefined, actual: JsonValue | undefined): DiffEntry[];
```

### `function countLeaves(value): number`

Count the leaf-value cells of a JSON tree — used to compute `report.structuralMatchPct`.

### `function categorize(d, expected?): Category`

Categorize a single `DiffEntry` as `"guid-class" | "intentional" | "material"`. `expected` is a list of dotted-path patterns from the profile's `expected-divergences.json`.

### `function categorizeAll(entries, expected?): DiffEntry[]`

Bulk categorize. Returns the entry list with each entry's `category` field populated.

### `function isGuidClassPair(a, b): boolean`

Pair-level guid-class detection — `true` when two values differ only by a GUID/nonce/timestamp pattern.

### `interface ExpectedDivergences` + `interface ExpectedDivergenceEntry`

```ts
interface ExpectedDivergences {
  paths: readonly ExpectedDivergenceEntry[];
}
interface ExpectedDivergenceEntry {
  path: string;             // dotted/glob path
  reason: string;
  // ...
}
```

The shape of `packages/profiles/data/<id>/expected-divergences.json`.

### `function report(profileId, entries, baselineLeaves, now?): DiffReportV1`

Build a `DiffReportV1` from a categorized entry list.

### `function html(report): string`

Render a `DiffReportV1` as an HTML report (used by `mochi harness --out`).

### `function summary(report): string`

Render a one-line `verdict + counts` summary.

### `interface DiffReportV1` + `interface DiffEntry` + `type Verdict`

```ts
interface DiffReportV1 {
  reportVersion: "1";
  generatedAt: string;            // ISO-8601
  profile: string;                // ProfileV1.id this report targets
  verdict: "EQUIVALENT" | "DIVERGED";
  counts: {
    material: number;             // non-allowlisted, non-intentional. PR-blocking.
    intentional: number;          // listed in expected-divergences.json
    guidClass: number;            // per-session GUID-class entropy that matched the allowlist regex
  };
  structuralMatchPct: number;     // % of fields whose paths AND values both matched
  diffs: DiffEntry[];             // path-sorted, then category-sorted
}

interface DiffEntry {
  path: string;                   // dotted path, e.g. "page.tls.ja4"
  category: "guid-class" | "intentional" | "material";
  expected: JsonValue;            // baseline value at this path (any JSON, including null)
  actual: JsonValue;              // captured value at this path
  rule?: string;                  // optional human-readable id of the categorization rule
}

type Verdict = DiffReportV1["verdict"]; // "EQUIVALENT" | "DIVERGED"
```

Generated from `schemas/diff-report.schema.json`. `verdict === "EQUIVALENT"` iff `counts.material === 0`.

### `function match(pattern, path): boolean`

Glob match against a dotted path. Used internally by `categorize`; exposed for downstream tooling.

### `function matchAny(patterns, path): boolean`

Multi-pattern variant — returns `true` if any pattern matches.

### `function listProfiles(profilesDir?: string): Promise<string[]>`

Enumerate subdirectories under `profilesDir`; returns `[]` if none.

### `function loadProfile(profileDir: string): Promise<ProfileV1>`

Load a `ProfileV1` from `<profileDir>/profile.json`.

### `function loadBaseline(profileDir: string): Promise<CapturedProbeManifest>`

Load `<profileDir>/baseline.manifest.json`.

### `function loadExpectedDivergences(profileDir: string): Promise<ExpectedDivergences | undefined>`

Load `<profileDir>/expected-divergences.json` if it exists; undefined otherwise.

### `function defaultProfilesDir(start?: string): string`

Resolve `<repo-root>/packages/profiles/data` from a starting cwd.

## Stealth conformance helpers

Re-exported from `packages/harness/src/conformance/stealth/helpers.ts` for use in Bun:test suites that want to share a Session across `describe` blocks (mirroring CloakBrowser's `@pytest.fixture(scope="module") browser` pattern).

### `function launchStealthSession(): Promise<Session>`

Launch a Session for `CONFORMANCE_PROFILE` (`mac-m4-chrome-stable`) with full inject + `hermetic: true`. Honors `MOCHI_CHROMIUM_PATH` and `MOCHI_PROXY` env vars. Headless by default.

### `function withStealthPage<T>(session, fn): Promise<T>`

Open a page, run `fn(page)`, close the page on exit (errors swallowed during teardown).

### `function stealthEvalExpr<T>(page, expr): Promise<T>`

Evaluate a JS *expression* string in the page's main world (e.g. `"navigator.webdriver"`). Wraps as `() => (expr)` and routes through `page.evaluate`.

### `function withStealthRetries<T>(fn, attempts?): Promise<T>`

Retry `fn` up to `attempts` times (default 3) with exponential backoff (250ms → 500ms → 1000ms). The brief's flake-guard for offline-flaky online probes.

### `const CONFORMANCE_PROFILE: "mac-m4-chrome-stable"`

The profile id the conformance suite runs against.

### `const CONFORMANCE_SEED: "stealth-conformance"`

The fixed seed.

### `const STEALTH_E2E_ENABLED: boolean`

`true` iff `MOCHI_E2E === "1"`. Conformance suites are `describe.skip` unless this is set.

### `const STEALTH_ONLINE_ENABLED: boolean`

`true` iff `STEALTH_E2E_ENABLED && MOCHI_ONLINE === "1"`. Network-gated tests skip otherwise.

### `const STEALTH_EXPECTED_FAILURES: readonly StealthExpectedFailure[]`

Registry of known-failing online stealth probes (e.g. the `bot.incolumitas.com` anti-debugger trap). Each entry carries `{ id, reason, ... }`.

### `function findStealthExpectedFailure(id): StealthExpectedFailure | undefined`

Lookup by id.

## Environment variables

| Var | Effect |
| --- | --- |
| `MOCHI_E2E=1` | Enables E2E gates (otherwise `describe.skip`) |
| `MOCHI_ONLINE=1` | Enables network-gated probes (requires `MOCHI_E2E=1`) |
| `MOCHI_CHROMIUM_PATH` | Override CfT binary path |
| `MOCHI_PROXY` | Proxy URL for `launchStealthSession` |

## CI gate behavior

A profile passes the harness iff `report.counts.material === 0`. Anything in `material` blocks merge until either (a) the inject pipeline is fixed, or (b) the divergence is moved to `expected-divergences.json` *with a corresponding entry in [Reference → Limits](/docs/reference/limits)*. The second path requires explicit reviewer approval.

## Common patterns

### Run the harness against one profile

```ts
import { runHarnessAgainstProfile } from "@mochi.js/harness";

const r = await runHarnessAgainstProfile("linux-chrome-stable");
console.log(r.verdict, r.counts);
```

### Pure post-capture diff in a unit test

```ts
import { diffAndReport } from "@mochi.js/harness";

const report = diffAndReport({
  profileId: "linux-chrome-stable",
  baseline: bake(staticBaseline),
  captured: bake(observedManifest),
  expectedDivergencePaths: ["userAgent", "screen.dpr"],
  now: () => new Date("2026-05-09T00:00:00Z"),
});
```

### Conformance test (sharing a Session across cases)

```ts
import { describe, beforeAll, afterAll, test, expect } from "bun:test";
import {
  launchStealthSession,
  withStealthPage,
  stealthEvalExpr,
  STEALTH_E2E_ENABLED,
} from "@mochi.js/harness";

describe.skipIf(!STEALTH_E2E_ENABLED)("stealth basics", () => {
  let session: Awaited<ReturnType<typeof launchStealthSession>>;
  beforeAll(async () => { session = await launchStealthSession(); });
  afterAll(async () => { await session.close(); });

  test("navigator.webdriver is false", async () => {
    await withStealthPage(session, async (page) => {
      await page.goto("about:blank");
      expect(await stealthEvalExpr<boolean>(page, "navigator.webdriver")).toBe(false);
    });
  });
});
```

## See also

- [Concepts → Probe manifest](/docs/concepts/probe-manifest)
- [Guides → Conformance suite](/docs/guides/conformance-suite)
- [API → @mochi.js/core](/docs/api/core)
- [API → @mochi.js/profiles](/docs/api/profiles)
- [API → mochi CLI](/docs/api/cli) — `mochi harness` and `mochi capture`
- [Reference → Limits](/docs/reference/limits)

<!-- llm-context:start
Package: @mochi.js/harness
Public surface (verbatim from packages/harness/src/index.ts as of 2026-05-09):

  VERSION                                          (const, "0.5.0")

Generated types:
  DiffEntry, DiffReportV1, JsonValue               (from "./generated/diff-report")
  Probe, ProbeManifestV1                           (from "./generated/probe-manifest")
  Verdict = DiffReportV1["verdict"]

Functions / values:
  capture(session, opts?: CaptureOptions): Promise<CapturedProbeManifest>
  CapturedProbeManifest = Record<string, JsonValue>
  CaptureOptions
  defaultFixtureUrl(start?: string): string

  Category, ExpectedDivergenceEntry, ExpectedDivergences (types)
  categorize(d: DiffEntry, expected?: readonly string[]): Category
  categorizeAll(entries, expected?): DiffEntry[]
  isGuidClassPair(a, b): boolean

  STEALTH_EXPECTED_FAILURES (= EXPECTED_FAILURES under the hood)
  StealthExpectedFailure (= ExpectedFailure)
  findStealthExpectedFailure(id): StealthExpectedFailure | undefined

  CONFORMANCE_PROFILE  ("mac-m4-chrome-stable")
  CONFORMANCE_SEED     ("stealth-conformance")
  STEALTH_E2E_ENABLED  (boolean from process.env.MOCHI_E2E === "1")
  STEALTH_ONLINE_ENABLED (boolean)
  stealthEvalExpr(page, expr) (= evalExpr)
  launchStealthSession() (= launchSharedSession)
  withStealthPage(session, fn) (= withPage)
  withStealthRetries(fn, attempts?) (= withRetries)

  countLeaves(value), diff(expected, actual)

  match(pattern, path), matchAny(patterns, path)

  ALL_SENTINELS, isNormalized, NormalizedManifest, normalize, SENTINELS, Sentinel

  html(report), report(profileId, entries, baselineLeaves, now?), summary(report)

  defaultProfilesDir(start?), diffAndReport(args), listProfiles(profilesDir?),
  loadBaseline(profileDir), loadExpectedDivergences(profileDir), loadProfile(profileDir),
  RunHarnessOptions, runHarnessAgainstProfile(profileId, opts?)

NOTE: There is NO `runHarnessSmoke` export. The orchestrator is `runHarnessAgainstProfile`.

Common LLM hallucinations (DO NOT USE):
- `runHarnessSmoke()` — does not exist; the orchestrator is `runHarnessAgainstProfile(profileId, opts?)`
- `runHarness({ profile, ... })` — first arg is the profile id (string), not an options bag
- `Harness.runAgainst(profile)` — no class export
- `runHarnessAgainstProfile(profile, opts)` where profile is a ProfileV1 object — first arg is the profile id (string)
- Online harness path — `online: true` is plumbed but throws at v0.5.x; do not promise it works
- `categorize(entry, profile)` — second arg is `expected: readonly string[]` (path patterns), not a profile
- `diff(a, b, options)` — only two args; no options
- `loadProfile(id)` — takes a profile *directory* path, not a profile id
- `mochi.launch(profile)` inside this package — harness imports from `@mochi.js/core`; do not duplicate
- `MOCHI_E2E=true` (string "true") — gate is `=== "1"`, not "true"

Re-exported helpers WERE renamed at the barrel level — note the prefix:
  - launchSharedSession  →  launchStealthSession
  - withPage             →  withStealthPage
  - withRetries          →  withStealthRetries
  - evalExpr             →  stealthEvalExpr
  - E2E_ENABLED          →  STEALTH_E2E_ENABLED
  - ONLINE_ENABLED       →  STEALTH_ONLINE_ENABLED
  - EXPECTED_FAILURES    →  STEALTH_EXPECTED_FAILURES
  - ExpectedFailure      →  StealthExpectedFailure
  - findExpectedFailure  →  findStealthExpectedFailure

Cross-references:
- /docs/concepts/probe-manifest
- /docs/guides/conformance-suite
- /docs/api/core
- /docs/api/profiles
- /docs/api/cli
- /docs/reference/limits
llm-context:end -->
