import { describe, expect, test } from "bun:test";
import { buildNotificationScript, osascriptNotify } from "../scripts/notify.ts";

// The process-lock half of this file was ported to main as tests/daily-scan-lock.test.ts
// (LOGDIR / LOCKD names, SMART_PROGRAMS_LIBRARY_ONLY source guard, busy exit code 75), so
// only the notify.ts argv-boundary check remains here. It never spawns osascript.

describe("daily automation security boundaries", () => {
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
});
