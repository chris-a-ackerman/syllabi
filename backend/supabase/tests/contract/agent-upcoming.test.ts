// SYL-92: agent-upcoming is reached with a scoped, revocable agent token.
// The contract that matters is isolation and revocation: a token only ever
// reaches its owner's rows, can't be used anywhere else, can't be revoked by
// another user, and stops working the moment its owner revokes it.
import { assert, assertEquals, assertMatch } from '@std/assert';
import { admin, callFn, getFixtures } from './helpers.ts';
import { generateAgentToken, hashAgentToken } from '../../functions/_shared/agent-auth.ts';

const DAY_MS = 86_400_000;

/** |actual − expected| within a minute — the function and the test share a clock. */
function assertAbout(actualIso: string, expectedMs: number, what: string) {
  const diff = Math.abs(Date.parse(actualIso) - expectedMs);
  assert(diff < 60_000, `${what}: ${actualIso} is ${diff}ms from expected`);
}

const courseIds = (json: { courses: Array<{ id: string }> }) => json.courses.map((c) => c.id);

Deno.test('agent-upcoming: rejects a missing token', async () => {
  const res = await callFn('agent-upcoming', { method: 'GET' });
  assertEquals(res.status, 401, `expected 401, got ${res.status}`);
});

Deno.test('agent-upcoming: a well-formed but unknown agent token → 401', async () => {
  const res = await callFn('agent-upcoming', {
    method: 'GET',
    token: 'syl_agent_' + 'A'.repeat(43),
  });
  assertEquals(res.status, 401, `expected 401, got ${res.status}`);
});

Deno.test('agent-upcoming: JWT callers still work and stay isolated', async () => {
  const { userA, userB, courseA, courseB } = await getFixtures();

  const resA = await callFn('agent-upcoming', {
    token: userA.token,
    method: 'GET',
    query: '?days=14',
  });
  assertEquals(resA.status, 200, `expected 200, got ${resA.status}: ${resA.text.slice(0, 200)}`);
  assert(courseIds(resA.json).includes(courseA), 'userA should see courseA');
  assert(!courseIds(resA.json).includes(courseB), 'userA must not see courseB');

  const resB = await callFn('agent-upcoming', {
    token: userB.token,
    method: 'GET',
    query: '?days=14',
  });
  assertEquals(resB.status, 200, `expected 200, got ${resB.status}: ${resB.text.slice(0, 200)}`);
  assert(!resB.text.includes(courseA), "courseA's id leaked into userB's response");
});

