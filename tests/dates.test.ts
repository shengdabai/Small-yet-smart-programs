import { describe, expect, test } from "bun:test";
import { isoWeek } from "../scripts/lib/dates.ts";

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("isoWeek", () => {
  test("uses the ISO week-year, not the calendar year, across New Year", () => {
    // Mon 2024-12-30 .. Sun 2025-01-05 is 2025-W01.
    expect(isoWeek(at("2024-12-30"))).toBe("2025-W01");
    expect(isoWeek(at("2024-12-31"))).toBe("2025-W01");
    expect(isoWeek(at("2025-01-01"))).toBe("2025-W01");
    expect(isoWeek(at("2025-01-05"))).toBe("2025-W01");
    // Fri 2027-01-01 .. Sun 2027-01-03 still belong to 2026-W53.
    expect(isoWeek(at("2026-12-31"))).toBe("2026-W53");
    expect(isoWeek(at("2027-01-01"))).toBe("2026-W53");
    expect(isoWeek(at("2027-01-03"))).toBe("2026-W53");
    expect(isoWeek(at("2027-01-04"))).toBe("2027-W01");
    // Sun 2021-01-03 is the tail of 2020-W53.
    expect(isoWeek(at("2021-01-03"))).toBe("2020-W53");
  });

  test("matches known mid-year weeks and pads to two digits", () => {
    expect(isoWeek(at("2026-10-31"))).toBe("2026-W44");
    expect(isoWeek(at("2026-01-05"))).toBe("2026-W02");
    expect(isoWeek(at("2025-06-15"))).toBe("2025-W24");
  });

  test("a whole week shares one label and Monday starts the next", () => {
    for (let day = 5; day <= 11; day++) expect(isoWeek(at(`2026-01-${String(day).padStart(2, "0")}`))).toBe("2026-W02");
    expect(isoWeek(at("2026-01-12"))).toBe("2026-W03");
  });
});
