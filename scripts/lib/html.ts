/**
 * Shared helpers for the generated HTML (daily briefing, report-html-v2).
 *
 * Candidate names, descriptions and URLs come straight from public sources
 * (HN titles, Reddit posts, scraped pages), so everything that lands in the
 * published page must be escaped, and link targets must be real web URLs.
 */

/** Escape text for use inside HTML text nodes and double-quoted attributes. */
export function esc(s: string | null | undefined): string {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Strip tags, collapse whitespace, truncate to n chars, then escape. */
export function short(s: string | null | undefined, n = 200): string {
  if (!s) return "";
  const c = String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return esc(c.length > n ? c.slice(0, n) + "…" : c);
}

/**
 * Return an escaped href for a candidate URL, or "" when the value is not an
 * absolute http(s) URL. A `javascript:` or `data:` value stored by a source
 * would otherwise become an executable link on the public site.
 */
export function safeHref(url: string | null | undefined): string {
  if (!url) return "";
  let parsed: URL;
  try {
    parsed = new URL(String(url).trim());
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
  return esc(parsed.href);
}

/** `YYYY-MM-DD` only; used for CLI `--date` values that reach SQL and file names. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Parse a positive integer CLI value, falling back to `def` for anything else. */
export function positiveInt(value: string | undefined, def: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isInteger(n) && n > 0 ? n : def;
}
