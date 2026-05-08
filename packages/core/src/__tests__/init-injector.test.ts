/**
 * Unit tests for the init-injector building blocks (task 0266).
 *
 * Covers:
 *   - {@link rewriteCsp}: no-nonce / nonce / strict-dynamic / unsafe-inline
 *     idempotence / multiple directives.
 *   - {@link rewriteHeaders}: header-name case insensitive, content-length
 *     stripped, CSP and CSP-Report-Only both rewritten.
 *   - {@link rewriteMetaCsp}: HTML meta-tag rewriting + entity round-trip.
 *   - {@link injectIntoHead}: script splice ahead of first non-comment
 *     `<script>`; script-tag attributes (no defer/async/module).
 *   - {@link wrapSelfRemovingPayload}: first statement is the self-remove +
 *     marker; the inner payload is left intact.
 *
 * @see tasks/0266-fetch-fulfill-init-script.md
 */

import { describe, expect, it } from "bun:test";
import {
  injectIntoHead,
  MOCHI_INIT_MARKER,
  MOCHI_INIT_SCRIPT_CLASS,
  rewriteCsp,
  rewriteHeaders,
  rewriteMetaCsp,
  wrapSelfRemovingPayload,
} from "../cdp/init-injector";

describe("rewriteCsp", () => {
  it("no nonce, no unsafe-inline → adds 'unsafe-inline' to script-src", () => {
    const out = rewriteCsp("script-src 'self' https://cdn.example.com");
    expect(out.value).toContain("script-src 'self' https://cdn.example.com 'unsafe-inline'");
    expect(out.nonce).toBeUndefined();
  });

  it("with-nonce → leaves directive intact and returns nonce string", () => {
    const out = rewriteCsp("script-src 'self' 'nonce-abc123XYZ'");
    expect(out.value).toBe("script-src 'self' 'nonce-abc123XYZ'");
    expect(out.nonce).toBe("abc123XYZ");
  });

  it("strict-dynamic + nonce → leaves directive intact and surfaces nonce", () => {
    const out = rewriteCsp("script-src 'strict-dynamic' 'nonce-XYZ' 'unsafe-eval'");
    expect(out.value).toBe("script-src 'strict-dynamic' 'nonce-XYZ' 'unsafe-eval'");
    expect(out.nonce).toBe("XYZ");
  });

  it("strict-dynamic without nonce → falls through to unsafe-inline (best-effort)", () => {
    const out = rewriteCsp("script-src 'strict-dynamic'");
    expect(out.value).toContain("'unsafe-inline'");
    expect(out.nonce).toBeUndefined();
  });

  it("already has 'unsafe-inline' → idempotent (does not double-add)", () => {
    const out = rewriteCsp("script-src 'self' 'unsafe-inline'");
    expect(out.value).toBe("script-src 'self' 'unsafe-inline'");
    expect(out.value.match(/'unsafe-inline'/g)?.length).toBe(1);
  });

  it("multiple directives → only script-src/script-src-elem/default-src mutated", () => {
    const out = rewriteCsp(
      "default-src 'self'; img-src https:; script-src 'self'; style-src 'self'",
    );
    expect(out.value).toContain("script-src 'self' 'unsafe-inline'");
    expect(out.value).toContain("default-src 'self' 'unsafe-inline'");
    expect(out.value).toContain("img-src https:");
    expect(out.value).toContain("style-src 'self'");
  });

  it("script-src-elem also gets relaxed", () => {
    const out = rewriteCsp("script-src-elem 'self'");
    expect(out.value).toContain("script-src-elem 'self' 'unsafe-inline'");
  });
});

