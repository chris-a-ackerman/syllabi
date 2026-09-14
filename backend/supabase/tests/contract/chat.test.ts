import { assertEquals } from '@std/assert';
import { admin, callFn, getFixtures } from './helpers.ts';

const GARBAGE_KEY = 'sk-ant-not-a-real-key-00000000000000000000';
const ENC_KEY = 'contract_test_enc_key';
const todayUTC = () => new Date().toISOString().slice(0, 10);

Deno.test('rejects a missing message/semester_id with 400', async () => {
  const { userA } = await getFixtures();
  const res = await callFn('chat', { token: userA.token, body: {} });
  assertEquals(res.status, 400, `expected 400, got ${res.status}: ${res.text.slice(0, 200)}`);
});

// SYL-72: a BYOK request bypasses the per-user quota entirely (decision:
// BYOK bypasses all daily caps). Rather than mocking Anthropic, this seeds
// the user's key with a garbage value: since the real API always rejects it,
// getting back claude_key_rejected (never 429) proves both that the key was
// actually sent to Anthropic and that the quota gate was skipped for it.
Deno.test(
  'chat: a BYOK request bypasses the per-user quota (real key-rejection round trip)',
  async () => {
    const { userA, semesterA } = await getFixtures();
    const day = todayUTC();

    const { error: storeError } = await admin.rpc('store_anthropic_key', {
      p_user_id: userA.id,
      p_key: GARBAGE_KEY,
      p_enc_key: ENC_KEY,
    });
    assertEquals(storeError, null, `store_anthropic_key seed failed: ${storeError?.message}`);

    const { error: seedError } = await admin
      .from('ai_usage')
      .upsert(
        { user_id: userA.id, day, endpoint: 'chat', count: 100000 },
        { onConflict: 'user_id,day,endpoint' }
      );
    assertEquals(seedError, null, `ai_usage seed failed: ${seedError?.message}`);

    try {
      const res = await callFn('chat', {
        token: userA.token,
        body: { message: 'When is my midterm?', semester_id: semesterA },
      });
      assertEquals(
        res.status,
        402,
        `expected 402 (claude_key_rejected), got ${res.status}: ${res.text.slice(0, 200)}`
      );
      assertEquals(res.json?.error, 'claude_key_rejected');
      assertEquals(
        res.text.includes(GARBAGE_KEY),
        false,
        'response body must never contain the key'
      );

      const { data: usage } = await admin
        .from('ai_usage')
        .select('count')
        .eq('user_id', userA.id)
        .eq('endpoint', 'chat')
        .eq('day', day)
        .single();
      assertEquals(
        usage?.count,
        100000,
        'a BYOK request must not touch the per-user quota counter'
      );

      const { data: byokUsage } = await admin
        .from('ai_usage_byok')
        .select('count')
        .eq('user_id', userA.id)
        .eq('endpoint', 'chat')
        .eq('day', day)
        .single();
      assertEquals(
        byokUsage?.count,
        1,
        'a BYOK request should still be recorded for observability'
      );
    } finally {
      await admin.rpc('delete_anthropic_key', { p_user_id: userA.id });
      await admin.from('ai_usage').delete().eq('user_id', userA.id).eq('endpoint', 'chat');
      await admin.from('ai_usage_byok').delete().eq('user_id', userA.id).eq('endpoint', 'chat');
    }
  }
);

Deno.test('returns 503 when the global AI kill switch is off, before any user work', async () => {
  const { userA, semesterA } = await getFixtures();

  const { error } = await admin
    .from('app_settings')
    .update({ ai_enabled: false })
    .eq('id', 'global');
  assertEquals(error, null);
  try {
    const res = await callFn('chat', {
      token: userA.token,
      body: { message: 'hello', semester_id: semesterA },
    });
    assertEquals(res.status, 503, `expected 503, got ${res.status}: ${res.text.slice(0, 200)}`);
  } finally {
    await admin.from('app_settings').update({ ai_enabled: true }).eq('id', 'global');
  }
});
