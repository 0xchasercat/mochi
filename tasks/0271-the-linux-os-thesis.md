# 0271 — The Linux-OS-default thesis (strategic positioning + evidence)

**Status:** draft, for ingestion by writers in flight (writer-1, writer-4)
  and any subsequent docs/marketing work.
**Owner:** orchestrator. Subagents quote from this file freely.
**Touches:** `README.md`, `docs/content/docs/concepts/stealth-philosophy.md`,
  `docs/content/docs/getting-started/is-mochi-for-me.md`,
  `docs/content/docs/reference/comparison.md`,
  `docs/content/docs/reference/faq.md`,
  `docs/content/docs/getting-started/linux-server.md` (already exists,
  cross-link target).
**Out of scope:** any code change. Pair this with task 0272 for the
  engineering follow-up (auto-pick a host-OS-matching profile when
  `profile` is omitted from `mochi.launch()`).

---

## The thesis (in the user's voice — preserve verbatim where possible)

> Everyone told you to spoof Windows. They were wrong. Here's the proof.
>
> Linux has like 4% desktop market share, but it's massively
> overrepresented in high-value user segments — developers, engineers,
> researchers, power users. The people WAF vendors' customers actually
> want to serve.
>
> A CTO who flags all Linux as bot traffic is:
> - Blocking their own engineering team
> - Blocking developers evaluating their product
> - Blocking a disproportionately high-LTV user segment
> - Creating false positive rates that destroy trust in the detection system
>
> Nobody would ship that. It's business suicide.
>
> So Linux was never flagged. The WAFs trained their models on real
> traffic and Linux users are real users. The signal was always
> `HeadlessChrome`, not Linux.
>
> The entire antidetect browser industry built Windows spoofing on a
> false premise. They assumed Linux was penalized because browserscan
> said so. Browserscan is a surface-level string checker, not a WAF
> ML model.

## Why mochi defaults to host-OS matching

`mochi.launch({ profile: "linux-chrome-stable", … })` on a Linux server
is **the recommended path**, not a workaround. Today the user types the
profile id explicitly; task 0272 lifts that into a default — when
`profile` is omitted, mochi auto-picks the host-OS-matching profile
from `KNOWN_PROFILE_IDS`.

Architectural reasons:
1. **The Mac UA next-to Linux WebGL problem is asymmetric.** A Mac
   profile spoofed onto a Linux host has to lie about every WebGL
   string, every audio sample-rate, every font list, every JA4
   ciphersuite ordering. mochi's relational-consistency rules can do
   this — but it's a wider attack surface for any one of those rules
   to drift. Matching host-OS removes the entire class of "OS-axis
   inconsistency" detections.
2. **Latency budget.** The headful → headless rendering parity check
   (Probe Manifest harness) runs faster when the host's native renderer
   matches the spoofed profile's renderer. Cross-OS spoofs have to
   patch more surfaces.
3. **The thesis above.** Linux is a real-user signal, not a bot signal.

## Evidence — `aone.gg` FingerprintJS Pro v4 result, 2026-05-08

Captured live: mochi v0.1.4 on a Linux DC server (Frankfurt, Aixit GmbH
ASN 29551, ASN type `hosting`, `datacenter_result: true`), navigating to
`https://aone.gg/`.

Verbatim FPJS Pro v4 response (relevant fields):

```json
{
  "bot": "not_detected",
  "suspect_score": 8,
  "tampering": true,
  "tampering_confidence": "medium",
  "tampering_ml_score": 0.9853,
  "tampering_details": {
    "anomaly_score": 0,
    "anti_detect_browser": true
  },
  "vpn": false,
  "vpn_confidence": "high",
  "vpn_origin_timezone": "UTC",
  "vpn_methods": {
    "timezone_mismatch": false,
    "public_vpn": false,
    "auxiliary_mobile": false,
    "os_mismatch": false,
    "relay": false
  },
  "incognito": false,
  "ip_info": {
    "v4": {
      "asn": "29551",
      "asn_name": "Aixit GmbH",
      "asn_type": "hosting",
      "datacenter_result": true,
      "datacenter_name": "Layer7 Networks GmbH",
      "geolocation": {
        "country_code": "DE",
        "city_name": "Frankfurt am Main",
        "timezone": "Europe/Berlin"
      }
    }
  },
  "user_agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.110 Safari/537.36",
  "browser_details": {
    "browser_name": "Chrome",
    "browser_major_version": "131",
    "os": "Linux"
  }
}
```

(See the full JSON in the live capture comment on `tasks/0271`.)

### What this tells us

- **`bot: not_detected` from a hosting ASN** is the headline. Datacenter
  IPs are normally a strong bot signal; FPJS Pro's classifier did not
  fire.
