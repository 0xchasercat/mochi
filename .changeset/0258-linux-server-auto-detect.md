---
"@mochi.js/core": minor
---

Auto-detect Linux server env, default to `--headless=new`, surface a `headlessMode` option (task 0258).

Closes the "common deployment env" failure mode for `mochi.launch()` on a fresh Ubuntu / Debian server: previously a no-DISPLAY box would either crash on the first paint or hang while Chromium tried to attach to a non-existent display server. mochi now snapshots `(process.platform, DISPLAY, WAYLAND_DISPLAY, getuid, container probes)` at launch time and defaults `headlessMode` to `"new"` whenever the host is Linux without a display server.

New `LaunchOptions` field:

- **`headlessMode: "new" | "legacy" | "off"`** — supersedes the v0.1 `headless: boolean`. `"new"` emits `--headless=new` (modern headless: full rendering, near-byte-identical to headful for fingerprinting). `"legacy"` emits bare `--headless` for parity with older tooling. `"off"` runs headful and requires a display server / xvfb. The legacy `headless` field is retained — `true` maps to `"new"`, `false` to `"off"`.

Resolution order:

1. Explicit `headlessMode` wins.
2. Legacy `headless: true | false` maps to `"new"` / `"off"`.
3. Env-aware default — Linux without DISPLAY / WAYLAND_DISPLAY → `"new"`; everywhere else → `"off"`.

New helper:

- **`mochi.detectLinuxServerEnv()`** (and the named export `detectLinuxServerEnv` / `probeLinuxServerEnv`) — pure read of `process.platform`, `process.env.DISPLAY`, `process.env.WAYLAND_DISPLAY`, `process.getuid?.()`, and the container probes (`/.dockerenv`, `/proc/1/cgroup` mentions of `docker | containerd | kubepods`). Returns a `LinuxServerEnv` summary `{ serverNoDisplay, root, container, rationale }` so users can introspect what mochi would infer before launching.
- **`resolveHeadlessMode(opts, env)`** — pure helper exposing the resolution table above, for callers that want to reason about the default without spawning.

The existing root + auto-`--no-sandbox` fallback is unchanged — orthogonal axis, kept verbatim. Stealth conformance (`webdriver-detection.test.ts`) remains green: the inject layer rewrites the UA via `Network.setUserAgentOverride` so the `HeadlessChrome` substring under `--headless=new` never reaches the network or the page's `navigator.userAgent`.

Docs: new `docs/getting-started/linux-server.md` covers the auto-detection, the `headlessMode` option, container guidance (Docker / Kubernetes / `--cap-add=SYS_ADMIN` trade-off), and the "if you really need it" xvfb path. `docs/quickstart.md` cross-links to the new page.
