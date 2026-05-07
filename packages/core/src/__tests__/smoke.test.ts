import { describe, expect, it } from "bun:test";
import { mochi, NotImplementedError, Session, VERSION } from "../index";

describe("@mochi.js/core (phase 0.1)", () => {
  it("exports a VERSION string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("exports a mochi namespace with launch", () => {
    expect(typeof mochi).toBe("object");
    expect(typeof mochi.launch).toBe("function");
    expect(mochi.version).toBe(VERSION);
  });

  it("re-exports the Session class as a constructor", () => {
    expect(typeof Session).toBe("function");
  });

  it("exports NotImplementedError for placeholder surfaces", () => {
    const err = new NotImplementedError("page.humanClick");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("NotImplementedError");
    expect(err.api).toBe("page.humanClick");
  });
});