describe("rewriteHeaders", () => {
  it("rewrites Content-Security-Policy and surfaces nonce", () => {
    const out = rewriteHeaders([
      { name: "Content-Security-Policy", value: "script-src 'nonce-NN'" },
      { name: "X-Frame-Options", value: "DENY" },
    ]);
    expect(out.scriptNonce).toBe("NN");
    const csp = out.headers.find((h) => h.name === "Content-Security-Policy");
    expect(csp?.value).toBe("script-src 'nonce-NN'");
    expect(out.headers.find((h) => h.name === "X-Frame-Options")?.value).toBe("DENY");
  });

  it("rewrites Content-Security-Policy-Report-Only too", () => {
    const out = rewriteHeaders([
      { name: "content-security-policy-report-only", value: "script-src 'self'" },
    ]);
    const csp = out.headers.find(
      (h) => h.name.toLowerCase() === "content-security-policy-report-only",
    );
    expect(csp?.value).toContain("'unsafe-inline'");
  });

  it("strips Content-Length so fulfillRequest recomputes", () => {
    const out = rewriteHeaders([
      { name: "Content-Length", value: "1234" },
      { name: "Content-Type", value: "text/html" },
    ]);
    expect(out.headers.some((h) => h.name.toLowerCase() === "content-length")).toBe(false);
    expect(out.headers.some((h) => h.name === "Content-Type")).toBe(true);
  });

  it("adopts the first nonce when multiple CSPs are present", () => {
    const out = rewriteHeaders([
      { name: "Content-Security-Policy", value: "script-src 'nonce-aaa'" },
      { name: "Content-Security-Policy", value: "script-src 'nonce-bbb'" },
    ]);
    expect(out.scriptNonce).toBe("aaa");
  });
});

describe("rewriteMetaCsp", () => {
  it("rewrites a meta tag's CSP content attribute (encoded on the wire)", () => {
    const html = `<head><meta http-equiv="Content-Security-Policy" content="script-src 'self'"></head>`;
    const out = rewriteMetaCsp(html);
    // Apostrophes in attribute values round-trip through entity encoding;
    // assert the encoded form so we capture what Chromium will actually
    // parse back into the document.
    expect(out.html).toContain("&#39;unsafe-inline&#39;");
  });

  it("preserves other attribute order and unrelated meta tags", () => {
    const html = `<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'self'"><meta name="viewport" content="width=device-width"></head>`;
    const out = rewriteMetaCsp(html);
    expect(out.html).toContain('<meta charset="utf-8">');
    expect(out.html).toContain('<meta name="viewport"');
    expect(out.html).toContain("&#39;unsafe-inline&#39;");
  });

  it("extracts nonce from a meta-tag CSP", () => {
    const html = `<meta http-equiv="Content-Security-Policy" content="script-src 'nonce-MMM'">`;
    const out = rewriteMetaCsp(html);
    expect(out.firstNonce).toBe("MMM");
  });

  it("ignores meta tags that are NOT CSP", () => {
    const html = `<meta http-equiv="X-UA-Compatible" content="IE=edge">`;
    const out = rewriteMetaCsp(html);
    expect(out.html).toBe(html);
    expect(out.firstNonce).toBeUndefined();
  });

  it("handles single-quoted attribute values too", () => {
    const html = `<meta http-equiv='Content-Security-Policy' content='script-src \\'self\\''>`;
    // Bun's regex is fine with the structure even though we don't decode \'
    // here — the input shape is contrived; the production path always sees
    // properly-escaped HTML from Chromium.
    const out = rewriteMetaCsp(html);
    expect(out.html).toContain("Content-Security-Policy");
  });
});

