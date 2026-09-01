// SYL-29: per-user daily quotas and file-size caps on the AI endpoints.
//
// The 429 paths are exercised by seeding ai_usage at the endpoint's limit via
// the service role, so no request here ever reaches Anthropic (the serve env
// only has a dummy key anyway). Limits are imported from the same module the
// functions read, so the seeds always match what the handlers enforce.
import { assert, assertEquals } from "@std/assert";
import { AI_DAILY_LIMITS } from "../../functions/_shared/ai-limits.ts";
import { admin, callFn, getFixtures } from "./helpers.ts";

// Must stay in sync with MAX_SYLLABUS_BYTES=1024 in tests/contract/.env.contract
// (the serve process reads that env; this test process does not).
const SERVE_MAX_SYLLABUS_BYTES = 1024;

const todayUTC = () => new Date().toISOString().slice(0, 10);

async function seedUsageAtLimit(userId: string, endpoint: string) {
  const limit = AI_DAILY_LIMITS[endpoint];
  assert(limit > 0, `no daily limit configured for ${endpoint}`);
  const { error } = await admin
    .from("ai_usage")
    .upsert(
      { user_id: userId, day: todayUTC(), endpoint, count: limit },
      { onConflict: "user_id,day,endpoint" },
    );
  assertEquals(error, null, `ai_usage seed failed: ${error?.message}`);
}

async function clearUsage(userId: string) {
  const { error } = await admin.from("ai_usage").delete().eq("user_id", userId);
  assertEquals(error, null, `ai_usage cleanup failed: ${error?.message}`);
}

Deno.test("chat: 429 once the daily limit is spent", async () => {
  const { userA, semesterA } = await getFixtures();
  await seedUsageAtLimit(userA.id, "chat");
  try {
    const res = await callFn("chat", {
      token: userA.token,
      body: { message: "When is my midterm?", semester_id: semesterA },
    });
    assertEquals(res.status, 429, `expected 429, got ${res.status}: ${res.text.slice(0, 200)}`);
  } finally {
    await clearUsage(userA.id);
  }
});

Deno.test("chat: a request under the limit passes the quota gate and is counted", async () => {
  const { userA, semesterA } = await getFixtures();
  await clearUsage(userA.id);
  try {
    const res = await callFn("chat", {
      token: userA.token,
      body: { message: "When is my midterm?", semester_id: semesterA },
    });
    // The serve env has a dummy Anthropic key, so the request passes every
    // gate and then dies at the model call — anything but 401/429 shows the
    // quota did not block legitimate usage.
    assert(res.status !== 429 && res.status !== 401, `gated unexpectedly: ${res.status}`);

    const { data: usage } = await admin
      .from("ai_usage")
      .select("count")
      .eq("user_id", userA.id)
      .eq("endpoint", "chat")
      .eq("day", todayUTC())
      .single();
    assertEquals(usage?.count, 1, "the request was not counted against the quota");
  } finally {
    await clearUsage(userA.id);
  }
});

Deno.test("process-syllabus: 429 once the daily limit is spent", async () => {
  const { userA, courseA } = await getFixtures();
  await seedUsageAtLimit(userA.id, "process-syllabus");
  try {
    const res = await callFn("process-syllabus", {
      token: userA.token,
      body: { course_id: courseA },
    });
    assertEquals(res.status, 429, `expected 429, got ${res.status}: ${res.text.slice(0, 200)}`);
  } finally {
    await clearUsage(userA.id);
  }
});

Deno.test("detect-syllabi-info: 429 once the daily limit is spent", async () => {
  const { userA } = await getFixtures();
  await seedUsageAtLimit(userA.id, "detect-syllabi-info");
  try {
    const res = await callFn("detect-syllabi-info", {
      token: userA.token,
      body: { file_paths: [`${userA.id}/anything.pdf`] },
    });
    assertEquals(res.status, 429, `expected 429, got ${res.status}: ${res.text.slice(0, 200)}`);
  } finally {
    await clearUsage(userA.id);
  }
});

Deno.test("process-syllabus: oversized file is rejected with 413 before the model call", async () => {
  const { userA, courseA } = await getFixtures();
  const path = `${userA.id}/contract-oversize.pdf`;
  const oversized = new Blob([new Uint8Array(SERVE_MAX_SYLLABUS_BYTES * 2)], {
    type: "application/pdf",
  });

  const { error: uploadError } = await admin.storage
    .from("syllabi")
    .upload(path, oversized, { upsert: true, contentType: "application/pdf" });
  assertEquals(uploadError, null, `storage seed failed: ${uploadError?.message}`);
  const { error: courseError } = await admin
    .from("courses")
    .update({ syllabus_file_path: path, syllabus_file_name: "contract-oversize.pdf" })
    .eq("id", courseA);
  assertEquals(courseError, null);

  try {
    const res = await callFn("process-syllabus", {
      token: userA.token,
      body: { course_id: courseA },
    });
    assertEquals(res.status, 413, `expected 413, got ${res.status}: ${res.text.slice(0, 200)}`);

    const { data: course } = await admin
      .from("courses")
      .select("analysis_status")
      .eq("id", courseA)
      .single();
    assertEquals(course?.analysis_status, "failed");
  } finally {
    await admin
      .from("courses")
      .update({ syllabus_file_path: null, syllabus_file_name: null, analysis_status: "pending" })
      .eq("id", courseA);
    await admin.storage.from("syllabi").remove([path]);
    await clearUsage(userA.id);
  }
});

Deno.test("detect-syllabi-info: oversized file comes back as a per-file error, not a model call", async () => {
  const { userA } = await getFixtures();
  const path = `${userA.id}/contract-oversize-detect.pdf`;
  const oversized = new Blob([new Uint8Array(SERVE_MAX_SYLLABUS_BYTES * 2)], {
    type: "application/pdf",
  });
  const { error: uploadError } = await admin.storage
    .from("syllabi")
    .upload(path, oversized, { upsert: true, contentType: "application/pdf" });
  assertEquals(uploadError, null, `storage seed failed: ${uploadError?.message}`);

  try {
    const res = await callFn("detect-syllabi-info", {
      token: userA.token,
      body: { file_paths: [path] },
    });
    assertEquals(res.status, 200, `expected 200, got ${res.status}: ${res.text.slice(0, 200)}`);
    assertEquals(res.json?.results?.length, 1);
    assert(
      typeof res.json?.results?.[0]?.error === "string",
      `expected a per-file error, got: ${JSON.stringify(res.json?.results?.[0])}`,
    );
  } finally {
    await admin.storage.from("syllabi").remove([path]);
    await clearUsage(userA.id);
  }
});
