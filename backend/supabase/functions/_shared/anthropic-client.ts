// SYL-72: resolves which Anthropic API key an AI endpoint call should use —
// the caller's own (BYOK), or the project's — and classifies the errors that
// come back from a rejected user key.
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.3";

export type AnthropicKeySource = "user" | "project";

// Structural type so this module stays import-free for unit tests; any
// supabase-js client (service role) satisfies it.
interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Builds an Anthropic client for this request: the caller's own key when one
 * is stored (BYOK), otherwise the project's ANTHROPIC_API_KEY. Never throws
 * on a missing/undecryptable user key — that just falls back to the project
 * key, same as no key being stored at all.
 */
export async function resolveAnthropicClient(
  serviceClient: RpcClient,
  userId: string,
  encKey: string,
): Promise<{ client: Anthropic; source: AnthropicKeySource }> {
  const { data, error } = await serviceClient.rpc("get_anthropic_key", {
    p_user_id: userId,
    p_enc_key: encKey,
  });

  const userKey = !error && typeof data === "string" && data.length > 0 ? data : null;
  if (userKey) {
    return { client: new Anthropic({ apiKey: userKey }), source: "user" };
  }
  return {
    client: new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! }),
    source: "project",
  };
}

/** True if `err` is the Anthropic SDK's error for a rejected/revoked key (401/403). */
export function isAnthropicAuthError(err: unknown): boolean {
  const status = (err as { status?: number } | null | undefined)?.status;
  return status === 401 || status === 403;
}

/** Status code for the claude_key_rejected response — used everywhere it's returned. */
export const CLAUDE_KEY_REJECTED_STATUS = 402;

/**
 * The response every AI endpoint returns when a BYOK request fails because
 * the user's own key was rejected. Never falls back to the project key
 * silently — the caller must stop here, not retry.
 */
export function claudeKeyRejectedResponse(corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({
      error: "claude_key_rejected",
      message: "Your Claude API key was rejected. Update it in Settings.",
      source: "user",
    }),
    { status: CLAUDE_KEY_REJECTED_STATUS, headers: { "Content-Type": "application/json", ...corsHeaders } },
  );
}

export const ANTHROPIC_API_VERSION = "2023-06-01";

/**
 * Validates a Claude API key against GET /v1/models — the cheapest endpoint
 * that requires auth, so this costs no tokens. Never throws: a network
 * failure comes back as `{ ok: false, networkError: true }` rather than an
 * unhandled rejection, so callers can always turn the result into a response.
 * `fetchImpl` is injectable for unit tests.
 */
export async function validateAnthropicKey(
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; networkError?: boolean }> {
  try {
    const res = await fetchImpl("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_API_VERSION },
    });
    return { ok: res.ok };
  } catch {
    return { ok: false, networkError: true };
  }
}
