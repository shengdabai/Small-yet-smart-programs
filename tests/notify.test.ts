import { describe, expect, test } from "bun:test";
import { formatTripleBody } from "../scripts/notify.ts";

describe("notify.ts formatTripleBody", () => {
  test("joins ⭐⭐⭐ rows and substitutes a placeholder for a NULL or blank name", () => {
    const body = formatTripleBody([
      { name: "Alpha", url: "https://a.example", total: 31, scored_at: "2026-10-31 00:00:00" },
      { name: null, url: null, total: 29, scored_at: "2026-10-31 00:00:00" },
      { name: "   ", url: null, total: 28, scored_at: "2026-10-31 00:00:00" },
    ]);
    expect(body).toBe("Alpha (31/35) · (unnamed) (29/35) · (unnamed) (28/35)");
    expect(body).not.toContain("null");
  });
});
