// Pure response shaping for agent-upcoming: no Supabase and no clock, so the
// handler's output contract can be unit-tested.
//
// The class-prep agent (syllabi-agent, syllabi.py `_canvas_id`) reads
// `courses[].canvas_course_id` and accepts only a JSON integer or a string of
// digits. Anything else becomes null there, and a course with a null id gets
// no Canvas readings. So the id is normalised here, once, before it leaves.

export interface CourseRow {
  id: string;
  name: string;
  code: string | null;
  canvas_course_id: unknown;
  schedule: unknown;
  grading_rules: unknown;
  policies: unknown;
}

export interface AgentCourse {
  id: string;
  name: string;
  code: string | null;
  canvas_course_id: number | string | null;
  schedule: unknown;
  grading_rules: unknown;
  policies: unknown;
}

const DIGITS = /^\d+$/;
// …/courses/40577, …/courses/40577/, …/courses/40577/files/123?x=y
const COURSE_IN_URL = /\/courses\/(\d+)(?:[/?#]|$)/;

/**
 * Normalise a stored Canvas course id for the agent. Returns:
 *   - an integer for "40577", 40577 or a Canvas course URL
 *     (https://canvas.mit.edu/courses/40577/…);
 *   - the digit string itself when the id is too large to be a safe JSON
 *     integer (Canvas global ids can be), because the agent accepts digit
 *     strings and rounding would point it at the wrong course;
 *   - null when there is no id in the value.
 */
export function canvasCourseId(raw: unknown): number | string | null {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw !== 'string') return null;

  const s = raw.trim();
  const digits = DIGITS.test(s) ? s : s.match(COURSE_IN_URL)?.[1];
  if (!digits) return null;
  const n = Number(digits);
  if (n <= 0) return null;
  return Number.isSafeInteger(n) ? n : digits.replace(/^0+/, '');
}

/** One `courses[]` entry of the agent-upcoming response. */
export function shapeCourse(c: CourseRow): AgentCourse {
  return {
    id: c.id,
    name: c.name,
    code: c.code,
    canvas_course_id: canvasCourseId(c.canvas_course_id),
    schedule: c.schedule,
    grading_rules: c.grading_rules,
    policies: c.policies,
  };
}
