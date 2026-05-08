/**
 * Live conformance test for `Page.screenshot` (task 0265).
 *
 * Gated by `MOCHI_E2E=1` so the default `bun test` run stays fast and offline.
 * Spawns a real Chromium-for-Testing instance, navigates to a tiny data URL,
 * captures the viewport as PNG, and asserts the bytes start with the PNG
 * magic signature.
 *
 * Budget: < 10 seconds.
 */

import { describe, expect, it } from "bun:test";
import { mochi } from "../index";

const E2E_ENABLED = process.env.MOCHI_E2E === "1";
const TEST_TIMEOUT_MS = 10_000;

const describeOrSkip = E2E_ENABLED ? describe : describe.skip;

describeOrSkip("@mochi.js/core Page.screenshot E2E (MOCHI_E2E=1)", () => {
  it(
    "captures a PNG screenshot — Uint8Array starts with PNG magic bytes",
    async () => {
      const session = await mochi.launch({
        profile: "test",
        seed: "screenshot-e2e",
        headless: true,
      });
      try {
        const page = await session.newPage();
        await page.goto("data:text/html,<title>shot</title><h1 style='color:red'>hello</h1>");
        const png = await page.screenshot();
        expect(png).toBeInstanceOf(Uint8Array);
        // PNG signature: 89 50 4E 47 0D 0A 1A 0A
        expect(png[0]).toBe(0x89);
        expect(png[1]).toBe(0x50);
        expect(png[2]).toBe(0x4e);
        expect(png[3]).toBe(0x47);
        expect(png[4]).toBe(0x0d);
        expect(png[5]).toBe(0x0a);
        expect(png[6]).toBe(0x1a);
        expect(png[7]).toBe(0x0a);
        // Sanity: a non-trivial image should be more than just the header.
        expect(png.length).toBeGreaterThan(100);
      } finally {
        await session.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "captures a JPEG screenshot when format: 'jpeg'",
    async () => {
      const session = await mochi.launch({
        profile: "test",
        seed: "screenshot-e2e-jpeg",
        headless: true,
      });
      try {
        const page = await session.newPage();
        await page.goto("data:text/html,<h1>jpeg</h1>");
        const jpeg = await page.screenshot({ format: "jpeg", quality: 70 });
        expect(jpeg).toBeInstanceOf(Uint8Array);
        // JPEG SOI marker: FF D8 FF
        expect(jpeg[0]).toBe(0xff);
        expect(jpeg[1]).toBe(0xd8);
        expect(jpeg[2]).toBe(0xff);
      } finally {
        await session.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "fullPage: true captures beyond the visible viewport",
    async () => {
      const session = await mochi.launch({
        profile: "test",
        seed: "screenshot-e2e-fullpage",
        headless: true,
      });
      try {
        const page = await session.newPage();
        // A page taller than the default viewport so fullPage actually matters.
        await page.goto(
          "data:text/html,<style>body{margin:0}div{height:3000px;background:linear-gradient(red,blue)}</style><div></div>",
        );
        const viewportShot = await page.screenshot();
        const fullShot = await page.screenshot({ fullPage: true });
        expect(viewportShot[0]).toBe(0x89);
        expect(fullShot[0]).toBe(0x89);
        // Full-page bytes should be larger than viewport bytes for a 3000px page.
        expect(fullShot.length).toBeGreaterThan(viewportShot.length);
      } finally {
        await session.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "encoding: 'base64' returns a string instead of bytes",
    async () => {
      const session = await mochi.launch({
        profile: "test",
        seed: "screenshot-e2e-b64",
        headless: true,
      });
      try {
        const page = await session.newPage();
        await page.goto("data:text/html,<h1>b64</h1>");
        const b64 = await page.screenshot({ encoding: "base64" });
        expect(typeof b64).toBe("string");
        // Decoded base64 must start with the PNG magic.
        const decoded = Buffer.from(b64, "base64");
        expect(decoded[0]).toBe(0x89);
        expect(decoded[1]).toBe(0x50);
      } finally {
        await session.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
