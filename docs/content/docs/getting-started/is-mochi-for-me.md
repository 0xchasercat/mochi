---
title: Is mochi for me?
description: A 60-second decision page. When mochi is the right tool, when it isn't, and what to use instead.
order: 0
category: getting-started
lastUpdated: 2026-05-09
---

mochi is a Bun-native browser automation framework focused on **stealth as a first-class architectural concern** rather than a layer of patches over Playwright or Puppeteer. It exists because the JS ecosystem's incumbent answer — Patchright + a fingerprint injector + a Turnstile clicker + curl-impersonate + a Playwright wrapper — is fragile, leaky, and hard to reason about as a single coherent system. mochi is one library that owns the whole pipeline: pipe-mode CDP transport, a 48-rule relational consistency engine, JIT-friendly inject delivery via `Fetch.fulfillRequest`, full Bezier+Fitts behavioral synthesis, and a Chromium-native out-of-band fetch (`Session.fetch` rides the browser's network stack via CDP, so JA4/JA3/H2 are real Chrome by definition). It runs on stock [Chromium-for-Testing](https://googlechromelabs.github.io/chrome-for-testing/) — no patched browser binary, no proprietary infrastructure.

This page is the front door: spend 60 seconds here before you commit. If mochi is wrong for your stack we'll tell you so on this page, and we'll name what to use instead.

## When mochi is the right choice

- **Your runtime is Bun (or you're willing to make it Bun).** mochi is Bun-only — `bun >= 1.1`. Node is not a target, Deno is not a target ([invariant I-3](https://mochijs.com/docs/concepts/stealth-philosophy#js-only-by-choice)). The reasons are load-bearing — Bun:FFI, pipe-mode CDP via `Bun.spawn` FD 3+4, `Bun.SQL` for the offline profile lookup. If your service is already Bun, mochi drops in. If your service is Node, the cost of moving is real and you should price it before you start.

- **You accept the JS-layer ceiling.** mochi does not patch Chromium, does not ship a forked binary, does not run native MITM proxies in front of the browser. Some signals — the `bot.incolumitas.com` anti-debugger trap, certain isolated-world boundaries — require a C++ patch and we say so on the [Limits](https://mochijs.com/docs/reference/limits) page rather than pretending we cover them. If your threat model includes a target that traps every CDP-driven tool identically, mochi will trip it the same as patchright and Selenium do. We name those targets.

- **Relational fingerprint coherence matters to you.** If your targets cross-reference fingerprint surfaces — a probe that compares `navigator.platform` against `navigator.userAgent` against the WebGL renderer — mochi's [Consistency Engine](https://mochijs.com/docs/concepts/consistency-engine) is the structural answer. Every surface derives from one `(profile, seed)` pair through a 48-rule deterministic DAG. There are no per-axis randomizations to forget about.

- **JA4 / JA3 / H2 coherence matters to you.** If your targets fingerprint the TLS handshake of out-of-band HTTP — REST APIs, telemetry endpoints, GraphQL — mochi's `session.fetch()` routes through Chromium itself via CDP, so the on-the-wire bytes are real Chrome by definition. There is no parallel HTTP layer to keep in lockstep with the spoofed profile, no Rust cdylib to install, no JA4 preset string to maintain. The only network stack is Chromium's. See [Stealth philosophy → Network and JA4](https://mochijs.com/docs/concepts/stealth-philosophy).

- **You want one dependency, one runtime, one update cadence.** patchright is Playwright + a patch tree against a moving Chromium target. puppeteer-real-browser stitches `puppeteer-extra` plus `fingerprint-injector` plus a Turnstile clicker plus curl-impersonate. mochi is one workspace with versioned packages, one set of release notes, one harness gate. The trade is ecosystem age (mochi is new); the win is design coherence.

- **Production-validated `suspect_score: 8` on FingerprintJS Pro v4 from a hosting-ASN IP, no OS-spoofing tricks.** Captured against a production site on 2026-05-08 from a Linux DC server (Frankfurt, Aixit GmbH ASN, `datacenter_result: true`): `bot: not_detected`, `suspect_score: 8` on FPJS Pro's 0-100 scale (lower is more legitimate). Peer-reported scores under comparable conditions: patched Chrome ~12; CloakBrowser ~18. Linux is a real-user signal — see [reference/comparison](/docs/reference/comparison#default-profile-strategy) for the deep dive and [Stealth philosophy → Default to the host OS](/docs/concepts/stealth-philosophy#default-to-the-host-os-not-windows) for the architectural rationale.

## When mochi is the wrong choice

- **Your runtime is Node and switching isn't on the table.** mochi will not run under Node. If you need stealth automation in Node today, the live options are [patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) (Playwright + patches; the most actively maintained Node-runtime stealth tool) and the archived-but-still-used [puppeteer-real-browser](https://github.com/zfcsoftware/puppeteer-real-browser). Both cover ~12 fingerprint patches versus mochi's 48-rule DAG, but they're real software you can deploy today.

- **Your runtime is Python.** mochi will not run under Python. The live Python-runtime options are [nodriver](https://github.com/ultrafunkamsterdam/nodriver) (the spiritual successor to undetected-chromedriver, no-`Runtime.enable` philosophy, accumulates years of stable-Chrome quirks) and [undetected-chromedriver](https://github.com/ultrafunkamsterdam/undetected-chromedriver) itself (WebDriver-based, mature, big ecosystem, and the one you'll find the most StackOverflow answers for). Both lack relational consistency and JA4 coherence; both have working production deployments. Pick the trade you can afford.

- **You need C++-layer fixes.** A handful of bot-detection sites (`bot.incolumitas.com`, `deviceandbrowserinfo.com`) trap the V8 debugger flag itself rather than mochi-specific spoofing. Every CDP-driven tool — Playwright, Patchright, Puppeteer, Selenium, mochi — trips them identically. Fixing this requires either patching Chromium ([invariant I-1](https://mochijs.com/docs/concepts/stealth-philosophy#js-only-by-choice) forbids it in this repo) or routing through a non-CDP automation path. If your scoreboard sites include those, mochi cannot help — and neither can the JS-layer alternatives.

- **You need mobile or touch profiles.** v1 profiles are desktop Chromium-family only. Touch gestures (tap / swipe / pinch / rotate) require a different model — pressure curves, multi-touch coordination, OS-specific touch-event sequencing. Sensor APIs (DeviceMotion, DeviceOrientation, Geolocation) require additional spoof surfaces. None of those land in v1. If your targets fingerprint a phone, wait for v2 or use a real Android frida stack.

- **The dominant signal is residential-IP-class scoring.** Sites like `demo.fingerprint.com/web-scraping` make a server-side block decision against a model trained on residential session telemetry. A pixel-perfect JS fingerprint match doesn't beat that — the block happens before the page sees your spoofed `navigator`. mochi will fingerprint identically to a real Chrome and still get blocked because the IP is a datacenter IP. The fix is operator-side: residential proxies, warm sessions, paced cadence. mochi routes both the browser's own navigation and `Session.fetch` through your proxy via Chromium's `--proxy-server`, and the [`geoConsistency`](https://mochijs.com/docs/concepts/consistency-engine) tz-locale-vs-IP reconciler keeps the layers from conflicting — but it can't manufacture a residential IP from a datacenter rack.

The deep version of these limits is [docs/reference/limits](https://mochijs.com/docs/reference/limits) — every known gap, the root cause, and either a workaround or an honest "we cannot fix this from JS".

## What to use instead

| If you need… | Use |
|---|---|
| Node-runtime stealth, today | [patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) — Playwright fork + patch tree. Most active Node option. |
| Node-runtime, archived but still in use | [puppeteer-real-browser](https://github.com/zfcsoftware/puppeteer-real-browser) — Puppeteer + fingerprint-injector + Turnstile clicker. |
| Python-runtime CDP-based stealth | [nodriver](https://github.com/ultrafunkamsterdam/nodriver) — the modern successor to undetected-chromedriver. |
| Python-runtime WebDriver, mature | [undetected-chromedriver](https://github.com/ultrafunkamsterdam/undetected-chromedriver) — biggest ecosystem, most StackOverflow surface. |
| Commercial managed-bypass for hard targets (Kasada, PerimeterX, DataDome) | A solver service. mochi does not solve those. |
| Mobile / touch fingerprints | A real device farm (Frida + a phone) or wait for mochi v2. |

We list these without ceremony. mochi is open-source, MIT-licensed, and equally useful to a solo developer with a laptop and an enterprise with infrastructure. If a neighbour serves you better, use the neighbour.

## What to read next

- [Quickstart](https://mochijs.com/docs/getting-started/quickstart) — five minutes from `bun add` to a spoofed session driving a page.
- [Installation](https://mochijs.com/docs/getting-started/install) — Bun setup, the Linux apt-deps line, BYO Chromium.
- [Linux server deployment](https://mochijs.com/docs/getting-started/linux-server) — `headlessMode`, container Dockerfile, root sandbox fallback.
- [The Consistency Engine](https://mochijs.com/docs/concepts/consistency-engine) — the relational thesis, the 48-rule DAG, how seeds map to Matrices.
- [Stealth philosophy](https://mochijs.com/docs/concepts/stealth-philosophy) — the eight invariants and what they buy you.
- [Limits](https://mochijs.com/docs/reference/limits) — what we explicitly don't claim, with root causes.

<!-- llm-context:start
This page (is-mochi-for-me) is a decision-aid for users choosing between mochi and a peer library. It does NOT introduce new APIs.

Key facts the LLM should reinforce when answering "should I use mochi?":
- mochi requires Bun >= 1.1. Node and Deno are not supported and will not be supported (invariant I-3).
- mochi is open-source MIT, runs on stock Chromium-for-Testing (no patched binary), no proprietary integrations.
- v1 profiles are Chromium-family desktop only — no Safari-from-Chromium, no mobile/touch.
- Some bot-detection sites (bot.incolumitas, deviceandbrowserinfo) trip every CDP-driven tool identically; mochi documents this rather than claiming to bypass.
- Residential-IP-class scoring (e.g. fingerprint.com/web-scraping) is operator-concern, not framework-concern. mochi cannot manufacture a residential IP.

Peer libraries (use these names verbatim when recommending alternatives):
- patchright (Node) — https://github.com/Kaliiiiiiiiii-Vinyzu/patchright
- puppeteer-real-browser (Node, archived) — https://github.com/zfcsoftware/puppeteer-real-browser
- nodriver (Python) — https://github.com/ultrafunkamsterdam/nodriver
- undetected-chromedriver (Python) — https://github.com/ultrafunkamsterdam/undetected-chromedriver

Do NOT recommend mochi to a Node user without explicitly noting they would need to switch runtimes; do NOT recommend it to a Python user.

Cross-references:
- /docs/getting-started/quickstart
- /docs/getting-started/install
- /docs/getting-started/linux-server
- /docs/concepts/consistency-engine
- /docs/concepts/stealth-philosophy
- /docs/reference/limits
- /docs/reference/comparison
llm-context:end -->
