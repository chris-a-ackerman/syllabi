// SYL-29: per-user daily quota enforcement for the AI endpoints.
//
// Usage, after the caller's JWT has been resolved to a user:
//
//   const quotaResponse = await enforceAiQuota(serviceClient, user.id, "chat", corsHeaders);
//   if (quotaResponse) return quotaResponse;
//
// Counting happens in public.consume_ai_quota (see the ai_usage migration),
// a single atomic increment-and-return, so bursts can't race past the limit.

import { AI_DAILY_LIMIT_GLOBAL, AI_DAILY_LIMITS } from "./ai-limits.ts";

// Structural type so this module stays import-free for unit tests; any
// supabase-js client (service role) satisfies it.
interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

interface ConsumeAiQuotaRow {
  count: number | null;
  global_exceeded: boolean;
}

/**
 * Consume `amount` units of `endpoint`'s daily quota for `userId`, and the
 * same amount of the cross-user daily quota (SYL-67). Returns null when the
 * request may proceed, or a ready-to-return Response (429 over either limit,
 * 500 if the counter itself is broken — fail closed, this is a cost
 * control). consume_ai_quota only increments when the request fits under
 * both limits, so a rejected request never burns a quota unit.
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
    p_limit: limit,
    p_global_limit: AI_DAILY_LIMIT_GLOBAL,
    p_amount: amount,
  });

  const row = (Array.isArray(data) ? data[0] : data) as ConsumeAiQuotaRow | undefined;

  if (error || !row) {
    console.error(`[ai-quota] consume_ai_quota failed for ${endpoint}:`, error?.message ?? "no row returned");
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  if (row.count === null) {
    const body = row.global_exceeded
      ? { error: "Daily AI usage limit reached across all users. Try again tomorrow.", scope: "global" }
      : { error: "Daily AI usage limit reached. Try again tomorrow.", scope: "user" };
    return new Response(
      JSON.stringify(body),
      { status: 429, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }

  return null;
}
