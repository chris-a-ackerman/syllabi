// SYL-26 regression pin: process-syllabus must not act on a course the caller
// does not own (the course lookup is scoped by user_id → 404).
import { assertEquals } from "@std/assert";
import { admin, callFn, getFixtures } from "./helpers.ts";

Deno.test("rejects another user's course_id with 404 and leaves the course untouched", async () => {
  const { userA, courseB } = await getFixtures();

  const res = await callFn("process-syllabus", {
    token: userA.token,
    body: { course_id: courseB },
  });
  assertEquals(res.status, 404, `expected 404, got ${res.status}: ${res.text.slice(0, 200)}`);

  const { data: course } = await admin
    .from("courses")
    .select("analysis_status")
    .eq("id", courseB)
    .single();
  assertEquals(course?.analysis_status, "pending", "course B must not be mutated");
});

Deno.test("rejects a missing course_id with a 4xx", async () => {
  const { userA } = await getFixtures();
  const res = await callFn("process-syllabus", { token: userA.token, body: {} });
  assertEquals(res.status >= 400 && res.status < 500, true, `got ${res.status}`);
});
