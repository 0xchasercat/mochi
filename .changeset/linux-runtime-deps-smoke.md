---
"@mochi.js/cli": minor
"@mochi.js/core": patch
---

First-run UX on Linux — close two opaque-crash surfaces.

`mochi browsers install` now runs a `<binary> --version` smoke after extract on `linux64`. On `error while loading shared libraries: <name>.so` we parse the offending lib, print the verbatim apt install line for the canonical Chromium-for-Testing dep set (the same list both CI workflows install), and exit non-zero so the user knows the install isn't truly done. On success we print "Chromium binary verified — launches cleanly". The install command also prints a one-line warning if it detects `uid === 0` so the root-sandbox gotcha shows up before the launch crashes opaquely. The CLI does not auto-`sudo` — the user runs the apt line themselves.

`@mochi.js/core` extends the v0.1.4 early-exit diagnostic in `proc.ts` with a second pattern matching the same missing-shared-libraries stderr — so any future `mochi.launch()` that hits this case (e.g. user installed mochi pre-v0.1.5 and ran the smoke before the apt-get) surfaces the same hint instead of the bare `BrowserCrashedError` / `EPIPE`.

Both CI workflows + the new install path share a single `LINUX_RUNTIME_DEPS` constant in `packages/cli/src/lib/linux-deps.ts`; a contract test asserts the workflows install every dep in the constant so they cannot drift. Plus a "Linux runtime dependencies" Prerequisites block in `docs/quickstart.md` and `docs/content/docs/getting-started/install.md`.
