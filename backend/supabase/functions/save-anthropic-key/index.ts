// supabase/functions/save-anthropic-key/index.ts
//
// SYL-72: stores a user's own Claude API key (BYOK) after validating it
// against Anthropic — no tokens spent (GET /v1/models, not messages.create).
//
// One of four single-purpose functions (save/test/delete-anthropic-key,
// test-canvas-token) rather than a single manage-api-keys dispatcher — see
// the pass 5/6 PR description for why.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateAnthropicKey } from "../_shared/anthropic-client.ts";
import { enforceAiQuota } from "../_shared/ai-quota.ts";
import { CORS_HEADERS } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

const supabaseService = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    // 1. Resolve the caller before any other work (SYL-54 ordering) — a
    // garbage bearer token must not reach the outbound Anthropic round trip.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    // 2. Parse + validate the body
    let body: { key?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Request body must be valid JSON." }, 400);
    }
    const key = body.key;
    if (!key || typeof key !== "string") {
      return json({ error: "key is required." }, 400);
    }

    // 3. Rate limit — this endpoint spends no Anthropic tokens, but it is
    // still a key-validation oracle without a limit (SYL-72).
    const quotaResponse = await enforceAiQuota(supabaseService, user.id, "manage-api-keys", CORS_HEADERS);
    if (quotaResponse) return quotaResponse;

    // 4. Validate against Anthropic before storing anything.
    const { ok, networkError } = await validateAnthropicKey(key);
    if (!ok) {
      if (networkError) {
        console.error("save-anthropic-key: could not reach Anthropic to validate the key");
        return json({ error: "Could not reach Anthropic to validate the key. Try again." }, 502);
      }
      return json({ error: "Anthropic rejected this key" }, 400);
    }

    // 5. Store, then record that it just passed a test.
    const encKey = Deno.env.get("SECRETS_ENCRYPTION_KEY");
    if (!encKey) {
      console.error("SECRETS_ENCRYPTION_KEY is not set");
      return json({ error: "Server misconfiguration." }, 500);
    }
    const { error: storeError } = await supabaseService.rpc("store_anthropic_key", {
      p_user_id: user.id,
      p_key: key,
      p_enc_key: encKey,
    });
    if (storeError) {
      console.error("save-anthropic-key: store_anthropic_key RPC error:", storeError.message);
      return json({ error: "Failed to store the key." }, 500);
    }

    const { error: testError } = await supabaseService.rpc("record_key_test", {
      p_user_id: user.id,
      p_provider: "anthropic",
      p_ok: true,
    });
    if (testError) console.error("save-anthropic-key: record_key_test RPC error:", testError.message);

    // Computed the same way the DB does (right(key, 4)) — never the full key.
    return json({ ok: true, last4: key.slice(-4) });
  } catch (err) {
    // Detail stays server-side (SYL-31); clients get a generic message.
    console.error("save-anthropic-key unexpected error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
