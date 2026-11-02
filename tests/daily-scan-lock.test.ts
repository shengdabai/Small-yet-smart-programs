import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// bun 1.3.x ignores [test] timeout in bunfig.toml and every test defaults to 5 s, but a test that starts a bash or bun
// child process can take 20-70 s when the machine is busy. These tests therefore carry an explicit per-test timeout.
const SLOW_TEST_MS = 60_000;

// Process-lock regression tests. Ported from the desktop clone's ededc86 hardening (tests/automation-security.test.ts),
// adapted to the runtime copy: LOGDIR / LOCKD names and the SMART_PROGRAMS_LIBRARY_ONLY
// source guard. acquire_lock exit codes: 0 = acquired, 75 = busy, anything else = error.

const script = join(import.meta.dir, "..", "daily-scan.sh");
const BUSY = 75;
const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true });
});

function freshLogdir() {
  const dir = mkdtempSync(join(tmpdir(), "smart-programs-lock-"));
  dirs.push(dir);
  return dir;
}

function envFor(logdir: string, stale = "1") {
  return {
    ...process.env,
    LOGDIR: logdir,
    SMART_PROGRAMS_LIBRARY_ONLY: "1",
    SMART_PROGRAMS_LOCK_STALE_SECONDS: stale,
  };
}

function bash(logdir: string, command: string, stale = "1") {
  return Bun.spawnSync({ cmd: ["/bin/bash", "-c", command, "--", script], env: envFor(logdir, stale) });
}

function spawnBash(logdir: string, command: string, stale = "1") {
  return Bun.spawn({
    cmd: ["/bin/bash", "-c", command, "--", script],
    env: envFor(logdir, stale),
    stdout: "ignore",
    stderr: "ignore",
  });
}

function lockPath(logdir: string) {
  return join(logdir, ".smart-programs.lockd");
}

function makeLock(logdir: string, files: Record<string, string>) {
  const lock = lockPath(logdir);
  mkdirSync(lock);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(lock, name), body);
  return lock;
}

function staleLock(logdir: string, pid = "999999", started = "1") {
  return makeLock(logdir, { pid: `${pid}\n`, started: `${started}\n` });
}

function names(logdir: string, prefix: string) {
  return readdirSync(logdir).filter((name) => name.startsWith(prefix));
}

const ACQUIRE_THEN_RELEASE = (marker: string) =>
  `source "$1"; if acquire_lock; then mkdir "$LOGDIR/${marker}.$$"; sleep 0.2; test "$(cat "$LOCKD/pid")" = "$$"; release_lock; fi`;

