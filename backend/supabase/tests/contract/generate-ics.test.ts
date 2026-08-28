// The one full success-path contract: generate-ics has no external
// dependencies, so a valid JWT + seeded data must yield a real calendar.
import { assertEquals, assertStringIncludes } from "@std/assert";
import { callFn, getFixtures } from "./helpers.ts";

Deno.test("returns a VCALENDAR containing the seeded event for a valid user", async () => {
  const { userA, semesterA } = await getFixtures();
  const res = await callFn("generate-ics", {
    token: userA.token,
    method: "GET",
    query: `?semester_id=${semesterA}`,
  });
  assertEquals(res.status, 200, `expected 200, got ${res.status}: ${res.text.slice(0, 200)}`);
  assertEquals(res.text.startsWith("BEGIN:VCALENDAR"), true);
  assertStringIncludes(res.text, "Contract Midterm");
  assertStringIncludes(res.text, "END:VCALENDAR");
});

Deno.test("requires semester_id", async () => {
  const { userA } = await getFixtures();
  const res = await callFn("generate-ics", { token: userA.token, method: "GET" });
  assertEquals(res.status, 400, `expected 400, got ${res.status}`);
});