Deno.test('agent token lifecycle: create → read own data only → revoke → 401', async (t) => {
  const { userA, userB, courseA, courseB } = await getFixtures();

  // Idempotent on a warm stack: clear userA's tokens so the active-token cap
  // never trips on leftovers from an earlier failed run.
  const { error: wipeError } = await admin.from('agent_tokens').delete().eq('user_id', userA.id);
  if (wipeError) throw new Error(`agent_tokens wipe failed: ${wipeError.message}`);

  let token = '';
  let tokenId = '';

  await t.step(
    'userA mints a token with their JWT; raw token returned once, hash stored',
    async () => {
      const res = await callFn('create-agent-token', {
        token: userA.token,
        body: { label: 'contract' },
      });
      assertEquals(res.status, 201, `expected 201, got ${res.status}: ${res.text.slice(0, 200)}`);
      assertMatch(res.json.token, /^syl_agent_[A-Za-z0-9_-]{43}$/);
      assertEquals(res.json.scopes, ['read:upcoming']);
      assertEquals(res.json.label, 'contract');
      assertAbout(res.json.expires_at, Date.now() + 30 * DAY_MS, 'default expires_at');
      token = res.json.token;
      tokenId = res.json.id;

      const { data } = await admin
        .from('agent_tokens')
        .select('token_hash')
        .eq('id', tokenId)
        .single();
      assert(data && data.token_hash !== token && /^[0-9a-f]{64}$/.test(data.token_hash));
    }
  );

  await t.step("the token reads courseA and never courseB (userB's)", async () => {
    const res = await callFn('agent-upcoming', { token, method: 'GET', query: '?days=14' });
    assertEquals(res.status, 200, `expected 200, got ${res.status}: ${res.text.slice(0, 200)}`);
    assertEquals(typeof res.json.timezone, 'string');
    assert(Array.isArray(res.json.sessions) && Array.isArray(res.json.events));
    assert(courseIds(res.json).includes(courseA), 'agent token should see courseA');
    assert(!courseIds(res.json).includes(courseB), 'agent token must not see courseB');
    assert(!res.text.includes(courseB), "courseB's id leaked into userA's agent response");

    const { data } = await admin
      .from('agent_tokens')
      .select('last_used_at')
      .eq('id', tokenId)
      .single();
    assert(data?.last_used_at, 'last_used_at should be set after a successful call');
  });

  await t.step(
    'the token is useless outside agent-upcoming (no minting, no other functions)',
    async () => {
      const mint = await callFn('create-agent-token', { token, body: {} });
      assertEquals(mint.status, 401, `create-agent-token accepted an agent token (${mint.status})`);
      const revoke = await callFn('revoke-agent-token', { token, body: { id: tokenId } });
      assertEquals(
        revoke.status,
        401,
        `revoke-agent-token accepted an agent token (${revoke.status})`
      );
      const ics = await callFn('generate-ics', { token, method: 'GET', query: '?semester_id=x' });
      assertEquals(ics.status, 401, `generate-ics accepted an agent token (${ics.status})`);
    }
  );

  await t.step("userB's JWT cannot revoke userA's token", async () => {
    const res = await callFn('revoke-agent-token', { token: userB.token, body: { id: tokenId } });
    assertEquals(res.status, 404, `expected 404, got ${res.status}: ${res.text.slice(0, 200)}`);
    const still = await callFn('agent-upcoming', { token, method: 'GET' });
    assertEquals(still.status, 200, 'token stopped working after a foreign revoke attempt');
  });

  await t.step(
    'userA revokes it; the same call is now 401 and a repeat revoke is 404',
    async () => {
      const res = await callFn('revoke-agent-token', { token: userA.token, body: { id: tokenId } });
      assertEquals(res.status, 200, `expected 200, got ${res.status}: ${res.text.slice(0, 200)}`);
      assertEquals(res.json.id, tokenId);

      const after = await callFn('agent-upcoming', { token, method: 'GET' });
      assertEquals(after.status, 401, `revoked token still accepted (${after.status})`);

      const again = await callFn('revoke-agent-token', {
        token: userA.token,
        body: { id: tokenId },
      });
      assertEquals(again.status, 404, `expected 404 on repeat revoke, got ${again.status}`);
    }
  );

  await t.step('revoke-agent-token validates its input', async () => {
    const res = await callFn('revoke-agent-token', {
      token: userA.token,
      body: { id: 'not-a-uuid' },
    });
    assertEquals(res.status, 400, `expected 400, got ${res.status}`);
  });
});

