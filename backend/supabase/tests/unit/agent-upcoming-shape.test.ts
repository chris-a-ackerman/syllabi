import { assertEquals, assertStrictEquals } from '@std/assert';
import {
  canvasCourseId,
  shapeCourse,
  type CourseRow,
} from '../../functions/agent-upcoming/shape.ts';

// The class-prep agent reads courses[].canvas_course_id and only accepts a JSON
// integer or a digit string (syllabi-agent: syllabi.py `_canvas_id`). These
// tests pin the shape agent-upcoming emits.

const row = (canvas_course_id: unknown): CourseRow => ({
  id: 'c1',
  name: 'Innovating for Impact',
  code: '15.385',
  canvas_course_id,
  schedule: { meeting_days: ['Tuesday'], meeting_times: { start: '10:00', end: '11:30' } },
  grading_rules: { components: [] },
  policies: null,
});

// ── canvasCourseId ───────────────────────────────────────────────────────────

Deno.test('canvasCourseId: the stored TEXT digits become a JSON integer', () => {
  assertStrictEquals(canvasCourseId('38610'), 38610);
  assertStrictEquals(canvasCourseId(' 40577 '), 40577);
});

Deno.test('canvasCourseId: an integer passes through', () => {
  assertStrictEquals(canvasCourseId(38529), 38529);
});

Deno.test('canvasCourseId: a Canvas course URL is parsed to its numeric id', () => {
  for (const url of [
    'https://canvas.mit.edu/courses/38612',
    'https://canvas.mit.edu/courses/38612/',
    'https://canvas.mit.edu/courses/38612/assignments/991',
    'https://canvas.mit.edu/courses/38612/files/12345?wrap=1',
    'https://canvas.mit.edu/courses/38612#modules',
  ]) {
    assertStrictEquals(canvasCourseId(url), 38612, url);
  }
});

Deno.test('canvasCourseId: no id → null', () => {
  for (const raw of [
    null,
    undefined,
    '',
    '   ',
    'abc',
    '0',
    0,
    -5,
    1.5,
    NaN,
    'https://canvas.mit.edu/courses/',
    'https://canvas.mit.edu/courses/abc',
    'https://canvas.mit.edu/courses/123abc',
    { id: 38610 },
    ['38610'],
  ]) {
    assertStrictEquals(canvasCourseId(raw), null, JSON.stringify(raw) ?? String(raw));
  }
});

Deno.test('canvasCourseId: an id past 2^53 stays a digit string, never rounded', () => {
  // Canvas global ids (shard × 10^13 + local id) can exceed a safe JSON integer.
  assertStrictEquals(canvasCourseId('10720000000040577'), '10720000000040577');
});

// ── shapeCourse ──────────────────────────────────────────────────────────────

Deno.test('shapeCourse: canvas_course_id is present and integer-typed', () => {
  const course = shapeCourse(row('38610'));
  assertEquals(Object.hasOwn(course, 'canvas_course_id'), true);
  assertStrictEquals(course.canvas_course_id, 38610);
  assertEquals(typeof course.canvas_course_id, 'number');
  // What actually goes over the wire: an unquoted number.
  assertEquals(JSON.stringify(course).includes('"canvas_course_id":38610'), true);
});

Deno.test('shapeCourse: a URL-shaped value is parsed, not dropped', () => {
  assertStrictEquals(
    shapeCourse(row('https://canvas.mit.edu/courses/38529/modules')).canvas_course_id,
    38529
  );
});

Deno.test('shapeCourse: an unlinked course still carries the key, as null', () => {
  const course = shapeCourse(row(null));
  assertEquals(Object.hasOwn(course, 'canvas_course_id'), true);
  assertStrictEquals(course.canvas_course_id, null);
  assertEquals(JSON.stringify(course).includes('"canvas_course_id":null'), true);
});

Deno.test('shapeCourse: keeps the rest of the course contract unchanged', () => {
  const input = row('38610');
  assertEquals(shapeCourse(input), {
    id: input.id,
    name: input.name,
    code: input.code,
    canvas_course_id: 38610,
    schedule: input.schedule,
    grading_rules: input.grading_rules,
    policies: input.policies,
  });
  assertEquals(Object.keys(shapeCourse(input)), [
    'id',
    'name',
    'code',
    'canvas_course_id',
    'schedule',
    'grading_rules',
    'policies',
  ]);
});
