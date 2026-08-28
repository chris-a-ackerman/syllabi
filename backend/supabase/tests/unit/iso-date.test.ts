import { assertEquals } from "@std/assert";
import { isoToDate } from "../../functions/_shared/iso-date.ts";
import { stripHtml } from "../../functions/_shared/strip-html.ts";

Deno.test("isoToDate truncates ISO datetimes to YYYY-MM-DD", () => {
  assertEquals(isoToDate("2026-09-08T23:59:00Z"), "2026-09-08");
  assertEquals(isoToDate("2026-09-08"), "2026-09-08");
});

Deno.test("isoToDate returns null for null/undefined/empty", () => {
  assertEquals(isoToDate(null), null);
  assertEquals(isoToDate(undefined), null);
  assertEquals(isoToDate(""), null);
});

Deno.test("stripHtml flattens tags and collapses whitespace", () => {
  assertEquals(
    stripHtml("<p>Submit <strong>online</strong>.</p>\n<p>Late  work: no.</p>"),
    "Submit online . Late work: no.",
  );
  assertEquals(stripHtml("plain text"), "plain text");
  assertEquals(stripHtml(""), "");
});
