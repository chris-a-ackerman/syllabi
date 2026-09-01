// Pure mapping helpers between Claude's syllabus-analysis JSON and DB rows.
// No I/O — unit-tested in tests/unit/.

export { stripJsonFences } from "../_shared/strip-json-fences.ts";

// deno-lint-ignore no-explicit-any
type AnalysisJson = Record<string, any>;

// ── Time normalisation (SYL-60) ──────────────────────────────────────────────
//
// course_events.time is a Postgres TIME column. The prompt mandates 24h
// HH:MM, but the model deviates often enough (SYL-52 made this column
// reachable) that one odd value — "2pm", "noon", "TBD" — used to fail the
// whole bulk insert. Normalise here so bad values degrade to a dropped time
// (null) instead of an aborted insert.
//
// Coercion table (mirrors the closing-comment summary):
//   - non-string / empty / whitespace-only        -> null   (nothing to parse)
//   - 24h H:MM or HH:MM, optional :SS              -> as-is, zero-padded hour
//                                                     (canonical form; this is
//                                                     what the prompt asks for)
//   - h:mm AM/PM, h AM/PM (case-insens, a.m./p.m.) -> 24h HH:MM
//                                                     (the model's most common
//                                                     deviation from the spec)
//   - bare Hpm / Ham                               -> HH:00
//                                                     (same as above, minus
//                                                     the colon)
//   - a range ("14:00-15:00", "2-3pm"; separators   -> START only, normalised
//     -, –, —, "to")                                  by the rules above.
//                                                     Postgres already accepts
//                                                     "14:00-15:00" today by
//                                                     misreading "-15:00" as a
//                                                     zone offset and keeping
//                                                     the start; this makes
//                                                     that explicit. If only
//                                                     the end has a meridiem
//                                                     ("2-3pm"), it's applied
//                                                     to the start.
//   - anything else ("noon", "TBD", "morning",      -> null (dropped, event
//     "14", "25:00", "14:60")                          kept) — deliberately
//                                                     not guessing what
//                                                     "noon" etc. means.
const TIME_24H = /^([01]?\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;
const TIME_AMPM = /^(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\.?$/i;
const RANGE_SPLIT = /^(.+?)\s*(?:-|–|—|\bto\b)\s*(.+)$/i;
const END_MERIDIEM = /([ap])\.?m\.?\s*$/i;

function normalizeSingleTime(value: string): string | null {
  const s = value.trim();
  if (!s) return null;

  const h24 = s.match(TIME_24H);
  if (h24) {
    const hour = h24[1].padStart(2, "0");
    const minute = h24[2];
    const seconds = h24[3] ?? "";
    return `${hour}:${minute}${seconds}`;
  }

  const ampm = s.match(TIME_AMPM);
  if (ampm) {
    const hourNum = parseInt(ampm[1], 10);
    if (hourNum < 1 || hourNum > 12) return null;
    const minute = ampm[2] ?? "00";
    const meridiem = ampm[3].toLowerCase();
    let hour24 = hourNum % 12;
    if (meridiem === "p") hour24 += 12;
    return `${String(hour24).padStart(2, "0")}:${minute}`;
  }

  return null;
}

/** Normalise a raw time value from the model into TIME-column-safe HH:MM(:SS) or null. */
export function normalizeEventTime(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const rangeMatch = trimmed.match(RANGE_SPLIT);
  if (rangeMatch) {
    let start = rangeMatch[1].trim();
    const end = rangeMatch[2].trim();
    if (start && end) {
      const startHasMeridiem = END_MERIDIEM.test(start);
      const endMeridiem = end.match(END_MERIDIEM);
      if (!startHasMeridiem && endMeridiem) {
        start = `${start}${endMeridiem[1]}m`;
      }
      const normalizedStart = normalizeSingleTime(start);
      if (normalizedStart) return normalizedStart;
    }
  }

  return normalizeSingleTime(trimmed);
}

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
    // Both time and time_start are normalised (SYL-60) — an unparseable
    // value degrades to null (event kept, time dropped) instead of failing
    // the bulk insert; legacy `time` still wins when both are valid.
    time: normalizeEventTime(event.time) ?? normalizeEventTime(event.time_start),
    title: event.title || "Untitled Event",
    type: event.type || "other",
    category: event.category || null,
    is_recurring_instance: event.is_recurring_instance || false,
    confidence: ["high", "medium", "low"].includes(event.confidence) ? event.confidence : "medium",
  }));
}
