import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildNotificationScript, osascriptNotify } from "../scripts/notify.ts";

// Ported from the desktop clone's ededc86 hardening (tests/automation-security.test.ts).

describe("notify.ts osascript boundary", () => {
  test("passes hostile notification text as one osascript argument", () => {
    const hostile = '"; do shell script "touch /tmp/owned"; "';
    const calls: Array<{ file: string; args: string[]; stdio: string }> = [];
    const ok = osascriptNotify("title\\\"", hostile, (file, args, options) => {
      calls.push({ file, args, stdio: options.stdio });
    });

    expect(ok).toBe(true);
    expect(calls).toEqual([{ file: "osascript", args: ["-e", buildNotificationScript("title\\\"", hostile)], stdio: "ignore" }]);
    expect(calls[0].args).toHaveLength(2);
  });

  test("a single quote or shell metacharacter stays inside the single argv entry", () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    osascriptNotify("t", "it's $(touch /tmp/owned) `id`", (file, args) => {
      calls.push({ file, args });
    });
    expect(calls[0].file).toBe("osascript");
    expect(calls[0].args).toHaveLength(2);
    expect(calls[0].args[1]).toContain("it's $(touch /tmp/owned) `id`");
  });

  test("hostile text yields exactly three AppleScript string literals (no injected statement)", () => {
    const hostile = '"; do shell script "touch /tmp/owned"; "';
    const script = buildNotificationScript('t"\\', hostile);
    // Drop escaped backslashes and escaped quotes; every remaining quote opens or closes
    // one of the three literals: body, title, "Glass".
    const bare = script.replace(/\\\\/g, "").replace(/\\"/g, "");
    expect(bare.match(/"/g)?.length).toBe(6);
    expect(script).not.toMatch(/\n|\r/);
  });

  test("importing notify.ts does not open the database", () => {
    const source = readFileSync(join(import.meta.dir, "..", "scripts", "notify.ts"), "utf8");
    expect(source).not.toMatch(/^import .* from "\.\/db\.ts"/m);
  });
});
