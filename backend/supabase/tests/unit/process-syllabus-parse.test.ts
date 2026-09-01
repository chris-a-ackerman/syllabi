import { assertEquals } from "@std/assert";
import {
  mapAnalysisToCourseUpdate,
  mapEventsToRows,
} from "../../functions/process-syllabus/parse.ts";

const EXISTING_COURSE = { name: "Old Name", code: "OLD1", professor: "Old Prof" };

// ── mapAnalysisToCourseUpdate ────────────────────────────────────────────────

Deno.test("course fields fall back through the analysis field-name variants", () => {
  assertEquals(
    mapAnalysisToCourseUpdate({ course: { title: "From Title", course_code: "NEW1" } }, EXISTING_COURSE),
    { name: "From Title", code: "NEW1", professor: "Old Prof", schedule: null },
  );
  assertEquals(
    mapAnalysisToCourseUpdate({ course: { course_name: "From CourseName" } }, EXISTING_COURSE).name,
    "From CourseName",
  );
});

Deno.test("professor falls back to instructor.name, then instructors[0].name, then existing", () => {
  assertEquals(
    mapAnalysisToCourseUpdate({ course: { instructor: { name: "Dr. A" } } }, EXISTING_COURSE).professor,
    "Dr. A",
  );
  assertEquals(
    mapAnalysisToCourseUpdate({ course: { instructors: [{ name: "Dr. B" }] } }, EXISTING_COURSE).professor,
    "Dr. B",
  );
  assertEquals(mapAnalysisToCourseUpdate({}, EXISTING_COURSE).professor, "Old Prof");
});

Deno.test("keeps existing fields when the analysis is empty", () => {
  assertEquals(mapAnalysisToCourseUpdate({}, EXISTING_COURSE), {
    name: "Old Name",
    code: "OLD1",
    professor: "Old Prof",
    schedule: null,
  });
});

Deno.test("schedule merges course-section meeting info into the schedule blob", () => {
  const result = mapAnalysisToCourseUpdate(
    {
      schedule: { total_weeks: 15 },
      course: {
        meeting_days: ["Mon"],
        meeting_times: { start: "10:00", end: "11:15" },
        location: "Hall 2",
        instructor: { name: "Dr. A" },
      },
    },
    EXISTING_COURSE,
  );
  assertEquals(result.schedule, {
    total_weeks: 15,
    meeting_days: ["Mon"],
    meeting_times: { start: "10:00", end: "11:15" },
    location: "Hall 2",
    instructor: { name: "Dr. A" },
  });
});

Deno.test("no schedule key in the analysis → schedule is null (course meeting info dropped)", () => {
  const result = mapAnalysisToCourseUpdate(
    { course: { meeting_days: ["Mon"] } },
    EXISTING_COURSE,
  );
  assertEquals(result.schedule, null);
});

// ── mapEventsToRows ──────────────────────────────────────────────────────────

Deno.test("defaults type to 'other' and title to 'Untitled Event' (NOT NULL contract)", () => {
  const [row] = mapEventsToRows([{ date: "2026-09-08" }], "c1", "u1");
  assertEquals(row.type, "other");
  assertEquals(row.title, "Untitled Event");
  assertEquals(row.course_id, "c1");
  assertEquals(row.user_id, "u1");
});

Deno.test("confidence outside {high,medium,low} collapses to medium", () => {
  assertEquals(mapEventsToRows([{ confidence: "high" }], "c", "u")[0].confidence, "high");
  assertEquals(mapEventsToRows([{ confidence: "certain" }], "c", "u")[0].confidence, "medium");
  assertEquals(mapEventsToRows([{}], "c", "u")[0].confidence, "medium");
});

Deno.test("passes through date, category, is_recurring_instance with null/false defaults", () => {
  const [row] = mapEventsToRows(
    [{ date: "2026-09-08", category: "Exams", is_recurring_instance: true, type: "exam", title: "Midterm" }],
    "c1",
    "u1",
  );
  assertEquals(row.date, "2026-09-08");
  assertEquals(row.category, "Exams");
  assertEquals(row.is_recurring_instance, true);

  const [bare] = mapEventsToRows([{ title: "X", type: "other" }], "c1", "u1");
  assertEquals(bare.date, null);
  assertEquals(bare.category, null);
  assertEquals(bare.is_recurring_instance, false);
});

// SYL-52: the prompt emits time_start/time_end; `time` takes time_start.
// time_end has no course_events column and is dropped. date_unresolved is
// never emitted by the live prompt (it requires resolved dates), so that
// column staying null is by design.
Deno.test("time_start from the prompt maps to time; time_end is dropped", () => {
  const [row] = mapEventsToRows(
    [{ title: "Quiz", type: "quiz", date: "2026-09-08", time_start: "09:00", time_end: "09:50" }],
    "c1",
    "u1",
  );
  assertEquals(row.time, "09:00");
  assertEquals(row.time_end, undefined);
  assertEquals(row.date_unresolved, null);
});

Deno.test("a legacy event.time field still wins over time_start", () => {
  const [row] = mapEventsToRows(
    [{ title: "Quiz", type: "quiz", time: "10:00", time_start: "09:00" }],
    "c1",
    "u1",
  );
  assertEquals(row.time, "10:00");
});

Deno.test("no time fields at all → time is null", () => {
  const [row] = mapEventsToRows([{ title: "Essay", type: "deadline" }], "c1", "u1");
  assertEquals(row.time, null);
});
