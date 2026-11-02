/** SQLite's numeric affinity also permits TEXT; validate before HTML interpolation. */
export function reportNumber(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value : null;
}

export function reportDays(args: string[], fallback: number): number {
  const index = args.indexOf("--days");
  if (index < 0) return fallback;
  const value = args[index + 1];
  const days = Number(value);
  if (!value || !/^\d+$/.test(value) || !Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error("--days must be an integer from 1 to 3650");
  }
  return days;
}
