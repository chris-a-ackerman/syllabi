// SYL-72: save/test/delete-anthropic-key + test-canvas-token.
//
// The Anthropic reject-path tests call the real https://api.anthropic.com
// with a garbage key rather than mocking it — a bad key deterministically
// 401s, and the existing quota contract tests (tests/contract/quota.test.ts)
// already rely on the serve env's dummy key reaching the real API. There is
// no equivalent live-network test for a *valid* key/token here (contract
// tests only have a dummy Anthropic key and no live Canvas instance) — see
// the PR description's "Found, not fixed" section; validateAnthropicKey's
// decision logic (200 → ok, 401 → not ok) is covered by
// tests/unit/anthropic-client.test.ts instead, and save-canvas-token.test.ts
// has the same gap for its own valid-token path.
import { assert, assertEquals } from "@std/assert";
import { AI_DAILY_LIMITS } from "../../functions/_shared/ai-limits.ts";
import { admin, callFn, getFixtures, userClient } from "./helpers.ts";

const GARBAGE_KEY = "sk-ant-not-a-real-key-00000000000000000000";
const ENC_KEY = "contract_test_enc_key";

async function clearAnthropicKey(userId: string) {
  await admin.rpc("delete_anthropic_key", { p_user_id: userId });
}

async function clearManageApiKeysUsage(userId: string) {
  await admin.from("ai_usage").delete().eq("user_id", userId).eq("endpoint", "manage-api-keys");
}

async function seedManageApiKeysUsageAtLimit(userId: string) {
  const limit = AI_DAILY_LIMITS["manage-api-keys"];
  assert(limit > 0, "no daily limit configured for manage-api-keys");
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await admin
    .from("ai_usage")
    .upsert(
      { user_id: userId, day: today, endpoint: "manage-api-keys", count: limit },
      { onConflict: "user_id,day,endpoint" },
    );
  assertEquals(error, null, `ai_usage seed failed: ${error?.message}`);
}

async function hasAnthropicKey(token: string): Promise<boolean> {
  const { data, error } = await userClient(token)
    .from("profiles_safe")
    .select("has_anthropic_key")
    .single();
  assertEquals(error, null, `profiles_safe read failed: ${error?.message}`);
  return data?.has_anthropic_key ?? false;
}

Deno.test("save-anthropic-key: rejects an unauthenticated request with 401", async () => {
  const res = await callFn("save-anthropic-key", { body: { key: GARBAGE_KEY } });
  assertEquals(res.status, 401);
});

Deno.test("save-anthropic-key: rejects a missing key with 400", async () => {
  const { userA } = await getFixtures();
  const res = await callFn("save-anthropic-key", { token: userA.token, body: {} });
  assertEquals(res.status, 400);
});

Deno.test("save-anthropic-key: an Anthropic-rejected key gets 400, stores nothing, and never echoes the key", async () => {
  const { userA } = await getFixtures();
  try {
    const res = await callFn("save-anthropic-key", { token: userA.token, body: { key: GARBAGE_KEY } });
    assertEquals(res.status, 400, `expected 400, got ${res.status}: ${res.text.slice(0, 200)}`);
    assertEquals(res.text.includes(GARBAGE_KEY), false, "response body must never contain the key");
    assertEquals(await hasAnthropicKey(userA.token), false);
  } finally {
    await clearAnthropicKey(userA.id);
  }
});

Deno.test("test-anthropic-key: 404 when no key is stored", async () => {
  const { userA } = await getFixtures();
  await clearAnthropicKey(userA.id);
  const res = await callFn("test-anthropic-key", { token: userA.token, body: {} });
  assertEquals(res.status, 404);
});

Deno.test("test-anthropic-key: a stored key the real API rejects flips last_test_ok false, never echoes the key", async () => {
  const { userA } = await getFixtures();
  const { error: storeError } = await admin.rpc("store_anthropic_key", {
    p_user_id: userA.id,
    p_key: GARBAGE_KEY,
    p_enc_key: ENC_KEY,
  });
  assertEquals(storeError, null, `store_anthropic_key seed failed: ${storeError?.message}`);

  try {
    const res = await callFn("test-anthropic-key", { token: userA.token, body: {} });
    assertEquals(res.status, 200, `expected 200, got ${res.status}: ${res.text.slice(0, 200)}`);
    assertEquals(res.json?.ok, false);
    assertEquals(res.text.includes(GARBAGE_KEY), false, "response body must never contain the key");

    const { data, error } = await userClient(userA.token)
      .from("profiles_safe")
      .select("anthropic_key_last_test_ok")
      .single();
    assertEquals(error, null);
    assertEquals(data?.anthropic_key_last_test_ok, false);
  } finally {
    await clearAnthropicKey(userA.id);
  }
});

Deno.test("delete-anthropic-key: removes a stored key", async () => {
  const { userA } = await getFixtures();
  const { error: storeError } = await admin.rpc("store_anthropic_key", {
    p_user_id: userA.id,
    p_key: GARBAGE_KEY,
    p_enc_key: ENC_KEY,
  });
  assertEquals(storeError, null);
  assertEquals(await hasAnthropicKey(userA.token), true);

  const res = await callFn("delete-anthropic-key", { token: userA.token, body: {} });
  assertEquals(res.status, 200, `expected 200, got ${res.status}: ${res.text.slice(0, 200)}`);
  assertEquals(res.json?.ok, true);
  assertEquals(await hasAnthropicKey(userA.token), false);
});

Deno.test("test-canvas-token: 404 when Canvas is not connected", async () => {
  const { userA } = await getFixtures();
  await admin.rpc("delete_canvas_token", { p_user_id: userA.id });
  const res = await callFn("test-canvas-token", { token: userA.token, body: {} });
  assertEquals(res.status, 404);
});

Deno.test("manage-api-keys: 429 once the shared daily limit is spent (test-anthropic-key)", async () => {
  const { userA } = await getFixtures();
  await seedManageApiKeysUsageAtLimit(userA.id);
  try {
    const res = await callFn("test-anthropic-key", { token: userA.token, body: {} });
    assertEquals(res.status, 429, `expected 429, got ${res.status}: ${res.text.slice(0, 200)}`);
  } finally {
    await clearManageApiKeysUsage(userA.id);
  }
});

Deno.test("manage-api-keys: 429 once the shared daily limit is spent (save-anthropic-key)", async () => {
  const { userA } = await getFixtures();
  await seedManageApiKeysUsageAtLimit(userA.id);
  try {
    const res = await callFn("save-anthropic-key", { token: userA.token, body: { key: GARBAGE_KEY } });
    assertEquals(res.status, 429, `expected 429, got ${res.status}: ${res.text.slice(0, 200)}`);
    assertEquals(await hasAnthropicKey(userA.token), false, "a rate-limited save must store nothing");
  } finally {
    await clearManageApiKeysUsage(userA.id);
    await clearAnthropicKey(userA.id);
  }
});

Deno.test("delete-anthropic-key: not rate-limited (no outbound call)", async () => {
  const { userA } = await getFixtures();
  await seedManageApiKeysUsageAtLimit(userA.id);
  try {
    const res = await callFn("delete-anthropic-key", { token: userA.token, body: {} });
    assertEquals(res.status, 200, `expected 200, got ${res.status}: ${res.text.slice(0, 200)}`);
  } finally {
    await clearManageApiKeysUsage(userA.id);
  }
});