describe("daily-scan process lock", () => {
  test("does not let a second process enter while an owner holds the lock", async () => {
    const logdir = freshLogdir();
    const owner = spawnBash(logdir, 'source "$1"; acquire_lock; sleep 1; release_lock');
    await Bun.sleep(300);

    const contender = bash(logdir, 'source "$1"; acquire_lock; exit $?');
    expect(contender.exitCode).toBe(BUSY);
    expect(await owner.exited).toBe(0);
  }, SLOW_TEST_MS);

  test("allows exactly one concurrent contender to recover a valid stale lock", async () => {
    const logdir = freshLogdir();
    staleLock(logdir);
    const a = spawnBash(logdir, ACQUIRE_THEN_RELEASE("entered"));
    const b = spawnBash(logdir, ACQUIRE_THEN_RELEASE("entered"));

    expect(await a.exited).toBe(0);
    expect(await b.exited).toBe(0);
    expect(names(logdir, "entered.").length).toBe(1);
  }, SLOW_TEST_MS);

  test("recovers when a crashed claimant left an orphaned guard file", async () => {
    const logdir = freshLogdir();
    staleLock(logdir);
    const guard = join(logdir, ".smart-programs.lockd.recovery.lock");
    writeFileSync(guard, "orphaned guard file; no kernel lock remains\n");

    const a = spawnBash(logdir, ACQUIRE_THEN_RELEASE("recovered"));
    const b = spawnBash(logdir, ACQUIRE_THEN_RELEASE("recovered"));
    expect(await a.exited).toBe(0);
    expect(await b.exited).toBe(0);
    expect(names(logdir, "recovered.").length).toBe(1);
  }, SLOW_TEST_MS);

  test("exactly one contender recovers an old lock directory with no metadata", async () => {
    const logdir = freshLogdir();
    const lock = lockPath(logdir);
    mkdirSync(lock);
    utimesSync(lock, new Date(0), new Date(0));
    const a = spawnBash(logdir, ACQUIRE_THEN_RELEASE("empty-recovered"));
    const b = spawnBash(logdir, ACQUIRE_THEN_RELEASE("empty-recovered"));

    expect(await a.exited).toBe(0);
    expect(await b.exited).toBe(0);
    expect(names(logdir, "empty-recovered.").length).toBe(1);
  }, SLOW_TEST_MS);

  test("old partial or invalid metadata is recoverable only under the guard", () => {
    const logdir = freshLogdir();
    const lock = makeLock(logdir, { pid: "0\n" });
    utimesSync(lock, new Date(0), new Date(0));
    expect(bash(logdir, 'source "$1"; acquire_lock && release_lock').exitCode).toBe(0);

    makeLock(logdir, { pid: "not-a-pid\n", started: "1\n" });
    utimesSync(lock, new Date(0), new Date(0));
    expect(bash(logdir, 'source "$1"; acquire_lock && release_lock').exitCode).toBe(0);
  }, SLOW_TEST_MS);

  test("does not take an incomplete lock while its creator holds the kernel guard", async () => {
    const logdir = freshLogdir();
    const ready = join(logdir, "guard-ready");
    const creator = Bun.spawn({
      cmd: [
        "python3", "-c",
        "import fcntl, pathlib, sys, time; root=pathlib.Path(sys.argv[1]); guard=open(str(root / '.smart-programs.lockd.recovery.lock'), 'a+'); fcntl.lockf(guard, fcntl.LOCK_EX); (root / '.smart-programs.lockd').mkdir(); (root / 'guard-ready').touch(); time.sleep(0.8)",
        logdir,
      ],
      stdout: "ignore",
      stderr: "ignore",
    });
    for (let i = 0; i < 40 && !existsSync(ready); i += 1) await Bun.sleep(20);
    expect(existsSync(ready)).toBe(true);

    // stale=0 would make the metadata-less directory instantly recoverable; only the
    // kernel guard may keep this contender out.
    const contender = bash(logdir, 'source "$1"; acquire_lock; exit $?', "0");
    expect(contender.exitCode).toBe(BUSY);
    expect(await creator.exited).toBe(0);
  }, SLOW_TEST_MS);

  test("a live owner in another user's namespace (kill -0 EPERM) keeps the lock", () => {
    const logdir = freshLogdir();
    // pid 1 (launchd) exists but belongs to root: os.kill(1, 0) raises PermissionError.
    const lock = staleLock(logdir, "1", "1");
    const result = bash(logdir, 'source "$1"; acquire_lock; exit $?');

    expect(result.exitCode).toBe(BUSY);
    expect(readFileSync(join(lock, "pid"), "utf8").trim()).toBe("1");
  }, SLOW_TEST_MS);

  test("a dead owner's lock is reclaimed only after the stale-age threshold", () => {
    const logdir = freshLogdir();
    const now = Math.floor(Date.now() / 1000);
    const lock = staleLock(logdir, "999999", String(now));

    const tooFresh = bash(logdir, 'source "$1"; acquire_lock; exit $?', "900");
    expect(tooFresh.exitCode).toBe(BUSY);
    expect(readFileSync(join(lock, "pid"), "utf8").trim()).toBe("999999");

    writeFileSync(join(lock, "started"), `${now - 901}\n`);
    const old = bash(logdir, 'source "$1"; acquire_lock && release_lock', "900");
    expect(old.exitCode).toBe(0);
    expect(existsSync(lock)).toBe(false);
  }, SLOW_TEST_MS);

  test("reclaim renames the old lock away and keeps files it does not recognise", () => {
    const logdir = freshLogdir();
    const lock = makeLock(logdir, { pid: "999999\n", started: "1\n", "keep.txt": "do not delete\n" });
    const result = bash(logdir, 'source "$1"; acquire_lock; rc=$?; echo "owner=$(cat "$LOCKD/pid") me=$$"; exit $rc');

    expect(result.exitCode).toBe(0);
    const [, owner, me] = /owner=(\d+) me=(\d+)/.exec(result.stdout.toString()) ?? [];
    expect(owner).toBeDefined();
    expect(owner).toBe(me);
    const parked = names(logdir, ".smart-programs.lockd.stale.");
    expect(parked.length).toBe(1);
    expect(readFileSync(join(logdir, parked[0], "keep.txt"), "utf8")).toBe("do not delete\n");
    expect(existsSync(lock)).toBe(true);
  }, SLOW_TEST_MS);

  test("a legacy pid-only lock (the shape left by the old script / archiver) is reclaimed by age", () => {
    const logdir = freshLogdir();
    const lock = makeLock(logdir, { pid: "999999" });

    const fresh = bash(logdir, 'source "$1"; acquire_lock; exit $?', "900");
    expect(fresh.exitCode).toBe(BUSY);

    utimesSync(lock, new Date(0), new Date(0));
    const old = bash(logdir, 'source "$1"; acquire_lock && release_lock', "900");
    expect(old.exitCode).toBe(0);
    expect(existsSync(lock)).toBe(false);
  }, SLOW_TEST_MS);

  test("a legacy pid-only lock whose owner is still alive is never reclaimed, however old", () => {
    const logdir = freshLogdir();
    // Our own pid is guaranteed alive for the duration of the test.
    const lock = makeLock(logdir, { pid: `${process.pid}\n` });
    utimesSync(lock, new Date(0), new Date(0));
    const result = bash(logdir, 'source "$1"; acquire_lock; exit $?', "900");
    expect(result.exitCode).toBe(BUSY);
    expect(existsSync(lock)).toBe(true);
    expect(readFileSync(join(lock, "pid"), "utf8")).toBe(`${process.pid}\n`);
    expect(names(logdir, ".smart-programs.lockd.stale.").length).toBe(0);
  }, SLOW_TEST_MS);

  test("a lock whose recorded process identity no longer matches its pid (pid reused) is reclaimed", () => {
    const logdir = freshLogdir();
    const lock = makeLock(logdir, {
      pid: `${process.pid}\n`,
      started: "1\n",
      identity: "v2 Thu Jan  1 00:00:00 1970\n",
    });
    const result = bash(logdir, 'source "$1"; acquire_lock && release_lock', "900");
    expect(result.exitCode).toBe(0);
    expect(existsSync(lock)).toBe(false);
  }, SLOW_TEST_MS);

  test("a lock whose recorded identity matches the live pid stays held, however old", () => {
    const logdir = freshLogdir();
    const identity = Bun.spawnSync({
      cmd: ["/bin/ps", "-o", "lstart=", "-p", String(process.pid)],
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    }).stdout.toString().trim();
    const lock = makeLock(logdir, { pid: `${process.pid}\n`, started: "1\n", identity: `v2 ${identity}\n` });
    const result = bash(logdir, 'source "$1"; acquire_lock; exit $?', "900");
    expect(result.exitCode).toBe(BUSY);
    expect(existsSync(lock)).toBe(true);
  }, SLOW_TEST_MS);

  test("a live owner stays held when the contender runs in a different time zone", () => {
    const logdir = freshLogdir();
    const identity = Bun.spawnSync({
      cmd: ["/bin/ps", "-o", "lstart=", "-p", String(process.pid)],
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    }).stdout.toString().trim();
    const lock = makeLock(logdir, { pid: `${process.pid}\n`, started: "1\n", identity: `v2 ${identity}\n` });
    for (const tz of ["Asia/Shanghai", "America/Los_Angeles"]) {
      const result = Bun.spawnSync({
        cmd: ["/bin/bash", "-c", 'source "$1"; acquire_lock; exit $?', "--", script],
        env: { ...envFor(logdir, "900"), TZ: tz },
      });
      expect(result.exitCode).toBe(BUSY);
    }
    expect(existsSync(lock)).toBe(true);
  }, SLOW_TEST_MS);

  test("an identity without the version tag cannot be verified, so a live owner keeps the lock", () => {
    const logdir = freshLogdir();
    const lock = makeLock(logdir, { pid: `${process.pid}\n`, started: "1\n", identity: "Thu Jan  1 00:00:00 1970\n" });
    const result = bash(logdir, 'source "$1"; acquire_lock; exit $?', "900");
    expect(result.exitCode).toBe(BUSY);
    expect(existsSync(lock)).toBe(true);
  }, SLOW_TEST_MS);

  test("an acquired lock records the owner's identity and release removes every metadata file", () => {
    const logdir = freshLogdir();
    const result = bash(logdir, 'source "$1"; acquire_lock || exit 9; grep -Eq "^v2 [A-Z][a-z]{2} " "$LOCKD/identity" || exit 8; release_lock; exit 0');
    expect(result.exitCode).toBe(0);
    expect(existsSync(lockPath(logdir))).toBe(false);
  }, SLOW_TEST_MS);

  test("release_lock never removes a lock owned by another process", () => {
    const logdir = freshLogdir();
    const lock = staleLock(logdir, "424242", "1");
    expect(bash(logdir, 'source "$1"; release_lock').exitCode).toBe(0);
    expect(readFileSync(join(lock, "pid"), "utf8").trim()).toBe("424242");
  }, SLOW_TEST_MS);

  test("release_lock leaves no directory behind so the post-delivery archiver can mkdir it", () => {
    const logdir = freshLogdir();
    expect(bash(logdir, 'source "$1"; acquire_lock && release_lock').exitCode).toBe(0);
    expect(existsSync(lockPath(logdir))).toBe(false);
  }, SLOW_TEST_MS);

  test("a live holder is reported through LOCK_HELD_PID so the watchdog can age it", async () => {
    const logdir = freshLogdir();
    const owner = spawnBash(logdir, 'source "$1"; acquire_lock; sleep 1; release_lock');
    await Bun.sleep(300);

    const contender = bash(logdir, 'source "$1"; acquire_lock; echo "rc=$? held=$LOCK_HELD_PID"');
    expect(contender.stdout.toString()).toMatch(/rc=75 held=\d+/);
    expect(await owner.exited).toBe(0);
  }, SLOW_TEST_MS);

  test("an unusable python is an error, not a silent skip", () => {
    const logdir = freshLogdir();
    const result = Bun.spawnSync({
      cmd: ["/bin/bash", "-c", 'source "$1"; acquire_lock; exit $?', "--", script],
      env: { ...envFor(logdir), SMART_PROGRAMS_PYTHON_BIN: "/nonexistent/python3", PATH: "/nonexistent" },
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.exitCode).not.toBe(BUSY);
  }, SLOW_TEST_MS);
});
