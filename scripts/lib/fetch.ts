/**
 * fetch() with a hard deadline.
 *
 * Every source talks to third-party hosts from an unattended launchd job.
 * daily-scan.sh limits the whole scan step, but a host that accepts the
 * connection and never answers would hold the step until that limit, and the
 * scan would count as timed out. A deadline per request limits the damage to
 * one source.
 */
export const DEFAULT_TIMEOUT_MS = 20_000;

export function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const deadline = AbortSignal.timeout(timeoutMs);
  return fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
}
