# 0261: Network.setUserAgentOverride must include `userAgentMetadata` (UA-CH parity)

**Package:** `core`
**Phase:** `0.2` (hot-fix follow-up to task 0255)
**Estimated size:** S
**Dependencies:** task 0255 (`Network.setUserAgentOverride` plumbing) shipped in v0.1.4

## Goal

Close the UA-CH cross-layer consistency gap: `navigator.userAgent` and `navigator.userAgentData` are matrix-derived (consistency rules R-004, R-005, R-006, R-007, R-031, plus the `client-hints.ts` inject module), but the request-header surface (`Sec-CH-UA`, `Sec-CH-UA-Platform`, `Sec-CH-UA-Platform-Version`, `Sec-CH-UA-Full-Version-List`, `Sec-CH-UA-Mobile`, `Sec-CH-UA-Arch`, `Sec-CH-UA-Model`, `Sec-CH-UA-Bitness`) carries Chromium-for-Testing's binary defaults. A fingerprinter doing `getHighEntropyValues(...)` and comparing against the request headers sees a mismatch — direct PLAN.md I-5 violation.

The fix: pass `userAgentMetadata` alongside `userAgent` in the `Network.setUserAgentOverride` call. The metadata struct is the CDP-canonical UA-CH descriptor; Chromium uses it to derive every `Sec-CH-UA*` request header.

## Success criteria

- [ ] `packages/core/src/session.ts` — the `Network.setUserAgentOverride` send (currently per-page, sent right after `Target.attachToTarget` + `Page.enable`) extends to:
  ```ts
  await this.router.send("Network.setUserAgentOverride", {
    userAgent: this.profile.userAgent,
    userAgentMetadata: {
      brands: matrix.uaCh["sec-ch-ua"],            // [{brand, version}]
      fullVersionList: matrix.uaCh["ua-full-version-list"],  // [{brand, version}]
      fullVersion: matrix.uaCh["ua-full-version"], // string — derived from R-031 primary brand
      platform: matrix.uaCh["sec-ch-ua-platform"],
      platformVersion: matrix.uaCh["sec-ch-ua-platform-version"],
      architecture: matrix.os.arch === "arm64" ? "arm" : "x86",  // CDP enum
      model: matrix.uaCh["sec-ch-ua-model"] ?? "",  // empty for desktop, populated for Android
      mobile: matrix.os.name === "Android" || matrix.os.name === "iOS",
      bitness: matrix.os.arch.includes("64") ? "64" : "32",
      wow64: false,
    },
  }, { sessionId: attached.sessionId });
  ```
  Verify the field names against the CDP spec — Chromium's `Network.setUserAgentOverride` parameter shape is documented at the protocol-spec level. Field names use `camelCase`; values for `architecture` and `bitness` are CDP enums (`"x86" | "arm"`, `"32" | "64"`).
- [ ] Verify `matrix.uaCh` already exposes the fields above. If `ua-full-version` (single string), `sec-ch-ua-model`, `sec-ch-ua-arch`, `sec-ch-ua-bitness` aren't yet in the matrix, add the consistency rules (likely R-04X / R-05X) deriving them from existing inputs:
  - `architecture` from `os.arch`
  - `bitness` from `os.arch`
  - `mobile` from `os.name`
  - `model` from `os.name + browser.name` (Android Chrome Mobile maps to e.g. "K", "Pixel 7"; desktop is always empty string per spec)
  - `fullVersion` from primary brand in `ua-full-version-list`
- [ ] Update the `client-hints.ts` inject module to read the same matrix fields as the network layer — single source of truth means the JS-side spoof and the request-header spoof can never drift.
- [ ] Cross-package contract test in `tests/contract/uach-network-parity.contract.test.ts`: drive `Session` via mocked CDP, capture `Network.setUserAgentOverride` params, assert all `userAgentMetadata` fields match the matrix-derived values from `client-hints.ts`'s output.
- [ ] **Live conformance test** in `packages/harness/src/conformance/stealth/__tests__/uach-parity.test.ts`: with a real Chromium session, navigate to a Bun.serve fixture that captures `Sec-CH-UA*` headers AND runs `await navigator.userAgentData.getHighEntropyValues(["platform","platformVersion","model","mobile","architecture","bitness","fullVersionList"])` from page JS. Assert the request-header values match the JS-API values byte-for-byte. Gate `MOCHI_E2E=1`.
- [ ] Skipped under `bypassInject: true` — capture flows must record the bare CfT fingerprint INCLUDING the bare UA-CH headers. The current 0255 code already gates the metadata-less call on `!bypassInject`; just keep that branch and extend the param.
- [ ] Changeset: patch on `@mochi.js/core`.

## Out of scope

- `Sec-CH-UA-WoW64` — Windows-on-ARM-on-Windows nesting; we set `wow64: false` always (matrix doesn't model this).
- `Sec-CH-UA-Form-Factors` — newer high-entropy hint; not currently in the matrix. Document as a v0.3 follow-up if no audit surface depends on it.
- `Accept-Language` header — already covered by the `--lang` flag (task 0251).
- Reverting / disabling the JS-side spoof — keep both. The two surfaces being independent at the CDP level (one drives the JS API, one drives the headers) is intentional Chromium design; they happen to read the same data.

## Implementation notes

- See PLAN.md §8.2 (forbidden CDP — `Network.enable` is forbidden, but `Network.setUserAgentOverride` is a per-target setter that does NOT require enable; verified in the existing 0255 code).
- See `packages/consistency/src/rules/userAgent.ts` for the existing UA-CH rules. The new derivations (architecture / bitness / mobile / model / fullVersion) probably get their own R-numbers in the same file.
- See `packages/inject/src/modules/client-hints.ts:170` for how `getHighEntropyValues` is built today — the values you read there are the values you must pass to `Network.setUserAgentOverride`'s metadata.
- CDP enum casing: per Chromium source, `architecture` accepts `"x86"`, `"arm"`, `""`. `bitness` accepts `"64"`, `"32"`, `""`. `model` is free-form. Don't pass numeric values for bitness — must be string.
- macOS: per Chromium, `architecture` is `"arm"` for Apple Silicon, `"x86"` for Intel; `bitness` is always `"64"` for modern macOS.

## Validation

```sh
bun run typecheck && bun run lint && bun run test && bun run test:contract
# Live: MOCHI_E2E=1 MOCHI_ONLINE=1 bun test packages/harness/src/conformance/stealth/__tests__/uach-parity.test.ts
```

## Submission

```sh
bun work create 0261 core
cd worktrees/0261
# implement
bun work submit 0261 --draft
```
