# 0220: Turnstile auto-click convenience layer

**Package:** new — `@mochi.js/challenges`
**Phase:** `0.2`
**Estimated size:** M
**Dependencies:** v0.1.0 published, behavioral synth (already shipped in v0.1.0), inject pipeline (shipped)

## Goal

Add an opt-in convenience layer that detects Cloudflare Turnstile widgets on a page and auto-clicks them with the existing behavioral synth. Closes the most-requested convenience gap vs `puppeteer-real-browser`. Scope is **auto-click only** for v0.2 — no image/audio challenge solving, no 3rd-party API integrations (those are v0.3+).

After this lands: `mochi.launch({ challenges: { turnstile: { autoClick: true } } })` Just Works on the ~80% of Turnstile deployments that show a visible checkbox.

## Success criteria

### Package scaffold

- [ ] New package `packages/challenges/` with the standard layout (`src/`, `package.json`, `tsconfig.json`, `README.md`). Workspace-linked. License MIT. Bun >=1.1.
- [ ] Public API exported from `@mochi.js/challenges`:
  - `installTurnstileAutoClick(page: Page, opts?: TurnstileOptions): Disposable`
  - `TurnstileOptions = { timeout?: number; humanize?: boolean; onSolved?: () => void; onEscalation?: (reason: string) => void }`
- [ ] Re-export through `@mochi.js/core` so `LaunchOptions.challenges.turnstile.autoClick` works ergonomically. The `Session` calls `installTurnstileAutoClick(page)` on every new page when the option is set.

### Detection

- [ ] MutationObserver-equivalent installed via `Page.addScriptToEvaluateOnNewDocument(runImmediately: true, worldName: "")` (main world per PLAN.md §8.4). Watches for iframe `src` matching `challenges.cloudflare.com/turnstile/`.
- [ ] On detection, message back to mochi via a signed `console.debug({ __mochi_event: "turnstile-detected", ... })` channel (already used by other inject modules).
- [ ] Mochi-side listener picks up the event, locates the iframe in the page tree via CDP `Page.getFrameTree`.

### Click

- [ ] Click happens on the parent page (not inside the iframe — Cloudflare scripts the click on the parent).
- [ ] Locate the visible checkbox region: read iframe bounding rect via `DOM.getBoxModel`, then click in a small jitter-box around the center.
- [ ] **Reuse the existing behavioral synth** (Bezier mouse path + Fitts's-Law dwell from `@mochi.js/behavioral`). Don't reinvent — call into it.
- [ ] Wait for the post-click verify spinner to clear, then check the response token: Turnstile sets a hidden `cf-turnstile-response` field on success.
- [ ] If `onSolved` is provided, fire it with the token.

### Escalation handling

- [ ] If Turnstile escalates to image/audio challenge (the iframe `src` changes to `/challenges/turnstile/.../challenge.html` or similar pattern, OR a verification iframe appears that's not a checkbox):
  - Fire `onEscalation("image-challenge")` if provided.
  - Otherwise: log to stderr and stop trying. Do NOT click randomly.
- [ ] Timeout: if the response token doesn't appear within `opts.timeout` (default 30s after click), fire `onEscalation("timeout")`.

### Detection robustness

- [ ] Handle the invisible / managed Turnstile variants gracefully — these don't have a checkbox; they auto-resolve on page load. Don't try to click; just wait for the response token.
- [ ] Handle the non-interactive variant (`data-callback` only) by listening for the callback fire instead of clicking.
- [ ] Handle multiple Turnstile widgets per page (rare but possible).

### API surface

```ts
// Direct usage (manual control)
import { installTurnstileAutoClick } from "@mochi.js/challenges";

const session = await mochi.launch({ profile: "...", seed: "..." });
const page = await session.newPage();
const dispose = installTurnstileAutoClick(page, {
  timeout: 30_000,
  onSolved: () => console.log("turnstile passed"),
  onEscalation: (reason) => console.warn("escalation:", reason),
});
await page.goto("https://example.com");
// ... do stuff ...
dispose();

// Or via launch option (recommended)
const session = await mochi.launch({
  profile: "...",
  seed: "...",
  challenges: { turnstile: { autoClick: true, timeout: 30_000 } },
});
// All pages from this session auto-click Turnstile.
```

### Tests

- [ ] Unit tests for the inject-side detection (jsdom-based, fire mock iframe insertion → assert event emitted).
- [ ] Cross-package contract test: mock CDP transport, drive `Session` with `challenges.turnstile.autoClick: true`, assert the inject module is added on every `newPage`.
- [ ] **Conformance test (online, gated by `MOCHI_ONLINE=1`)**: a fixture page with a real Turnstile widget. We can use Cloudflare's public test site `https://demo.turnstile.workers.dev/` or self-host a fixture.
- [ ] Conformance test verifies: after `page.goto(...)`, a Turnstile token appears within 20s. Pin to v0.2 conformance suite.

### Docs

- [ ] `packages/challenges/README.md` covering: scope (auto-click only, not full solving), invariants (uses existing behavioral synth, no new fingerprint surface), how to opt in, when to add 3rd-party solver.
- [ ] Add to top-level mochi README's "convenience" section.
- [ ] `docs/limits.md` v0.2 entry: "Turnstile auto-click covers visible-checkbox variants only. Image/audio challenges + invisible-failed-bot escalation require 3rd-party solver hooks (v0.3)."

### Other

- [ ] Changeset: minor bump on `@mochi.js/challenges` (new package), patch on `@mochi.js/core` (LaunchOptions surface extension).
- [ ] No new runtime dependencies beyond what mochi already pulls in. The whole thing is achievable with the existing inject + behavioral + CDP layers.

## Out of scope

- hCaptcha — same shape, separate task (v0.3).
- reCAPTCHA v2/v3 — different mechanism (audio/visual challenges), needs 3rd-party solver hooks.
- 2captcha / anticaptcha API integrations — v0.3+ via the `onEscalation` callback.
- Cloudflare's full bot-management bypass — Turnstile is one component; the rest (TLS fingerprint, behavioral consistency) is already mochi's main job.
- Visible "I'm not a robot" reCAPTCHA — different vendor, different DOM, different bypass strategy.

## Implementation notes

- See `PLAN.md` §8.4 (inject pattern with `worldName: ""` main-world), §11 (behavioral synth — the Bezier + Fitts's-Law APIs to call into), §13.6 (signed console-debug channel for inject→mochi events).
- See `packages/inject/src/modules/*` for existing inject module patterns. `packages/behavioral/src/*` for the click/move APIs.
- Do NOT add new fingerprintable surfaces — the inject module must be invisible to other page scripts. Use the existing console.debug-with-signed-payload channel; don't add new globals.
- The detection MutationObserver must NOT fire on every DOM mutation — filter to iframe inserts only.

## Validation

```sh
bun run typecheck       # 10 packages now (incl. challenges)
bun run lint
bun run test            # unit + contract for challenges
bun run test:contract
# online conformance — needs MOCHI_E2E=1 + MOCHI_ONLINE=1 + Turnstile fixture URL
```

## Submission

```sh
bun work create 0220 challenges
cd worktrees/0220
# implement
bun work submit 0220 --draft
```