Deno.test('agent token expiry: chosen lifetime, bounds, and expired → 401', async (t) => {
  const { userA, courseA } = await getFixtures();
  const { error: wipeError } = await admin.from('agent_tokens').delete().eq('user_id', userA.id);
  if (wipeError) throw new Error(`agent_tokens wipe failed: ${wipeError.message}`);

  await t.step('expires_in_days sets expires_at', async () => {
    const res = await callFn('create-agent-token', {
      token: userA.token,
      body: { label: 'week', expires_in_days: 7 },
    });
    assertEquals(res.status, 201, `expected 201, got ${res.status}: ${res.text.slice(0, 200)}`);
    assertAbout(res.json.expires_at, Date.now() + 7 * DAY_MS, 'expires_in_days=7');

    const max = await callFn('create-agent-token', {
      token: userA.token,
      body: { expires_in_days: 180 },
    });
    assertEquals(
      max.status,
      201,
      `180 days should be allowed, got ${max.status}: ${max.text.slice(0, 200)}`
    );
  });

  await t.step('out-of-range or fractional expires_in_days → 400', async () => {
    for (const bad of [0, 181, 1.5, '7', -3]) {
      const res = await callFn('create-agent-token', {
        token: userA.token,
        body: { expires_in_days: bad },
      });
      assertEquals(
        res.status,
        400,
        `expires_in_days=${JSON.stringify(bad)} returned ${res.status}`
      );
    }
  });

  await t.step('a token past its expires_at is rejected; a live one still works', async () => {
    // Seed an already-expired token directly (the API won't mint one).
    const expired = generateAgentToken();
    const { error } = await admin.from('agent_tokens').insert({
      user_id: userA.id,
      token_hash: await hashAgentToken(expired),
      label: 'expired',
      created_at: new Date(Date.now() - 2 * DAY_MS).toISOString(),
      expires_at: new Date(Date.now() - DAY_MS).toISOString(),
    });
    if (error) throw new Error(`seeding expired token failed: ${error.message}`);

    const res = await callFn('agent-upcoming', { token: expired, method: 'GET' });
    assertEquals(res.status, 401, `expired token accepted (${res.status})`);

    const live = await callFn('create-agent-token', {
      token: userA.token,
      body: { expires_in_days: 1 },
    });
    assertEquals(live.status, 201);
    const ok = await callFn('agent-upcoming', {
      token: live.json.token,
      method: 'GET',
      query: '?days=14',
    });
    assertEquals(ok.status, 200, `live token rejected (${ok.status})`);
    assert(courseIds(ok.json).includes(courseA));
  });

  await t.step('expired tokens do not count toward the active-token cap', async () => {
    // 3 live tokens exist from the steps above (7d, 180d, 1d) plus 1 expired;
    // 7 more live ones reach the cap of 10 exactly, the next is refused.
    for (let i = 0; i < 7; i++) {
      const res = await callFn('create-agent-token', { token: userA.token, body: {} });
      assertEquals(
        res.status,
        201,
        `token ${i + 4} of 10 refused (${res.status}): ${res.text.slice(0, 200)}`
      );
    }
    const over = await callFn('create-agent-token', { token: userA.token, body: {} });
    assertEquals(over.status, 409, `11th live token not refused (${over.status})`);
  });

  await admin.from('agent_tokens').delete().eq('user_id', userA.id);
});

// The class-prep agent finds readings in Canvas by courses[].canvas_course_id
// and only accepts a JSON integer or a digit string (syllabi.py `_canvas_id`).
// The column is TEXT. The response must carry it as an integer, or as null
// when the course isn't linked.
Deno.test(
  'agent-upcoming: courses[].canvas_course_id is an integer, or null when unlinked',
  async () => {
    const { userA, courseA } = await getFixtures();
    const find = (json: { courses: Array<{ id: string; canvas_course_id: unknown }> }) =>
      json.courses.find((c) => c.id === courseA);

    const setId = async (value: string | null) => {
      const { error } = await admin
        .from('courses')
        .update({ canvas_course_id: value })
        .eq('id', courseA);
      if (error) throw new Error(`setting canvas_course_id failed: ${error.message}`);
    };

    try {
      await setId('38610');
      const linked = await callFn('agent-upcoming', {
        token: userA.token,
        method: 'GET',
        query: '?days=3',
      });
      assertEquals(
        linked.status,
        200,
        `expected 200, got ${linked.status}: ${linked.text.slice(0, 200)}`
      );
      const course = find(linked.json);
      assert(course, 'courseA missing from the response');
      assertEquals(course.canvas_course_id, 38610);
      assertEquals(typeof course.canvas_course_id, 'number');
      assert(linked.text.includes('"canvas_course_id":38610'), 'canvas_course_id went out quoted');

      await setId(null);
      const unlinked = await callFn('agent-upcoming', {
        token: userA.token,
        method: 'GET',
        query: '?days=3',
      });
      assertEquals(unlinked.status, 200);
      const bare = find(unlinked.json);
      assert(
        bare && 'canvas_course_id' in bare,
        'canvas_course_id key missing on an unlinked course'
      );
      assertEquals(bare.canvas_course_id, null);
    } finally {
      await setId(null);
    }
  }
);
