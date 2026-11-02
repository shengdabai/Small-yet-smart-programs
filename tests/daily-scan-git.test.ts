import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "../daily-scan.sh");
const scratch: string[] = [];
const gitBin = "/opt/homebrew/bin/git";

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "smart-programs-git-"));
  scratch.push(root);
  const remote = join(root, "remote.git");
  const repo = join(root, "runtime");
  const logs = join(root, "logs");
  mkdirSync(repo);
  mkdirSync(logs);
  const git = (...args: string[]) => {
    const p = Bun.spawnSync([gitBin, "-C", repo, ...args]);
    if (p.exitCode !== 0) throw new Error(p.stderr.toString());
    return p.stdout.toString().trim();
  };
  git("init", "--bare", "--initial-branch=main", remote);
  git("init", "--initial-branch=main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  mkdirSync(join(repo, "daily"));
  writeFileSync(join(repo, "daily", "fixture.md"), "initial\n");
  writeFileSync(join(repo, "README.md"), "fixture\n");
  git("add", "daily/fixture.md", "README.md");
  git("commit", "-m", "initial");
  git("remote", "add", "origin", remote);
  git("push", "-u", "origin", "main");
  const run = (command: string) => Bun.spawnSync(["/bin/bash", "-c", 'source "$1"; ' + command, "_", script], {
    cwd: repo,
    env: { ...process.env, SMART_PROGRAMS_LIBRARY_ONLY: "1", SMART_PROGRAMS_DIR: repo,
      LOGDIR: logs, SMART_PROGRAMS_GIT_BIN: gitBin, FEISHU_TARGET: "", FEISHU_WEBHOOK: "",
      TASK_BRIDGE: "/nonexistent", HERMES: "/nonexistent", STEP_TIMEOUT_SECONDS: "10" },
  });
  return { repo, remote, logs, git, run };
}

test("main tracking origin/main is accepted", () => {
  expect(fixture().run("require_runtime_branch").exitCode).toBe(0);
});

test("task branch without upstream is refused without moving HEAD", () => {
  const f = fixture();
  f.git("switch", "-c", "ai/task");
  const head = f.git("rev-parse", "HEAD");
  expect(f.run("require_runtime_branch").exitCode).toBe(1);
  expect(f.git("branch", "--show-current")).toBe("ai/task");
  expect(f.git("rev-parse", "HEAD")).toBe(head);
  expect(readFileSync(join(f.logs, "smart-programs-daily.log"), "utf8")).toContain("upstream=none");
});

test("task branch tracking origin/main is still refused", () => {
  const f = fixture();
  f.git("switch", "-c", "ai/task", "--track", "origin/main");
  expect(f.run("require_runtime_branch").exitCode).toBe(1);
});

test("detached HEAD and main without upstream are refused", () => {
  const f = fixture();
  f.git("switch", "--detach");
  expect(f.run("require_runtime_branch").exitCode).toBe(1);
  f.git("switch", "main");
  f.git("branch", "--unset-upstream");
  expect(f.run("require_runtime_branch").exitCode).toBe(1);
});

test("retry pushes a committed briefing after a previous push failure", () => {
  const f = fixture();
  const before = f.git("rev-parse", "origin/main");
  const hook = join(f.remote, "hooks", "pre-receive");
  writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
  writeFileSync(join(f.repo, "daily", "fixture.md"), "updated\n");
  expect(f.run("publish_briefing").exitCode).toBe(1);
  const committed = f.git("rev-parse", "HEAD");
  expect(committed).not.toBe(before);
  expect(f.git("rev-parse", "origin/main")).toBe(before);
  expect(f.git("status", "--porcelain")).toBe("");
  rmSync(hook);
  expect(f.run("publish_briefing").exitCode).toBe(0);
  expect(f.git("rev-parse", "origin/main")).toBe(committed);
  expect(f.git("rev-parse", "HEAD")).toBe(committed);
});

test("publication refuses a task branch without committing generated files", () => {
  const f = fixture();
  f.git("switch", "-c", "ai/task");
  const before = f.git("rev-parse", "HEAD");
  writeFileSync(join(f.repo, "daily", "fixture.md"), "unpublished\n");
  expect(f.run("publish_briefing").exitCode).toBe(1);
  expect(f.git("rev-parse", "HEAD")).toBe(before);
  expect(f.git("diff", "--cached")).toBe("");
});
