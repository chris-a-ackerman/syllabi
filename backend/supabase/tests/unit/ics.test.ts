import { assertEquals } from "@std/assert";
import { escapeICS, formatICSDate } from "../../functions/generate-ics/ics.ts";

Deno.test("formatICSDate renders timed events as local floating datetimes", () => {
  assertEquals(formatICSDate("2026-09-08", "09:30"), "20260908T093000");
  assertEquals(formatICSDate("2026-09-08", "09:05"), "20260908T090500");
});

Deno.test("formatICSDate adds an hour for the DTEND of timed events", () => {
  assertEquals(formatICSDate("2026-09-08", "09:30", true), "20260908T103000");
});

// Characterization: a 23:xx start rolls DTEND into hour "24", which is not a
// valid RFC 5545 time. Pinned as current behavior.
Deno.test("formatICSDate DTEND of a 23:xx event produces hour 24 (characterization)", () => {
  assertEquals(formatICSDate("2026-09-08", "23:30", true), "20260908T243000");
});

Deno.test("formatICSDate renders all-day events as VALUE=DATE strings", () => {
  assertEquals(formatICSDate("2026-09-08", null), "20260908");
});

Deno.test("formatICSDate advances all-day DTEND to the next day per RFC 5545", () => {
  assertEquals(formatICSDate("2026-09-08", null, true), "20260909");
  // month rollover
  assertEquals(formatICSDate("2026-09-30", null, true), "20261001");
});

Deno.test("escapeICS escapes backslash, semicolon, comma, and newline", () => {
  assertEquals(escapeICS("a\\b;c,d\ne"), "a\\\\b\\;c\\,d\\ne");
  assertEquals(escapeICS("plain"), "plain");
});
