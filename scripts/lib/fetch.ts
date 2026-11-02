/**
 * fetch() with a hard deadline.
 *
 * Every source talks to third-party hosts from an unattended launchd job.
 * daily-scan.sh limits the whole scan step, but a host that accepts the
 * connection and never answers would use up that limit, and the sources after
 * it would never run. A deadline per request keeps the damage to one source.
 */
export const DEFAULT_TIMEOUT_MS = 20_000;

export function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
}
