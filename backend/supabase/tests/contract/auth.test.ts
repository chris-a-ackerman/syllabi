// Every function must reject unauthenticated calls. All eleven run with
// verify_jwt = false (so CORS preflights pass the gateway) and enforce auth
// in the handler (paired with tests/unit/config-drift.test.ts).
import { assertEquals } from '@std/assert';
import { callFn } from './helpers.ts';

const POST_FUNCTIONS = [
  'process-syllabus',
  'detect-syllabi-info',
  'chat',
  'admin-get-users',
  'save-canvas-token',
  'delete-canvas-token',
  'find-canvas-courses',
  'find-canvas-syllabus',
  'download-canvas-syllabus',
  'match-canvas-assignments',
  'create-agent-token',
  'revoke-agent-token',
];

// GET functions, with the query string each one needs to get past routing.
const GET_FUNCTIONS: Array<[string, string]> = [
  ['generate-ics', '?semester_id=x'],
  ['agent-upcoming', '?days=3'],
];

Deno.test('all functions: no Authorization header → 401', async (t) => {
  for (const name of POST_FUNCTIONS) {
    await t.step(name, async () => {
      const res = await callFn(name, { body: {} });
      assertEquals(res.status, 401, `${name} returned ${res.status}: ${res.text.slice(0, 200)}`);
    });
  }
  for (const [name, query] of GET_FUNCTIONS) {
    await t.step(name, async () => {
      const res = await callFn(name, { method: 'GET', query });
      assertEquals(res.status, 401, `${name} returned ${res.status}`);
    });
  }
});

// SYL-54 moved save-canvas-token's auth check ahead of body validation and the
// outbound Canvas round-trip, so every function now rejects a garbage bearer
// token with 401 before doing any other work. (chat had the same ordering bug
// until SYL-29.)
Deno.test('all functions: garbage bearer token → 401', async (t) => {
  for (const name of POST_FUNCTIONS) {
    await t.step(name, async () => {
      const res = await callFn(name, { token: 'garbage-token', body: {} });
      assertEquals(res.status, 401, `${name} returned ${res.status}: ${res.text.slice(0, 200)}`);
    });
  }
  for (const [name, query] of GET_FUNCTIONS) {
    await t.step(name, async () => {
      const res = await callFn(name, { token: 'garbage-token', method: 'GET', query });
      assertEquals(res.status, 401, `${name} returned ${res.status}`);
    });
  }
});
