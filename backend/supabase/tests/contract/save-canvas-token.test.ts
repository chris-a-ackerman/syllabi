// save-canvas-token input validation. Note (SSRF follow-up, see Linear):
// only the https:// prefix is validated today — assertSafeCanvasUrl is not
// applied to canvas_base_url. This suite pins the current accepted/rejected
// set so a future hardening PR updates it consciously.
import { assertEquals, assertStringIncludes } from "@std/assert";
import { callFn, getFixtures } from "./helpers.ts";

Deno.test("rejects a non-https canvas_base_url with 400", async () => {
  const { userA } = await getFixtures();
  const res = await callFn("save-canvas-token", {
    token: userA.token,
    body: { canvas_token: "fake-token", canvas_base_url: "http://canvas.school.edu" },
  });
  assertEquals(res.status, 400, `expected 400, got ${res.status}: ${res.text.slice(0, 200)}`);
  assertStringIncludes(res.json?.error ?? "", "https://");
});

Deno.test("rejects missing fields with 400", async () => {
  const { userA } = await getFixtures();
  for (const body of [{}, { canvas_token: "x" }, { canvas_base_url: "https://canvas.school.edu" }]) {
    const res = await callFn("save-canvas-token", { token: userA.token, body });
    assertEquals(res.status, 400, `body ${JSON.stringify(body)} → ${res.status}`);
  }
});
