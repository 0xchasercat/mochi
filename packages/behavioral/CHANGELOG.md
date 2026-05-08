# @mochi.js/behavioral

## 0.1.1

### Patch Changes

- 7073097: Hot-fix v0.1.0's broken `workspace:*` references in published package.json
  files. v0.1.0 leaked the Bun workspace protocol verbatim into published
  tarballs because `changeset publish` (which wraps `npm publish`) does NOT
  rewrite `workspace:*` to concrete semver ranges — that's a pnpm/yarn
  courtesy npm doesn't replicate. As a result, `bun add @mochi.js/core@0.1.0`
  fails with `Workspace dependency not found` for every internal dep
  (behavioral, consistency, inject, net), and the same for the 6 other
  packages with internal deps.

  The fix adds `scripts/rewrite-workspace-deps.ts` as a publish-time
  pre-hook in the root `release` script. Pre-publish, every `workspace:*`
  in `packages/<name>/package.json` is rewritten to `^<sibling-version>`
  resolved from the local workspace map. Bun's workspace links during
  dev still resolve via the `name` field, so concrete versions on disk
  between cycles don't break local development.

  Verified by `bun pack`-ing the affected packages locally and inspecting
  the resulting tarball's `package.json` deps before pushing v0.1.1.

  `@mochi.js/consistency` and `@mochi.js/net-rs` are leaf packages with no
  internal deps; they ship at v0.1.0/0.1.0 already and don't need a bump.

## 0.1.0

### Minor Changes

- 3fefd93: Land the phase 0.8 behavioral engine.

  `@mochi.js/behavioral` ships pure-data synthesizers for human-shaped input:
  mouse trajectories (cubic Bezier with overshoot+correction, Fitts's-Law
  duration, autocorrelated Gaussian jitter), keystroke timing (lognormal
  digraph delays, Gaussian press duration, QWERTY-adjacent mistake injection),
  and inertial scroll (exponential friction decay, 60Hz frame cap). Every
  synth function accepts `seed?: string` and produces byte-identical output
  for the same `(opts, seed)` pair, verified by a determinism suite (10
  iterations × 4 surfaces).

  `@mochi.js/core.Page.humanClick` / `humanType` / `humanScroll` graduate from
  `NotImplementedError` placeholders to real implementations that consume the
  behavioral synth arrays and dispatch them as `Input.dispatchMouseEvent` /
  `Input.dispatchKeyEvent`. The behavior parameters come from
  `MatrixV1.profile.behavior` (PLAN.md I-5) and may be overridden per call.

  `@mochi.js/consistency` promotes its xoshiro256\*\* PRNG and SHA-256 seed
  derivation to a public sub-export (`@mochi.js/consistency/prng`) so the
  behavioral package can share the same primitive — preserving the
  "single deterministic universe per `(profile, seed)`" invariant.

### Patch Changes

- 4f09750: Initial v0.0.1 claim release with placeholder exports. Surface lands incrementally per PLAN.md §14.
- Updated dependencies [3fefd93]
- Updated dependencies [29e1bb2]
- Updated dependencies [4f09750]
  - @mochi.js/consistency@0.1.0
