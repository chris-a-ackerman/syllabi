// Pure mapping helpers between Claude's syllabus-analysis JSON and DB rows.
// No I/O — unit-tested in tests/unit/.

export { stripJsonFences } from "../_shared/strip-json-fences.ts";

// deno-lint-ignore no-explicit-any
type AnalysisJson = Record<string, any>;

/**
 * Course-row updates derived from the analysis, with fallbacks to the existing
 * course row when the analysis omits a field.
 */
export function mapAnalysisToCourseUpdate(
  analysisJson: AnalysisJson,
  course: { name: string | null; code: string | null; professor: string | null },
): { name: string | null; code: string | null; professor: string | null; schedule: AnalysisJson | null } {
  const courseName =
    analysisJson.course?.name ||
    analysisJson.course?.title ||
    analysisJson.course?.course_name ||
    course.name;
  const courseCode =
    analysisJson.course?.code ||
    analysisJson.course?.course_code ||
    course.code;
  const courseProfessor =
    analysisJson.course?.professor ||
    analysisJson.course?.instructor?.name ||
    (Array.isArray(analysisJson.course?.instructors) ? analysisJson.course.instructors[0]?.name : null) ||
    course.professor;

  // Combine schedule metadata + meeting info from the course section into one column.
  const scheduleData = analysisJson.schedule
    ? {
        ...analysisJson.schedule,
        meeting_days: analysisJson.course?.meeting_days ?? null,
        meeting_times: analysisJson.course?.meeting_times ?? null,
        location: analysisJson.course?.location ?? null,
        instructor: analysisJson.course?.instructor ?? null,
      }
    : null;

  return { name: courseName, code: courseCode, professor: courseProfessor, schedule: scheduleData };
}

/**
 * Flatten analysis events into course_events rows. `type` must never be null
 * (NOT NULL + CHECK constraint) — defaults to "other"; confidence outside the
 * allowed set collapses to "medium".
 */
export function mapEventsToRows(
  // deno-lint-ignore no-explicit-any
  events: any[],
  course_id: string,
  user_id: string,
  // deno-lint-ignore no-explicit-any
): Record<string, any>[] {
  return events.map((event) => ({
    course_id,
    user_id,
    date: event.date || null,
    date_unresolved: event.date_unresolved || null,
    // The live prompt emits time_start/time_end (SYL-52); the single `time`
    // column takes the start. time_end has no column and is dropped.
    time: event.time || event.time_start || null,
    title: event.title || "Untitled Event",
    type: event.type || "other",
    category: event.category || null,
    is_recurring_instance: event.is_recurring_instance || false,
    confidence: ["high", "medium", "low"].includes(event.confidence) ? event.confidence : "medium",
  }));
}
