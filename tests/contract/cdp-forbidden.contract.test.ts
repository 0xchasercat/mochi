/**
 * Cross-package contract test for the §8.2 forbidden-method runtime
 * assertions.
 *
 * The contract is: `@mochi.js/core` MUST refuse to send any of:
 *   - Runtime.enable
 *   - Page.createIsolatedWorld
 *   - Runtime.evaluate with includeCommandLineAPI: true
 *
 * The rejection MUST be a `ForbiddenCdpMethodError` and MUST surface BEFORE
 * any I/O. This test exercises the public router surface with a fake transport
 * (no Bun.spawn / no Chromium) so it runs in CI as a fast unit-style contract.
 *
 * @see PLAN.md §8.2
 * @see tasks/0011-cdp-pipe-transport.md
 */

import { describe, expect, it } from "bun:test";
import { MessageRouter } from "../../packages/core/src/cdp/router";
import type { PipeReader, PipeWriter } from "../../packages/core/src/cdp/transport";
// Import via relative path; the root workspace doesn't list @mochi.js/core as
// a dep (it's a workspace package). The contract is on the public exports
// regardless of how we get to them.
import { ForbiddenCdpMethodError } from "../../packages/core/src/index";

/** A transport pair that records writes and never delivers data. */
function makeFakePipes(): {
  reader: PipeReader;
  writer: PipeWriter;
  written: Uint8Array[];
} {
  const written: Uint8Array[] = [];
  const stream = new ReadableStream<Uint8Array>({ start() {} });
  return {
    reader: { getReader: () => stream.getReader() },
    writer: {
      write(chunk) {
        written.push(chunk as Uint8Array);
      },
      flush() {},
      end() {},
    },
    written,
  };
}

describe("contract: §8.2 forbidden CDP methods are runtime-asserted by @mochi.js/core", () => {
  it("Runtime.enable is rejected without writing to the transport", async () => {
    const { reader, writer, written } = makeFakePipes();
    const router = new MessageRouter(reader, writer);
    router.start();
    let caught: unknown;
    try {
      await router.send("Runtime.enable");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ForbiddenCdpMethodError);
    expect((caught as ForbiddenCdpMethodError).method).toBe("Runtime.enable");
    expect(written.length).toBe(0);
    await router.close();
  });

  it("Page.createIsolatedWorld is rejected without writing to the transport", async () => {
    const { reader, writer, written } = makeFakePipes();
    const router = new MessageRouter(reader, writer);
    router.start();
    let caught: unknown;
    try {
      await router.send("Page.createIsolatedWorld", { frameId: "f1" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ForbiddenCdpMethodError);
    expect((caught as ForbiddenCdpMethodError).method).toBe("Page.createIsolatedWorld");
    expect(written.length).toBe(0);
    await router.close();
  });

  it("Runtime.evaluate with includeCommandLineAPI:true is rejected", async () => {
    const { reader, writer, written } = makeFakePipes();
    const router = new MessageRouter(reader, writer);
    router.start();
    let caught: unknown;
    try {
      await router.send("Runtime.evaluate", {
        expression: "1+1",
        includeCommandLineAPI: true,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ForbiddenCdpMethodError);
    expect((caught as ForbiddenCdpMethodError).method).toBe("Runtime.evaluate");
    expect((caught as ForbiddenCdpMethodError).reason).toContain("includeCommandLineAPI");
    expect(written.length).toBe(0);
    await router.close();
  });

  it("Permitted methods (e.g. Page.navigate) DO write to the transport", async () => {
    const { reader, writer, written } = makeFakePipes();
    const router = new MessageRouter(reader, writer, { defaultTimeoutMs: 50 });
    router.start();
    // We don't await the response (no fake response will arrive); we just
    // verify that the request reached the transport before the timeout fires.
    const promise = router
      .send("Page.navigate", { url: "https://example.test" })
      .catch(() => undefined);
    expect(written.length).toBe(1);
    // Validate the on-the-wire shape: NUL-terminated JSON.
    const buf = written[0];
    if (buf === undefined) throw new Error("expected one write to the transport");
    expect(buf[buf.length - 1]).toBe(0);
    const json = JSON.parse(new TextDecoder().decode(buf.subarray(0, buf.length - 1))) as {
      method: string;
      params: { url: string };
    };
    expect(json.method).toBe("Page.navigate");
    expect(json.params.url).toBe("https://example.test");
    await promise;
    await router.close();
  });
});
