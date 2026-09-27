// SYL-92: agent-upcoming is a read-only, RLS-scoped snapshot. The contract
// that matters is isolation — one user's token never surfaces another user's
// courses, sessions or events.
import { assert, assertEquals } from '@std/assert';
import { callFn, getFixtures } from './helpers.ts';

Deno.test('agent-upcoming: rejects a missing token', async () => {
  const res = await callFn('agent-upcoming', { method: 'GET' });
  assertEquals(res.status, 401, `expected 401, got ${res.status}`);
});

Deno.test("agent-upcoming: userA sees courseA; userB's token never sees courseA", async () => {
  const { userA, userB, courseA, courseB } = await getFixtures();

  const resA = await callFn('agent-upcoming', {
    token: userA.token,
    method: 'GET',
    query: '?days=14',
  });
  assertEquals(resA.status, 200, `expected 200, got ${resA.status}: ${resA.text.slice(0, 200)}`);
  assert(typeof resA.json.timezone === 'string');
  assert(Array.isArray(resA.json.sessions) && Array.isArray(resA.json.events));
  const idsA = resA.json.courses.map((c: { id: string }) => c.id);
  // Other contract files may add rows to the shared fixtures, so assert
  // membership rather than exact lists.
  assert(idsA.includes(courseA), 'userA should see courseA');
  assert(!idsA.includes(courseB), 'userA must not see courseB');

  const resB = await callFn('agent-upcoming', {
    token: userB.token,
    method: 'GET',
    query: '?days=14',
  });
  assertEquals(resB.status, 200, `expected 200, got ${resB.status}: ${resB.text.slice(0, 200)}`);
  const idsB = resB.json.courses.map((c: { id: string }) => c.id);
  assert(idsB.includes(courseB), 'userB should see courseB');
  assert(!idsB.includes(courseA), 'userB must not see courseA');
  assert(!resB.text.includes(courseA), "courseA's id leaked into userB's response");
});
