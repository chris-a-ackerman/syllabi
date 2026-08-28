import { assertEquals } from "@std/assert";
import { stripJsonFences } from "../../functions/_shared/strip-json-fences.ts";

Deno.test("passes raw JSON through untouched (trimmed)", () => {
  assertEquals(stripJsonFences('  {"a":1}  '), '{"a":1}');
});

Deno.test("strips a plain ```json fence pair", () => {
  assertEquals(stripJsonFences('```json\n{"a":1}\n```'), '{"a":1}');
});

Deno.test("strips preamble text before the fence", () => {
  assertEquals(
    stripJsonFences('Here is the JSON you asked for:\n```json\n{"a":1}\n```'),
    '{"a":1}',
  );
});

Deno.test("strips trailing commentary after the closing fence", () => {
  assertEquals(
    stripJsonFences('```json\n{"a":1}\n```\nLet me know if you need anything else!'),
    '{"a":1}',
  );
});

Deno.test("handles multi-line JSON bodies", () => {
  const body = '{\n  "events": [\n    {"title": "Midterm"}\n  ]\n}';
  assertEquals(stripJsonFences("```json\n" + body + "\n```"), body);
  assertEquals(JSON.parse(stripJsonFences("```json\n" + body + "\n```")).events.length, 1);
});
