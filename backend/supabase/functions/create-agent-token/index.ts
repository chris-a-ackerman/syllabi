// create-agent-token (SYL-92): mint a scoped, read-only agent token for the
// signed-in user. POST, session JWT only — an agent token can't mint another
// (auth.getUser rejects it).
//
//   POST /functions/v1/create-agent-token   { "label"?: string }
//   → 201 { id, token, label, scopes, created_at }
//
// The raw token is returned exactly once; only its sha256 is stored. The row
// is written through the caller's RLS-scoped client, so the insert policy
// (own user_id, not revoked, unused) and the column grants apply.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS } from "../_shared/cors.ts";
import { generateAgentToken, hashAgentToken } from "../_shared/agent-auth.ts";

// Plenty for one agent per device; stops a runaway script minting thousands.
const MAX_ACTIVE_TOKENS = 10;
const DEFAULT_SCOPES = ["read:upcoming"];

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

    let label: string | null = null;
    try {
      const body = await req.json();
      if (body?.label !== undefined && body?.label !== null) {
        if (typeof body.label !== "string" || body.label.trim().length > 100) {
          return json({ error: "label must be a string of at most 100 characters" }, 400);
        }
        label = body.label.trim() || null;
      }
    } catch {
      // No / non-JSON body: an unlabeled token is fine.
    }

    const { count, error: countError } = await supabaseUser
      .from("agent_tokens")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("revoked_at", null);
    if (countError) throw countError;
    if ((count ?? 0) >= MAX_ACTIVE_TOKENS) {
      return json({ error: `At most ${MAX_ACTIVE_TOKENS} active agent tokens; revoke one first.` }, 409);
    }

    const token = generateAgentToken();
    const { data: row, error: insertError } = await supabaseUser
      .from("agent_tokens")
      .insert({
        user_id: user.id,
        token_hash: await hashAgentToken(token),
        label,
        scopes: DEFAULT_SCOPES,
      })
      .select("id, label, scopes, created_at")
      .single();
    if (insertError || !row) throw insertError ?? new Error("insert returned no row");

    return json({ ...row, token }, 201);
  } catch (err) {
    // Detail stays server-side (SYL-31); clients get a generic message.
    console.error("create-agent-token error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
