import { describe, expect, test } from "bun:test";
import { esc, isIsoDate, short } from "../scripts/lib/html.ts";

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

  test("isIsoDate accepts only real YYYY-MM-DD values", () => {
    expect(isIsoDate("2026-10-31")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-1-1")).toBe(false);
    expect(isIsoDate("2026-10-31') OR 1=1 --")).toBe(false);
    expect(isIsoDate("../../etc/passwd")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });
});
