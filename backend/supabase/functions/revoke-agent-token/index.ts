// revoke-agent-token (SYL-92): revoke one of the signed-in user's agent
// tokens. POST, session JWT only — an agent can't revoke (or un-revoke)
// anything. Revocation is permanent: a trigger stops revoked_at from ever
// being cleared.
//
//   POST /functions/v1/revoke-agent-token   { "id": "<agent_tokens.id>" }
//   → 200 { ok: true, id, revoked_at }
//   → 404 when the id isn't one of the caller's live tokens (another user's
//     token is indistinguishable from a missing one — RLS hides it)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS } from "../_shared/cors.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

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

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    let id: unknown;
    try {
      id = (await req.json())?.id;
    } catch {
      id = undefined;
    }
    if (typeof id !== "string" || !UUID_RE.test(id)) {
      return json({ error: "id (uuid) is required" }, 400);
    }

    // RLS (own rows only) + the explicit user_id filter; already-revoked rows
    // are excluded so a repeat call is a clean 404 rather than a trigger error.
    const { data, error } = await supabaseUser
      .from("agent_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .select("id, revoked_at");
    if (error) throw error;
    if (!data || data.length === 0) return json({ error: "Token not found" }, 404);

    return json({ ok: true, id: data[0].id, revoked_at: data[0].revoked_at });
  } catch (err) {
    // Detail stays server-side (SYL-31); clients get a generic message.
    console.error("revoke-agent-token error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
