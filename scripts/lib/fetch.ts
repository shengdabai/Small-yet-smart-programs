/**
 * fetch() with a hard deadline.
 *
 * Every source talks to third-party hosts from an unattended launchd job.
 * A host that accepts the connection and never answers would otherwise hang
 * the pipeline process forever; the lock in daily-scan.sh is only reclaimed
 * when the owner PID is dead, so one hung fetch would block every later run.
 */
export const DEFAULT_TIMEOUT_MS = 20_000;

export function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
}
