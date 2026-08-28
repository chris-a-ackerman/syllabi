import { assertEquals } from "@std/assert";
import { admin, callFn, getFixtures } from "./helpers.ts";

Deno.test("rejects a missing message/semester_id with 400", async () => {
  const { userA } = await getFixtures();
  const res = await callFn("chat", { token: userA.token, body: {} });
  assertEquals(res.status, 400, `expected 400, got ${res.status}: ${res.text.slice(0, 200)}`);
});

Deno.test("returns 503 when the global AI kill switch is off, before any user work", async () => {
  const { userA, semesterA } = await getFixtures();

  const { error } = await admin.from("app_settings").update({ ai_enabled: false }).eq("id", "global");
  assertEquals(error, null);
  try {
    const res = await callFn("chat", {
      token: userA.token,
      body: { message: "hello", semester_id: semesterA },
    });
    assertEquals(res.status, 503, `expected 503, got ${res.status}: ${res.text.slice(0, 200)}`);
  } finally {
    await admin.from("app_settings").update({ ai_enabled: true }).eq("id", "global");
  }
});
