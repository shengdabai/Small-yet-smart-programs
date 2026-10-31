import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..", "..");

/** Run a repo script as a subprocess against the given SQLite file. */
export function runScript(dbPath: string, script: string, args: string[] = [], extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawnSync({
    cmd: ["bun", "run", join(ROOT, "scripts", script), ...args],
    cwd: ROOT,
    env: { ...process.env, SMART_PROGRAMS_DB: dbPath, ...extraEnv },
  });
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

/** Seed candidates (and optional scored rows) into dbPath; returns inserted ids. */
export function seed(dbPath: string, candidates: unknown[]): number[] {
  const proc = Bun.spawnSync({
    cmd: ["bun", "run", join(ROOT, "tests", "helpers", "seed.ts")],
    cwd: ROOT,
    env: { ...process.env, SMART_PROGRAMS_DB: dbPath },
    stdin: Buffer.from(JSON.stringify({ candidates })),
  });
  if (proc.exitCode !== 0) throw new Error(`seed failed: ${proc.stderr.toString()}`);
  return JSON.parse(proc.stdout.toString()) as number[];
}