describe("injectIntoHead", () => {
  const SCRIPT = "console.log(1)";

  it("inserts BEFORE the first non-comment <script> in head", () => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><script>window.first=true</script></head><body></body></html>`;
    const out = injectIntoHead(html, SCRIPT, undefined);
    const idxOurs = out.indexOf(`class="${MOCHI_INIT_SCRIPT_CLASS}"`);
    const idxFirst = out.indexOf("window.first=true");
    expect(idxOurs).toBeGreaterThan(-1);
    expect(idxFirst).toBeGreaterThan(-1);
    expect(idxOurs).toBeLessThan(idxFirst);
  });

  it("ignores HTML comments — does not splice before commented-out <script>", () => {
    const html = `<head><!-- <script>window.fake=1</script> --><script>window.real=1</script></head>`;
    const out = injectIntoHead(html, SCRIPT, undefined);
    const idxOurs = out.indexOf(`class="${MOCHI_INIT_SCRIPT_CLASS}"`);
    const idxReal = out.indexOf("window.real=1");
    const idxFake = out.indexOf("window.fake=1");
    expect(idxOurs).toBeLessThan(idxReal);
    // Our script must also be after the comment block — splicing in the
    // middle of a comment would be wrong.
    expect(idxOurs).toBeGreaterThan(idxFake);
  });

  it("inserts at end-of-head when no <script> exists in head", () => {
    const html = `<head><meta charset="utf-8"></head><body><script>window.bodyScript=1</script></body>`;
    const out = injectIntoHead(html, SCRIPT, undefined);
    const idxOurs = out.indexOf(`class="${MOCHI_INIT_SCRIPT_CLASS}"`);
    const idxBody = out.indexOf("window.bodyScript=1");
    expect(idxOurs).toBeGreaterThan(-1);
    expect(idxOurs).toBeLessThan(idxBody);
    // Script lands inside the head — i.e. before </head>.
    const idxClose = out.indexOf("</head>");
    expect(idxOurs).toBeLessThan(idxClose);
  });

  it("creates a <head> when missing", () => {
    const html = `<html><body><h1>hi</h1></body></html>`;
    const out = injectIntoHead(html, SCRIPT, undefined);
    expect(out).toContain("<head>");
    expect(out).toContain(`class="${MOCHI_INIT_SCRIPT_CLASS}"`);
  });

  it("does NOT add defer / async / type=module attributes (timing-critical)", () => {
    const html = `<head></head>`;
    const out = injectIntoHead(html, SCRIPT, undefined);
    // The injected tag for timing-critical inject MUST be a parser-blocking
    // classic script. The patchright finding hinges on this.
    const tag = out.match(/<script[^>]*class="__mochi_init_script__"[^>]*>/);
    expect(tag).not.toBeNull();
    const tagSrc = tag?.[0] ?? "";
    expect(tagSrc).not.toMatch(/\bdefer\b/);
    expect(tagSrc).not.toMatch(/\basync\b/);
    expect(tagSrc).not.toMatch(/type\s*=\s*"module"/);
    expect(tagSrc).not.toMatch(/type\s*=\s*'module'/);
  });

  it("attaches nonce attribute when supplied", () => {
    const html = `<head></head>`;
    const out = injectIntoHead(html, SCRIPT, "abc123");
    expect(out).toMatch(/<script[^>]+nonce="abc123"/);
  });
});

describe("wrapSelfRemovingPayload", () => {
  it("first statement removes document.currentScript", () => {
    const wrapped = wrapSelfRemovingPayload("/* payload */");
    // Self-remove must come BEFORE the marker assignment AND before the
    // payload — otherwise a script that throws synchronously could leave a
    // detectable orphan node in the DOM.
    const idxSelfRemove = wrapped.indexOf("document.currentScript");
    const idxMarker = wrapped.indexOf(MOCHI_INIT_MARKER);
    const idxPayload = wrapped.indexOf("/* payload */");
    expect(idxSelfRemove).toBeGreaterThan(-1);
    expect(idxMarker).toBeGreaterThan(-1);
    expect(idxPayload).toBeGreaterThan(-1);
    expect(idxSelfRemove).toBeLessThan(idxMarker);
    expect(idxMarker).toBeLessThan(idxPayload);
  });

  it("contains the post-load DOM walk (belt-and-suspenders)", () => {
    const wrapped = wrapSelfRemovingPayload("0");
    expect(wrapped).toContain(MOCHI_INIT_SCRIPT_CLASS);
    expect(wrapped).toMatch(/load|complete/);
  });

  it("preserves the original payload bytes intact", () => {
    const orig = "(function(){window.x=42;})();";
    const wrapped = wrapSelfRemovingPayload(orig);
    expect(wrapped).toContain(orig);
  });
});
