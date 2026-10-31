/**
 * Calendar helpers shared by the report generators.
 */

/**
 * ISO-8601 week label (`YYYY-Www`) for a UTC instant.
 *
 * The year is the ISO week-year of the date's Thursday, not the calendar
 * year: 2024-12-30 belongs to 2025-W01 and 2027-01-01 to 2026-W53. Using the
 * calendar year made the weekly report for the last days of December reuse
 * the file name of week 1 of the same year, overwriting that report.
 */
export function isoWeek(d: Date): string {
  const thursday = new Date(d.valueOf());
  const dayNr = (d.getUTCDay() + 6) % 7; // Monday = 0
  thursday.setUTCDate(thursday.getUTCDate() - dayNr + 3);
  const weekYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(weekYear, 0, 4)); // Jan 4 is always in week 1
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((thursday.valueOf() - firstThursday.valueOf()) / 604800000);
  return `${weekYear}-W${week.toString().padStart(2, "0")}`;
}
