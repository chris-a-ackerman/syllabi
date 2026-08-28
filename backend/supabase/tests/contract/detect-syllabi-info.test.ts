// SYL-27 regression pin: detect-syllabi-info must only read files inside the
// caller's own storage folder.
import { assertEquals, assertStringIncludes } from "@std/assert";
import { callFn, getFixtures } from "./helpers.ts";

Deno.test("rejects file_paths under another user's storage prefix with 400", async () => {
  const { userA, userB } = await getFixtures();
  const res = await callFn("detect-syllabi-info", {
    token: userA.token,
    body: { file_paths: [`${userB.id}/syllabus.pdf`] },
  });
  assertEquals(res.status, 400, `expected 400, got ${res.status}: ${res.text.slice(0, 200)}`);
  assertStringIncludes(res.json?.error ?? "", "own storage folder");
});

Deno.test("rejects path traversal out of the caller's folder with 400", async () => {
  const { userA, userB } = await getFixtures();
  const res = await callFn("detect-syllabi-info", {
    token: userA.token,
    body: { file_paths: [`${userA.id}/../${userB.id}/syllabus.pdf`] },
  });
  assertEquals(res.status, 400, `expected 400, got ${res.status}`);
});

Deno.test("rejects an empty or missing file_paths array with 400", async () => {
  const { userA } = await getFixtures();
  for (const body of [{}, { file_paths: [] }, { file_paths: "not-an-array" }]) {
    const res = await callFn("detect-syllabi-info", { token: userA.token, body });
    assertEquals(res.status, 400, `body ${JSON.stringify(body)} → ${res.status}`);
  }
});
