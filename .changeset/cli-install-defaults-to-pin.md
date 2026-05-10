---
"@mochi.js/cli": patch
---

`mochi browsers install` (no flags) now downloads `PINNED_FALLBACK_VERSION` instead of CfT's live "Stable" channel.

Previous behavior: bare `bunx mochi browsers install` consulted the CfT registry's `last-known-good-versions.stable` field and downloaded whatever Chrome called Stable that minute — typically a version newer than the catalog of captured profiles (`@mochi.js/profiles@0.2.0` is calibrated against Chrome 147; live Stable is currently 148+). That's the canonical R-004 mismatch: the inject layer spoofs UA to 147 (per the captured profile) against a 148 binary, and detectors flag "Different browser version".

New behavior: with no flags, the installer treats the pinned version as the contract — same Chrome major as the inject layer spoofs. Users who want the live Stable channel pass `--channel stable` explicitly; users who want any other build pass `--version <X.Y.Z.W>`.

This matches what the docs already advertised: `getting-started/install.md` describes `mochi browsers install` as "downloads the pinned Chromium-for-Testing build for your platform". The implementation now does that.

To refresh after upgrading:

```sh
bunx mochi browsers install --force
```

The `--force` flag removes the off-pin cached binary and downloads the pinned 147.0.7727.138.
