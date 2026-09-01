// save-canvas-token input validation. Since SYL-54 the handler verifies the
// caller's JWT first, then runs canvas_base_url through assertSafeCanvasUrl
// (SYL-28's SSRF guard) before any outbound request is made.
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

Deno.test("rejects canvas_base_url in blocked address ranges with 400 (SSRF, SYL-54)", async () => {
  const { userA } = await getFixtures();
  const blocked = [
    "https://169.254.169.254", // cloud metadata
    "https://127.0.0.1",
    "https://10.0.0.5",
    "https://kong", // single-label internal service name
  ];
  for (const canvas_base_url of blocked) {
    const res = await callFn("save-canvas-token", {
      token: userA.token,
      body: { canvas_token: "fake-token", canvas_base_url },
    });
    assertEquals(res.status, 400, `${canvas_base_url} → ${res.status}: ${res.text.slice(0, 200)}`);
  }
});