- **`suspect_score: 8`** — on FPJS Pro v4's 0-100 scale (lower = more
  legitimate), this is excellent. User-reported peer scores under the
  same conditions:
  - Patched Chrome (own build): 14–18
  - CloakBrowser: 20+
  - mochi v0.1.4: **8**
- **`tampering: true`, `tampering_ml_score: 0.9853`, `anti_detect_browser: true`,
  `tampering_confidence: "medium"`** — FPJS's tampering ML *can* tell
  something is off. It does not promote that to a bot classification
  because the rest of the fingerprint is internally coherent. This is
  exactly what the relational-consistency thesis predicts: cross-axis
  agreement is the dominant signal; ML drift on a single axis is not
  enough to trip the gate alone.
- **`vpn: false` + `vpn_origin_timezone: "UTC"`** — proof that the
  privacy-fallback architecture works in production. The session ran
  with matrix tz `UTC` against a Frankfurt IP. A naive spoof would
  produce `os_mismatch: true` or `timezone_mismatch: true`; mochi's
  privacy-fallback presents as a privacy-conscious user (UTC) rather
  than a tampered Asia/Bangkok→Europe/Berlin mismatch. FPJS recorded
  `vpn_origin_timezone: "UTC"` (the privacy signal we wanted) and kept
  `vpn: false` (the classification we wanted).
- **No `os_mismatch`, no `public_vpn`, no `relay`, no `incognito`** —
  every secondary detection vector is cold.

### What this doesn't tell us

This is one site (aone.gg, FPJS Pro v4 — a high-quality but not
best-in-class adversary). Cloudflare bot-management, Akamai Bot Manager,
DataDome, Kasada, PerimeterX in their max-aggressiveness modes have not
been tested in this run. The **`reference/limits.md`** page is the
honest-cut document and stays the canonical "what we don't claim".

## How writers should use this

### `README.md` (writer-1)

After the 30-second pitch, before the LLM-context block, insert a short
**"Proof"** subsection:

- One sentence: "mochi v0.1.4 on a Linux datacenter IP scored
  `suspect_score: 8` against FingerprintJS Pro v4 — with `bot:
  not_detected` and `vpn: false`. (Patched Chrome reports 14-18 in
  comparable conditions; CloakBrowser 20+.)"
- One paragraph quoting the thesis: "Everyone told you to spoof
  Windows…" (use the four bullets in the user's voice; trim if needed).
- One sentence directing readers to `reference/comparison.md` for the
  full comparison and `concepts/stealth-philosophy.md` for the
  architectural rationale.

### `concepts/stealth-philosophy.md` (writer-1)

Add a section titled **"Default to the host OS, not Windows"** with:

- The thesis (verbatim quote, attributed to "the design team" or
  similar — keep the voice).
- The architectural rationale (host-OS asymmetry, narrower attack
  surface, privacy-fallback as designed).
- A one-line cross-link to `getting-started/linux-server.md` for
  operational guidance and to `tasks/0271` (this file) for the
  evidence.

### `reference/comparison.md` (writer-4)

In the per-axis deep-dive, add a new axis section: **"Default profile
strategy."** Compare:

- mochi: defaults to host-OS-matching profile (post-task-0272). Linux
  server → linux profile. Architectural rationale + the thesis.
- patchright / nodriver / undetected-chromedriver / puppeteer-real-browser:
  default to "spoof Windows because browserscan says Linux is bad". Cite
  the thesis as the rebuttal.

End the section with the aone.gg evidence as a concrete data point.

### `reference/faq.md` (writer-4)

Add the question: **"Should I spoof Windows even when running on a
Linux server?"**

Answer: short version — no. Long version — the thesis above + the
evidence + a pointer to `concepts/stealth-philosophy.md`.

### `getting-started/is-mochi-for-me.md` (writer-1)

In the "What mochi does differently" or equivalent section, add the
proof bullet: "Production-validated `suspect_score: 8` on FingerprintJS
Pro v4 from a hosting-ASN IP, without OS-spoofing tricks." Cross-link to
`tasks/0271`.

## Validation

- The evidence in this file matches the live JSON the orchestrator
  captured on 2026-05-08.
- Writers do not embellish the score data — the numbers in this file
  are the numbers.
- Do not claim "mochi defeats every fingerprinter" anywhere. Concrete
  scores against named adversaries only.

## Open follow-ups

- **Task 0272 — Auto-pick host-OS-matching profile when `profile` is
  omitted.** Engineering brief lives separately. This file documents the
  WHY; 0272 documents the WHAT.
- **Periodic re-validation** of the aone.gg score (and other named
  WAFs) on a CI cadence. v0.3 task, not yet briefed.
