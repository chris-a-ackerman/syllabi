// SYL-29: per-user daily quota enforcement for the AI endpoints.
//
// Usage, after the caller's JWT has been resolved to a user:
//
//   const quotaResponse = await enforceAiQuota(serviceClient, user.id, "chat", corsHeaders);
//   if (quotaResponse) return quotaResponse;
//
// Counting happens in public.consume_ai_quota (see the ai_usage migration),
// a single atomic increment-and-return, so bursts can't race past the limit.

import { AI_DAILY_LIMITS } from "./ai-limits.ts";

// Structural type so this module stays import-free for unit tests; any
// supabase-js client (service role) satisfies it.
interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Consume `amount` units of `endpoint`'s daily quota for `userId`.
 * Returns null when the request may proceed, or a ready-to-return Response
 * (429 over limit, 500 if the counter itself is broken — fail closed, this
 * is a cost control).
 */
export async function enforceAiQuota(
  serviceClient: RpcClient,
  userId: string,
  endpoint: string,
  corsHeaders: Record<string, string>,
  amount = 1,
): Promise<Response | null> {
  const limit = AI_DAILY_LIMITS[endpoint];
  if (limit === undefined) {
    throw new Error(`No AI daily limit configured for endpoint "${endpoint}"`);
  }

  const { data, error } = await serviceClient.rpc("consume_ai_quota", {
    p_user_id: userId,
    p_endpoint: endpoint,
    p_amount: amount,
  });

  if (error || typeof data !== "number") {
    console.error(`[ai-quota] consume_ai_quota failed for ${endpoint}:`, error?.message ?? data);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  if (data > limit) {
    return new Response(
      JSON.stringify({ error: "Daily AI usage limit reached. Try again tomorrow." }),
      { status: 429, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  return null;
}
