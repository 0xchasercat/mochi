---
"@mochi.js/cli": minor
---

Add `mochi browsers` subcommand surface and the programmatic `resolveChromiumBinary` helper that `@mochi.js/core` will consume in task 0011.

- `mochi browsers install [--channel] [--version] [--platform] [--force] [--sha256]` downloads a Chromium-for-Testing build from Google's CfT registry, verifies SHA256, and atomically installs to `~/.mochi/browsers/<channel>-<version>-<platform>/`.
- `mochi browsers list` prints installed binaries.
- `mochi browsers path` prints the binary path of the resolved install (designed for `BIN="$(mochi browsers path)"`).
- `mochi browsers uninstall <version>` removes an install.
- Programmatic `resolveChromiumBinary({channel, version, platform, root})` exported for downstream consumers; honors `MOCHI_CHROMIUM_PATH` env override.
- Pinned offline fallback (`131.0.6778.85`) when the CfT manifest is unreachable.
- Note: CfT does not publish per-asset SHA256 hashes; we compute and record SHA256 at install time and accept user-supplied `--sha256` for out-of-band verification. See `docs/limits.md`.
