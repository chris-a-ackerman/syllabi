// Every function must reject unauthenticated calls. For generate-ics and
// admin-get-users the platform enforces this (verify_jwt = true); the other
// nine enforce it in the handler (paired with tests/unit/config-drift.test.ts).
import { assertEquals } from "@std/assert";
import { callFn } from "./helpers.ts";

const POST_FUNCTIONS = [
  "process-syllabus",
  "detect-syllabi-info",
  "chat",
  "admin-get-users",
  "save-canvas-token",
  "delete-canvas-token",
  "find-canvas-courses",
  "find-canvas-syllabus",
  "download-canvas-syllabus",
  "match-canvas-assignments",
];

Deno.test("all functions: no Authorization header → 401", async (t) => {
  for (const name of POST_FUNCTIONS) {
    await t.step(name, async () => {
      const res = await callFn(name, { body: {} });
      assertEquals(res.status, 401, `${name} returned ${res.status}: ${res.text.slice(0, 200)}`);
    });
  }
  await t.step("generate-ics", async () => {
    const res = await callFn("generate-ics", { method: "GET", query: "?semester_id=x" });
    assertEquals(res.status, 401, `generate-ics returned ${res.status}`);
  });
});

// BUG (characterization): chat and save-canvas-token validate the request BODY
// before verifying the bearer token, so a garbage token with an invalid body
// returns 400, not 401. For chat this is exactly SYL-29 ("reject invalid JWTs
// before calling Claude"); for save-canvas-token the ordering gap goes further —
// a garbage token with a valid body reaches the outbound Canvas round-trip
// pre-auth (see the SSRF/ordering Linear issue). Update these expectations to
// 401 when those fixes land; don't "fix" the test alone.
const BODY_VALIDATED_FIRST = new Set(["chat", "save-canvas-token"]);

Deno.test("all functions: garbage bearer token → 401 (or pinned 400 where body validation runs first)", async (t) => {
  for (const name of POST_FUNCTIONS) {
    await t.step(name, async () => {
      const res = await callFn(name, { token: "garbage-token", body: {} });
      const expected = BODY_VALIDATED_FIRST.has(name) ? 400 : 401;
      assertEquals(res.status, expected, `${name} returned ${res.status}: ${res.text.slice(0, 200)}`);
    });
  }
  await t.step("generate-ics", async () => {
    const res = await callFn("generate-ics", {
      token: "garbage-token",
      method: "GET",
      query: "?semester_id=x",
    });
    assertEquals(res.status, 401, `generate-ics returned ${res.status}`);
  });
});
