// SYL-72: resolveAnthropicClient picks the caller's own key over the
// project's, and isAnthropicAuthError classifies a rejected key correctly.
import { assert, assertEquals } from "@std/assert";
import {
  claudeKeyRejectedResponse,
  isAnthropicAuthError,
  resolveAnthropicClient,
} from "../../functions/_shared/anthropic-client.ts";

// deno-lint-ignore no-explicit-any
function stubRpcClient(data: unknown, error: { message: string } | null = null): any {
  return { rpc: (_fn: string, _args: Record<string, unknown>) => Promise.resolve({ data, error }) };
}

Deno.test("resolveAnthropicClient: uses the user's key when one is stored", async () => {
  const client = stubRpcClient("sk-ant-user-key");
  const { source, client: anthropic } = await resolveAnthropicClient(client, "user-1", "enc-key");
  assertEquals(source, "user");
  assertEquals(anthropic.apiKey, "sk-ant-user-key");
});

Deno.test("resolveAnthropicClient: falls back to the project key when none is stored", async () => {
  Deno.env.set("ANTHROPIC_API_KEY", "sk-ant-project-key");
  try {
    const client = stubRpcClient(null);
    const { source, client: anthropic } = await resolveAnthropicClient(client, "user-1", "enc-key");
    assertEquals(source, "project");
    assertEquals(anthropic.apiKey, "sk-ant-project-key");
  } finally {
    Deno.env.delete("ANTHROPIC_API_KEY");
  }
});

Deno.test("resolveAnthropicClient: falls back to the project key on an RPC error", async () => {
  Deno.env.set("ANTHROPIC_API_KEY", "sk-ant-project-key");
  try {
    const client = stubRpcClient(null, { message: "decrypt failed" });
    const { source } = await resolveAnthropicClient(client, "user-1", "enc-key");
    assertEquals(source, "project");
  } finally {
    Deno.env.delete("ANTHROPIC_API_KEY");
  }
});

Deno.test("resolveAnthropicClient: an empty-string key counts as no key stored", async () => {
  Deno.env.set("ANTHROPIC_API_KEY", "sk-ant-project-key");
  try {
    const client = stubRpcClient("");
    const { source } = await resolveAnthropicClient(client, "user-1", "enc-key");
    assertEquals(source, "project");
  } finally {
    Deno.env.delete("ANTHROPIC_API_KEY");
  }
});

Deno.test("isAnthropicAuthError: true for 401 and 403", () => {
  assert(isAnthropicAuthError({ status: 401 }));
  assert(isAnthropicAuthError({ status: 403 }));
});

Deno.test("isAnthropicAuthError: false for other statuses, and non-error values", () => {
  assertEquals(isAnthropicAuthError({ status: 429 }), false);
  assertEquals(isAnthropicAuthError({ status: 500 }), false);
  assertEquals(isAnthropicAuthError(new Error("boom")), false);
  assertEquals(isAnthropicAuthError(null), false);
  assertEquals(isAnthropicAuthError(undefined), false);
});

Deno.test("claudeKeyRejectedResponse: distinct status and body, never falls back silently", async () => {
  const res = claudeKeyRejectedResponse({ "Access-Control-Allow-Origin": "*" });
  assertEquals(res.status, 402);
  const body = await res.json();
  assertEquals(body.error, "claude_key_rejected");
  assertEquals(body.source, "user");
});
