// SYL-72: resolveAnthropicClient picks the caller's own key over the
// project's, and isAnthropicAuthError classifies a rejected key correctly.
import { assert, assertEquals } from '@std/assert';
import {
  claudeKeyRejectedResponse,
  isAnthropicAuthError,
  resolveAnthropicClient,
  validateAnthropicKey,
} from '../../functions/_shared/anthropic-client.ts';

// deno-lint-ignore no-explicit-any
function stubRpcClient(data: unknown, error: { message: string } | null = null): any {
  return { rpc: (_fn: string, _args: Record<string, unknown>) => Promise.resolve({ data, error }) };
}

Deno.test("resolveAnthropicClient: uses the user's key when one is stored", async () => {
  const client = stubRpcClient('sk-ant-user-key');
  const { source, client: anthropic } = await resolveAnthropicClient(client, 'user-1', 'enc-key');
  assertEquals(source, 'user');
  assertEquals(anthropic.apiKey, 'sk-ant-user-key');
});

Deno.test('resolveAnthropicClient: falls back to the project key when none is stored', async () => {
  Deno.env.set('ANTHROPIC_API_KEY', 'sk-ant-project-key');
  try {
    const client = stubRpcClient(null);
    const { source, client: anthropic } = await resolveAnthropicClient(client, 'user-1', 'enc-key');
    assertEquals(source, 'project');
    assertEquals(anthropic.apiKey, 'sk-ant-project-key');
  } finally {
    Deno.env.delete('ANTHROPIC_API_KEY');
  }
});

Deno.test('resolveAnthropicClient: falls back to the project key on an RPC error', async () => {
  Deno.env.set('ANTHROPIC_API_KEY', 'sk-ant-project-key');
  try {
    const client = stubRpcClient(null, { message: 'decrypt failed' });
    const { source } = await resolveAnthropicClient(client, 'user-1', 'enc-key');
    assertEquals(source, 'project');
  } finally {
    Deno.env.delete('ANTHROPIC_API_KEY');
  }
});

Deno.test('resolveAnthropicClient: an empty-string key counts as no key stored', async () => {
  Deno.env.set('ANTHROPIC_API_KEY', 'sk-ant-project-key');
  try {
    const client = stubRpcClient('');
    const { source } = await resolveAnthropicClient(client, 'user-1', 'enc-key');
    assertEquals(source, 'project');
  } finally {
    Deno.env.delete('ANTHROPIC_API_KEY');
  }
});

Deno.test('isAnthropicAuthError: true for 401 and 403', () => {
  assert(isAnthropicAuthError({ status: 401 }));
  assert(isAnthropicAuthError({ status: 403 }));
});

Deno.test('isAnthropicAuthError: false for other statuses, and non-error values', () => {
  assertEquals(isAnthropicAuthError({ status: 429 }), false);
  assertEquals(isAnthropicAuthError({ status: 500 }), false);
  assertEquals(isAnthropicAuthError(new Error('boom')), false);
  assertEquals(isAnthropicAuthError(null), false);
  assertEquals(isAnthropicAuthError(undefined), false);
});

Deno.test(
  'claudeKeyRejectedResponse: distinct status and body, never falls back silently',
  async () => {
    const res = claudeKeyRejectedResponse({ 'Access-Control-Allow-Origin': '*' });
    assertEquals(res.status, 402);
    const body = await res.json();
    assertEquals(body.error, 'claude_key_rejected');
    assertEquals(body.source, 'user');
  }
);

Deno.test(
  'validateAnthropicKey: ok on a 200 from /v1/models, sends the key as x-api-key',
  async () => {
    let sentHeaders: Headers | undefined;
    const fakeFetch = ((url: string, init?: RequestInit) => {
      sentHeaders = new Headers(init?.headers);
      return Promise.resolve(new Response('{}', { status: 200 }));
      // deno-lint-ignore no-explicit-any
    }) as any;
    const result = await validateAnthropicKey('sk-ant-good', fakeFetch);
    assertEquals(result.ok, true);
    assertEquals(sentHeaders?.get('x-api-key'), 'sk-ant-good');
    assertEquals(sentHeaders?.get('anthropic-version'), '2023-06-01');
  }
);

Deno.test('validateAnthropicKey: not ok on a 401', async () => {
  // deno-lint-ignore no-explicit-any
  const fakeFetch = (() => Promise.resolve(new Response('{}', { status: 401 }))) as any;
  const result = await validateAnthropicKey('sk-ant-bad', fakeFetch);
  assertEquals(result.ok, false);
});

Deno.test(
  'validateAnthropicKey: a network failure comes back as networkError, not a throw',
  async () => {
    // deno-lint-ignore no-explicit-any
    const fakeFetch = (() => Promise.reject(new Error('network down'))) as any;
    const result = await validateAnthropicKey('sk-ant-x', fakeFetch);
    assertEquals(result.ok, false);
    assertEquals(result.networkError, true);
  }
);
