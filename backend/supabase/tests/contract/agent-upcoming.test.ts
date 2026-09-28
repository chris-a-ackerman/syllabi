// SYL-92: agent-upcoming is reached with a scoped, revocable agent token.
// The contract that matters is isolation and revocation: a token only ever
// reaches its owner's rows, can't be used anywhere else, can't be revoked by
// another user, and stops working the moment its owner revokes it.
import { assert, assertEquals, assertMatch } from '@std/assert';
import { admin, callFn, getFixtures } from './helpers.ts';

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
