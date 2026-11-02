import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

// Plain read/write copy, for the reason given at copyTree in data-pipeline.test.ts.
function copyTree(from: string, to: string) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) {
      copyTree(source, target);
    } else {
      writeFileSync(target, readFileSync(source));
      chmodSync(target, statSync(source).mode);
    }
  }
}

/**
 * A private copy of scripts/ in a temp directory. db.ts, profile.ts and the report writers resolve their paths
 * relative to their own file, so everything a script does stays in the copy. Child processes get a fake HOME and no
 * Firecrawl key, so they cannot read the operator's key file, and `open` is a shim that only records its arguments.
 */
export function makeProject() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "smart-programs-cli-")));
  copyTree(join(ROOT, "scripts"), join(dir, "scripts"));
  mkdirSync(join(dir, "tests", "helpers"), { recursive: true });
  writeFileSync(join(dir, "tests", "helpers", "seed.ts"), readFileSync(join(ROOT, "tests", "helpers", "seed.ts")));
  mkdirSync(join(dir, "config"));
  writeFileSync(join(dir, "config", "profile.example.json"), readFileSync(join(ROOT, "config", "profile.example.json")));
  mkdirSync(join(dir, "bin"));
  const openLog = join(dir, "open.log");
  writeFileSync(join(dir, "bin", "open"), `#!/bin/sh\nprintf '%s\\n' "$@" >> "${openLog}"\n`, { mode: 0o700 });

  const { FIRECRAWL_API_KEY: _key, ...inherited } = process.env;
  const env = { ...inherited, HOME: dir, PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}` };
  const result = (proc: ReturnType<typeof Bun.spawnSync>) => ({
    code: proc.exitCode,
    out: proc.stdout.toString(),
    err: proc.stderr.toString(),
  });

  return {
    dir,
    /** Run scripts/<script> in the copy. */
    run: (script: string, args: string[] = []) =>
      result(Bun.spawnSync({ cmd: [process.execPath, "run", join(dir, "scripts", script), ...args], cwd: dir, env })),
    /** Run inline code with the copy as the working directory. */
    evaluate: (code: string) => result(Bun.spawnSync({ cmd: [process.execPath, "-e", code], cwd: dir, env })),
    /** Seed candidates (and optional scored rows) into the copy's database; returns the inserted ids. */
    seed(candidates: unknown[]): number[] {
      const proc = Bun.spawnSync({
        cmd: [process.execPath, "run", join(dir, "tests", "helpers", "seed.ts")],
        cwd: dir,
        env,
        stdin: Buffer.from(JSON.stringify({ candidates })),
      });
      if (proc.exitCode !== 0) throw new Error(`seed failed: ${proc.stderr.toString()}`);
      return JSON.parse(proc.stdout.toString()) as number[];
    },
    /** Paths passed to the `open` shim. */
    opened: () => (existsSync(openLog) ? readFileSync(openLog, "utf8").trim().split("\n") : []),
    cleanup: () => rmSync(dir, { force: true, recursive: true }),
  };
}
