# mochi examples

Runnable, copy-pasteable example projects. Each folder is self-contained — `cd <folder> && bun install && bun run index.ts` — and uses **published** versions of `@mochi.js/core` (not workspace deps), so the folder works anywhere.

Pair every example with its companion [cookbook recipe](https://mochijs.com/docs/guides/pick-a-scenario) for the walkthrough.

## Index

| Folder | Recipe page |
|---|---|
| [spa-infinite-scroll](./spa-infinite-scroll/) | https://mochijs.com/docs/guides/recipe-spa-infinite-scroll |
| [login-with-cookie-persistence](./login-with-cookie-persistence/) | https://mochijs.com/docs/guides/recipe-login-with-cookie-persistence |
| [multi-session-pool](./multi-session-pool/) | https://mochijs.com/docs/guides/recipe-multi-session-pool |
| [residential-proxy](./residential-proxy/) | https://mochijs.com/docs/guides/recipe-residential-proxy |
| [ci-github-actions](./ci-github-actions/) | https://mochijs.com/docs/guides/recipe-ci-github-actions |
| [cloudflare-turnstile](./cloudflare-turnstile/) | https://mochijs.com/docs/guides/recipe-cloudflare-turnstile |
| [captcha-escalation](./captcha-escalation/) | https://mochijs.com/docs/guides/recipe-captcha-escalation |
| [fingerprint-validation](./fingerprint-validation/) | https://mochijs.com/docs/guides/recipe-fingerprint-validation |
| [warm-session-replay](./warm-session-replay/) | https://mochijs.com/docs/guides/recipe-warm-session-replay |
| [headful-vs-headless](./headful-vs-headless/) | https://mochijs.com/docs/guides/recipe-headful-vs-headless |

## Conventions

- **Bun ≥ 1.1** runtime. Node and Deno are not supported (mochi invariant I-3).
- Every example is **standalone** — published deps in `package.json`, no `workspace:*`.
- `.env.example` is the contract; copy to `.env` and fill placeholders.
- License: MIT (matches the parent repo).

## When you'd actually run these

The recipes are designed to be educational templates, not turnkey production scripts. Read the matching recipe page for the architectural decisions; copy the example folder; adapt to your specific site / proxy / solver / fingerprint target.
