/**
 * Unit tests for probe-page.ts — the fixture-locator helpers used by
 * `mochi capture` and (later) the harness.
 */

import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { findProbePage, locateProbePage, pathToFileUrl } from "../probe-page";

describe("findProbePage() / locateProbePage()", () => {
  it("locates tests/fixtures/probe-page.html walking up from cwd", () => {
    const found = findProbePage();
    expect(found).not.toBeNull();
    if (!found) return;
    expect(found.absolutePath.endsWith("tests/fixtures/probe-page.html")).toBe(true);
    expect(existsSync(found.absolutePath)).toBe(true);
    expect(found.fileUrl.startsWith("file://")).toBe(true);
  });

  it("locateProbePage throws with a useful message when no fixture is reachable", () => {
    expect(() => locateProbePage("/nonexistent/path/somewhere")).toThrow(/probe-page\.html/);
  });
});

describe("pathToFileUrl()", () => {
  it("encodes spaces and special characters", () => {
    expect(pathToFileUrl("/tmp/has space.html")).toBe("file:///tmp/has%20space.html");
  });
  it("preserves slashes and absolute leading slash", () => {
    const url = pathToFileUrl("/Users/foo/bar/probe-page.html");
    expect(url).toBe("file:///Users/foo/bar/probe-page.html");
  });
  it("normalizes Windows-style backslashes", () => {
    const url = pathToFileUrl("C:\\Users\\probe-page.html");
    expect(url.startsWith("file:///")).toBe(true);
    expect(url).toContain("Users");
    expect(url).toContain("probe-page.html");
  });
});
