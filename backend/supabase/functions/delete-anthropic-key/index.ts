// supabase/functions/delete-anthropic-key/index.ts
//
// SYL-72: removes a user's stored Claude API key. No outbound call, so no
// rate limit — mirrors delete-canvas-token.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { error: rpcError } = await supabaseService.rpc("delete_anthropic_key", {
      p_user_id: user.id,
    });
    if (rpcError) {
      console.error("delete-anthropic-key RPC error:", rpcError.message);
      return json({ error: "Failed to delete the key." }, 500);
    }

    return json({ ok: true });
  } catch (err) {
    // Detail stays server-side (SYL-31); clients get a generic message.
    console.error("delete-anthropic-key unexpected error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
