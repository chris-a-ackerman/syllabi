// SYL-29: the AI cost-control config. Beyond value sanity, the last test is a
// drift tripwire in the config-drift.test.ts spirit: every enforceAiQuota call
// site in the functions must name an endpoint that has a configured limit.
import { assert, assertEquals } from "@std/assert";
import { AI_DAILY_LIMITS, intFromEnv, MAX_SYLLABUS_BYTES } from "../../functions/_shared/ai-limits.ts";

Deno.test("intFromEnv falls back when the variable is unset", () => {
  Deno.env.delete("AI_LIMITS_TEST_SENTINEL");
  assertEquals(intFromEnv("AI_LIMITS_TEST_SENTINEL", 42), 42);
});

Deno.test("intFromEnv reads a valid positive integer override", () => {
  Deno.env.set("AI_LIMITS_TEST_SENTINEL", "7");
  try {
    assertEquals(intFromEnv("AI_LIMITS_TEST_SENTINEL", 42), 7);
  } finally {
    Deno.env.delete("AI_LIMITS_TEST_SENTINEL");
  }
});

Deno.test("intFromEnv ignores junk and non-positive values", () => {
  try {
    Deno.env.set("AI_LIMITS_TEST_SENTINEL", "not-a-number");
    assertEquals(intFromEnv("AI_LIMITS_TEST_SENTINEL", 42), 42);
    Deno.env.set("AI_LIMITS_TEST_SENTINEL", "-5");
    assertEquals(intFromEnv("AI_LIMITS_TEST_SENTINEL", 42), 42);
    Deno.env.set("AI_LIMITS_TEST_SENTINEL", "0");
    assertEquals(intFromEnv("AI_LIMITS_TEST_SENTINEL", 42), 42);
  } finally {
    Deno.env.delete("AI_LIMITS_TEST_SENTINEL");
  }
});

Deno.test("every configured limit is a positive integer", () => {
  for (const [endpoint, limit] of Object.entries(AI_DAILY_LIMITS)) {
    assert(Number.isInteger(limit) && limit > 0, `${endpoint} limit is ${limit}`);
  }
  assert(Number.isInteger(MAX_SYLLABUS_BYTES) && MAX_SYLLABUS_BYTES > 0);
});

Deno.test("every enforceAiQuota call site names a configured endpoint, and vice versa", async () => {
  const FUNCTIONS_DIR = new URL("../../functions/", import.meta.url);
  const usedEndpoints = new Set<string>();
  for (const entry of Deno.readDirSync(FUNCTIONS_DIR)) {
    if (!entry.isDirectory || entry.name === "_shared") continue;
    const source = await Deno.readTextFile(new URL(`${entry.name}/index.ts`, FUNCTIONS_DIR));
    for (const match of source.matchAll(/enforceAiQuota\([^)]*?"([^"]+)"/g)) {
      usedEndpoints.add(match[1]);
    }
  }
  assertEquals(
    [...usedEndpoints].sort(),
    Object.keys(AI_DAILY_LIMITS).sort(),
    "AI_DAILY_LIMITS and the enforceAiQuota call sites have drifted apart",
  );
});
