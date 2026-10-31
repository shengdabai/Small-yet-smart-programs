import { afterAll, describe, expect, test } from "bun:test";
import { DEFAULT_TIMEOUT_MS, fetchWithTimeout } from "../scripts/lib/fetch.ts";

// A local server that accepts the request and never answers on /hang.
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/hang") {
      await new Promise((r) => setTimeout(r, 5_000));
      return new Response("late");
    }
    return new Response("ok");
  },
});
afterAll(() => server.stop(true));

describe("fetchWithTimeout", () => {
  test("has a finite default deadline", () => {
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });

  test("returns normally when the host answers in time", async () => {
    const res = await fetchWithTimeout(`http://localhost:${server.port}/fast`, {}, 2_000);
    expect(res.ok).toBe(true);
    expect(await res.text()).toBe("ok");
  });

  test("rejects instead of hanging when the host never answers", async () => {
    const t0 = Date.now();
    let error: unknown;
    try {
      await fetchWithTimeout(`http://localhost:${server.port}/hang`, { headers: { "User-Agent": "t" } }, 200);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("TimeoutError");
    expect(Date.now() - t0).toBeLessThan(3_000);
  });

  test("keeps a caller-supplied signal", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    let name = "";
    try {
      await fetchWithTimeout(`http://localhost:${server.port}/fast`, { signal: ctrl.signal });
    } catch (e) {
      name = (e as Error).name;
    }
    expect(name).toBe("AbortError");
  });
});
