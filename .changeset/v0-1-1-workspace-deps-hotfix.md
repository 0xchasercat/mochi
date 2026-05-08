---
"@mochi.js/behavioral": patch
"@mochi.js/cli": patch
"@mochi.js/core": patch
"@mochi.js/harness": patch
"@mochi.js/inject": patch
"@mochi.js/net": patch
"@mochi.js/profiles": patch
---

Hot-fix v0.1.0's broken `workspace:*` references in published package.json
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
