// supabase/functions/test-anthropic-key/index.ts
//
// SYL-72: re-validates a user's stored Claude API key on demand ("Test"
// button in Settings), without spending any Anthropic tokens.
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
    // 1. Resolve the caller before any other work (SYL-54 ordering).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    // 2. Rate limit — a free-standing test endpoint is a key-validation oracle
    // without one (SYL-72).
    const quotaResponse = await enforceAiQuota(supabaseService, user.id, "manage-api-keys", CORS_HEADERS);
    if (quotaResponse) return quotaResponse;

    // 3. Decrypt the stored key.
    const encKey = Deno.env.get("SECRETS_ENCRYPTION_KEY");
    if (!encKey) {
      console.error("SECRETS_ENCRYPTION_KEY is not set");
      return json({ error: "Server misconfiguration." }, 500);
    }
    const { data: key, error: keyError } = await supabaseService.rpc("get_anthropic_key", {
      p_user_id: user.id,
      p_enc_key: encKey,
    });
    if (keyError) {
      console.error("test-anthropic-key: get_anthropic_key RPC error:", keyError.message);
      return json({ error: "Internal server error" }, 500);
    }
    if (!key) {
      return json({ error: "No Claude API key is set." }, 404);
    }

    // 4. Validate and record the outcome — never the key itself.
    const { ok, networkError } = await validateAnthropicKey(key);
    if (networkError) {
      console.error("test-anthropic-key: could not reach Anthropic to validate the key");
      return json({ error: "Could not reach Anthropic to test the key. Try again." }, 502);
    }

    const { error: testError } = await supabaseService.rpc("record_key_test", {
      p_user_id: user.id,
      p_provider: "anthropic",
      p_ok: ok,
    });
    if (testError) console.error("test-anthropic-key: record_key_test RPC error:", testError.message);

    return json({ ok, tested_at: new Date().toISOString() });
  } catch (err) {
    // Detail stays server-side (SYL-31); clients get a generic message.
    console.error("test-anthropic-key unexpected error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
