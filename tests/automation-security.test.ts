import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildNotificationScript, osascriptNotify } from "../scripts/notify.ts";

const script = join(import.meta.dir, "..", "daily-scan.sh");
const logdir = mkdtempSync(join(tmpdir(), "smart-programs-lock-"));
const env = { ...process.env, SMART_PROGRAMS_LOGDIR: logdir, SMART_PROGRAMS_LOCK_STALE_SECONDS: "1" };

afterAll(() => rmSync(logdir, { force: true, recursive: true }));

function bash(command: string) {
  return Bun.spawnSync({ cmd: ["bash", "-c", command, "--", script], env });
}

function staleLock(pid = "999999", started = "1") {
  const lock = join(logdir, ".smart-programs.lock");
  mkdirSync(lock);
  writeFileSync(join(lock, "pid"), `${pid}\n`);
  writeFileSync(join(lock, "started"), `${started}\n`);
  return lock;
}

function concurrent(command: string) {
  return [
    Bun.spawn({ cmd: ["bash", "-c", command, "--", script], env, stdout: "ignore", stderr: "ignore" }),
    Bun.spawn({ cmd: ["bash", "-c", command, "--", script], env, stdout: "ignore", stderr: "ignore" }),
  ];
}

describe("daily automation security boundaries", () => {
  test("does not let a second process enter while an owner holds the mkdir lock", async () => {
    const owner = Bun.spawn({
      cmd: ["bash", "-c", 'source "$1"; acquire_lock; sleep 1; release_lock', "--", script],
      env,
      stdout: "ignore",
      stderr: "ignore",
    });
    await Bun.sleep(100);

    const contender = bash('source "$1"; if acquire_lock; then release_lock; exit 1; fi');
    expect(contender.exitCode).toBe(0);
    expect(await owner.exited).toBe(0);
  });

  test("allows exactly one concurrent contender to recover a valid stale lock", async () => {
    staleLock();
    const contenders = concurrent(
      'source "$1"; if acquire_lock; then mkdir "$SMART_PROGRAMS_LOGDIR/entered.$$"; sleep 0.2; test "$(cat "$LOCK_DIR/pid")" = "$$"; release_lock; fi',
    );

    expect(await contenders[0].exited).toBe(0);
    expect(await contenders[1].exited).toBe(0);
    expect(readdirSync(logdir).filter((name) => name.startsWith("entered.")).length).toBe(1);
  });

  test("recovers a crashed recovery claimant with two successor contenders", async () => {
    staleLock();
    const staleGuard = join(logdir, ".smart-programs.lock.recovery.lock");
    writeFileSync(staleGuard, "orphaned guard file; no kernel lock remains\n");
    expect(existsSync(staleGuard)).toBe(true);

    const contenders = concurrent(
      'source "$1"; if acquire_lock; then mkdir "$SMART_PROGRAMS_LOGDIR/recovered.$$"; sleep 0.2; test "$(cat "$LOCK_DIR/pid")" = "$$"; release_lock; fi',
    );
    expect(await contenders[0].exited).toBe(0);
    expect(await contenders[1].exited).toBe(0);
    expect(readdirSync(logdir).filter((name) => name.startsWith("recovered.")).length).toBe(1);
  });

  test("exactly one contender recovers old empty lock metadata", async () => {
    const lock = join(logdir, ".smart-programs.lock");
    mkdirSync(lock);
    utimesSync(lock, new Date(0), new Date(0));
    const contenders = concurrent(
      'source "$1"; if acquire_lock; then mkdir "$SMART_PROGRAMS_LOGDIR/empty-recovered.$$"; sleep 0.2; release_lock; fi',
    );

    expect(await contenders[0].exited).toBe(0);
    expect(await contenders[1].exited).toBe(0);
    expect(readdirSync(logdir).filter((name) => name.startsWith("empty-recovered.")).length).toBe(1);
  });

  test("old partial or invalid metadata is recoverable only under the guard", async () => {
    const lock = join(logdir, ".smart-programs.lock");
    mkdirSync(lock);
    writeFileSync(join(lock, "pid"), "0\n");
    utimesSync(lock, new Date(0), new Date(0));
    expect(bash('source "$1"; acquire_lock && release_lock').exitCode).toBe(0);

    staleLock("not-a-pid");
    utimesSync(lock, new Date(0), new Date(0));
    expect(bash('source "$1"; acquire_lock && release_lock').exitCode).toBe(0);
  });

  test("does not take an incomplete lock while its creator holds the kernel guard", async () => {
    const ready = join(logdir, "guard-ready");
    const creator = Bun.spawn({
      cmd: [
        "python3", "-c",
        "import fcntl, os, pathlib, sys, time; root=pathlib.Path(sys.argv[1]); guard=open(str(root / '.smart-programs.lock.recovery.lock'), 'a+'); fcntl.lockf(guard, fcntl.LOCK_EX); (root / '.smart-programs.lock').mkdir(); (root / 'guard-ready').touch(); time.sleep(0.8)",
        logdir,
      ],
      stdout: "ignore",
      stderr: "ignore",
    });
    for (let i = 0; i < 40 && !existsSync(ready); i += 1) await Bun.sleep(20);
    expect(existsSync(ready)).toBe(true);
    const contender = bash('source "$1"; if acquire_lock; then release_lock; exit 10; fi');
    expect(contender.exitCode).toBe(0);
    expect(await creator.exited).toBe(0);
    rmSync(join(logdir, ".smart-programs.lock"), { force: true, recursive: true });
  });

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

  test.if(process.platform === "darwin")("parses hostile notification text as one AppleScript string", () => {
    const probe = join(logdir, "osascript-injection-probe");
    const hostile = `"; do shell script "touch ${probe}"; "`;
    const parsed = Bun.spawnSync({ cmd: ["osascript", "-e", buildNotificationScript("scanner", hostile)] });

    expect(parsed.exitCode).toBe(0);
    expect(existsSync(probe)).toBe(false);
  });
});
