---
title: The inject pipeline
description: How the JIT-friendly stealth payload reaches every page before any other script runs.
order: 3
category: concepts
lastUpdated: 2026-05-09
---

## TODO

The inject pipeline page will explain `Page.addScriptToEvaluateOnNewDocument({ runImmediately: true })`, the IIFE bundle shape (~50 KB target, JIT-friendly Proxy traps), and how `@mochi.js/inject` consumes the Matrix from `@mochi.js/consistency` to produce a payload. See PLAN.md §5.3 / §8.4 in the meantime.
