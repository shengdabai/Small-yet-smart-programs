import { describe, expect, test } from "bun:test";
import { esc, isIsoDate, positiveInt, safeHref, short } from "../scripts/lib/html.ts";

describe("html helpers", () => {
  test("esc neutralises markup and attribute breakouts", () => {
    expect(esc(`<img src=x onerror="alert(1)"> & "q"`)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &quot;q&quot;");
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });

  test("short strips tags, collapses whitespace, truncates, then escapes", () => {
    expect(short("<b>hello</b>   world\n\n<script>x</script>", 9)).toBe("hello wor…");
    expect(short("a & b")).toBe("a &amp; b");
    expect(short(null)).toBe("");
  });

  test("safeHref allows only absolute http(s) URLs", () => {
    expect(safeHref("https://example.com/a?b=1&c=2")).toBe("https://example.com/a?b=1&amp;c=2");
    expect(safeHref("  http://example.com ")).toBe("http://example.com/");
    expect(safeHref("javascript:alert(1)")).toBe("");
    expect(safeHref("JavaScript:alert(1)")).toBe("");
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBe("");
    expect(safeHref("vbscript:msgbox")).toBe("");
    expect(safeHref("//example.com")).toBe("");
    expect(safeHref("/relative/path")).toBe("");
    expect(safeHref('https://example.com/"><script>alert(1)</script>')).not.toContain("<");
    expect(safeHref(null)).toBe("");
  });

  test("isIsoDate accepts only real YYYY-MM-DD values", () => {
    expect(isIsoDate("2026-10-31")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-1-1")).toBe(false);
    expect(isIsoDate("2026-10-31') OR 1=1 --")).toBe(false);
    expect(isIsoDate("../../etc/passwd")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });

  test("positiveInt falls back for NaN, zero, negatives and junk", () => {
    expect(positiveInt("30", 7)).toBe(30);
    expect(positiveInt("abc", 7)).toBe(7);
    expect(positiveInt("0", 7)).toBe(7);
    expect(positiveInt("-5", 7)).toBe(7);
    expect(positiveInt(undefined, 7)).toBe(7);
  });
});
