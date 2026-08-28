import { assertEquals } from "@std/assert";
import { callFn, getFixtures } from "./helpers.ts";

Deno.test("rejects a valid non-admin JWT with 403", async () => {
  const { userA } = await getFixtures();
  const res = await callFn("admin-get-users", { token: userA.token, body: {} });
  assertEquals(res.status, 403, `expected 403, got ${res.status}: ${res.text.slice(0, 200)}`);
});
