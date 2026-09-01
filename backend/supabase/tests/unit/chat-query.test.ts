import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildCourseContext,
  detectQueryType,
  extractDateRange,
} from "../../functions/chat/query.ts";

// ── detectQueryType ──────────────────────────────────────────────────────────

Deno.test("detectQueryType: clear cases", () => {
  assertEquals(detectQueryType("When is the midterm?"), "date");
  assertEquals(detectQueryType("What's the late submission rule?"), "policy");
  assertEquals(detectQueryType("How much is homework worth?"), "grading");
  assertEquals(detectQueryType("Where does the course meet?"), "schedule");
  assertEquals(detectQueryType("Tell me something interesting"), "general");
});

// SYL-53: grading keywords outrank date keywords, so grading questions that
// mention an exam/quiz/due date fetch the grading context slice.
Deno.test("detectQueryType: grading question mentioning an exam classifies as grading", () => {
  assertEquals(detectQueryType("How much of my grade is the final exam worth?"), "grading");
  assertEquals(detectQueryType("What is quiz 3 worth?"), "grading");
});

// SYL-53: keywords match whole words only — "ai" no longer fires inside
// ordinary words ("email", "available", "again").
Deno.test("detectQueryType: 'ai' matches only as a standalone word", () => {
  assertEquals(detectQueryType("Can you send the professor's contact via mail merge? Also his mailing address"), "general");
  assertEquals(detectQueryType("please check my mail"), "general");
  assertEquals(detectQueryType("Can I use AI on the homework?"), "policy");
});

// ── extractDateRange ─────────────────────────────────────────────────────────

// Fixed clock: Tuesday Sep 1 2026, midday UTC so the local calendar date is
// stable in any CI/dev timezone between UTC-11 and UTC+11.
const TODAY = new Date("2026-09-01T12:00:00Z");

Deno.test("extractDateRange: 'today' collapses to a single-day range", () => {
  assertEquals(extractDateRange("what's due today?", TODAY), {
    start: "2026-09-01",
    end: "2026-09-01",
    isSpecific: true,
  });
});

Deno.test("extractDateRange: 'tomorrow' is a single-day range one day out", () => {
  assertEquals(extractDateRange("anything due tomorrow?", TODAY), {
    start: "2026-09-02",
    end: "2026-09-02",
    isSpecific: true,
  });
});

Deno.test("extractDateRange: 'this week' runs through Sunday", () => {
  assertEquals(extractDateRange("what's happening this week", TODAY), {
    start: "2026-09-01",
    end: "2026-09-06",
    isSpecific: true,
  });
});

Deno.test("extractDateRange: 'next week' is Monday through Sunday of next week", () => {
  assertEquals(extractDateRange("what's due next week", TODAY), {
    start: "2026-09-07",
    end: "2026-09-13",
    isSpecific: true,
  });
});

Deno.test("extractDateRange: multi-word phrases win over 'today' appearing in the same message", () => {
  const range = extractDateRange("What's due next week? Today is September 1st", TODAY);
  assertEquals(range.start, "2026-09-07");
  assertEquals(range.isSpecific, true);
});

Deno.test("extractDateRange: no time keyword falls back to a non-specific 7-day range", () => {
  assertEquals(extractDateRange("when is quiz 4", TODAY), {
    start: "2026-09-01",
    end: "2026-09-08",
    isSpecific: false,
  });
});

// ── buildCourseContext ───────────────────────────────────────────────────────

const COURSE = {
  name: "Intro to Testing",
  code: "CS101",
  professor: "Kim",
  schedule: {
    meeting_days: ["Mon", "Wed"],
    meeting_times: { start: "10:00", end: "11:15" }, // what process-syllabus writes
    location: "Hall 2",
  },
  grading_rules: {
    components: [
      { name: "Exams", weight: 0.4, drop_lowest: 1 },
      { name: "Homework", weight: 0.6 },
    ],
    grading_scale: "A 90+",
  },
  policies: { late_work: "10% per day", other: ["No food in lab"] },
};

Deno.test("buildCourseContext: empty course list", () => {
  assertEquals(buildCourseContext([], [], "general"), "No courses found for this query.");
});

Deno.test("buildCourseContext: renders header, grading, and policies", () => {
  const out = buildCourseContext([COURSE], [], "general");
  assertStringIncludes(out, "### Intro to Testing (CS101) — Prof. Kim");
  assertStringIncludes(out, "(drop lowest 1)");
  assertStringIncludes(out, "Scale: A 90+");
  assertStringIncludes(out, "Late work: 10% per day");
  assertStringIncludes(out, "Other: No food in lab");
});

// SYL-50: the schedule reads meeting_times (what process-syllabus writes).
Deno.test("buildCourseContext: renders the extracted meeting time", () => {
  const out = buildCourseContext([COURSE], [], "general");
  assertStringIncludes(out, "Meets: Mon, Wed 10:00–11:15 at Hall 2");
});

Deno.test("buildCourseContext: null meeting_times start/end render TBD, not an empty dash", () => {
  const course = { ...COURSE, schedule: { ...COURSE.schedule, meeting_times: { start: null, end: null } } };
  const out = buildCourseContext([course], [], "general");
  assertStringIncludes(out, "Meets: Mon, Wed TBD at Hall 2");
});

// SYL-51: 0–1 decimal weights normalize to percents (mirrors src/lib/gradeWeight.ts).
Deno.test("buildCourseContext: decimal weights render as whole percentages", () => {
  const out = buildCourseContext([COURSE], [], "general");
  assertStringIncludes(out, "- Exams: 40%");
  assertStringIncludes(out, "- Homework: 60%");
});

Deno.test("buildCourseContext: already-percent weights pass through unchanged", () => {
  const course = {
    ...COURSE,
    grading_rules: { components: [{ name: "Labs", weight: 15 }] },
  };
  assertStringIncludes(buildCourseContext([course], [], "general"), "- Labs: 15%");
});

Deno.test("buildCourseContext: event section label depends on queryType", () => {
  const event = {
    date: "2026-09-08",
    time: "09:00",
    title: "Quiz 1",
    type: "quiz",
    confidence: "low",
    courses: { code: "CS101" },
  };
  const dateOut = buildCourseContext([COURSE], [event], "date");
  assertStringIncludes(dateOut, "**Events in requested date range:**");
  assertStringIncludes(dateOut, "- 2026-09-08 at 09:00 [CS101]: Quiz 1 (quiz) (date approximate)");

  const otherOut = buildCourseContext([COURSE], [], "grading");
  assertStringIncludes(otherOut, "**Upcoming events (next 30 days):**");
  assertStringIncludes(otherOut, "None found.");
});
