# Captcha Escalation

Decision tree for the Turnstile `onEscalation` callback — improve stealth posture (free, fast) before paying for a solver hand-off.

This example pairs with the [Captcha escalation patterns](https://mochijs.com/docs/guides/recipe-captcha-escalation) cookbook page. Read that page for the full walkthrough; this folder is the runnable form.

## Run

```sh
cp .env.example .env  # optional PROXY_URL and SOLVER_API_KEY
bun install
bun run index.ts
```

## What it does

- Walks through every `TurnstileEscalationReason` (`"image-challenge"`, `"managed"`, `"timeout"`) with concrete code for each branch.
- Rotates profile family across attempts (`mac-m4-chrome-stable` → `windows-chrome-stable`) — different `wreqPreset`, different UA-CH platform, different display dimensions.
- Uses `geoConsistency: "privacy-fallback"` so a tz/IP mismatch doesn't reintroduce the same posture leak.
- Sets `triggered = { reason, ... }` inside the callback and reacts in the caller — never closes the session from inside `onEscalation` (the auto-click poll loop is mid-tick).
- After three failed attempts, exits with code 1 — the canonical solver hand-off seam.

## Files

- `index.ts` — the script
- `.env.example` — copy to `.env` and fill placeholders
- `package.json` — published-package deps; copy this folder anywhere and it works

## See also

- Cookbook recipe: https://mochijs.com/docs/guides/recipe-captcha-escalation
- Decision matrix: https://mochijs.com/docs/guides/pick-a-scenario
- Limits + honest cut: https://mochijs.com/docs/reference/limits
