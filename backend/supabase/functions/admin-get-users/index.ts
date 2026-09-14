// supabase/functions/admin-get-users/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS } from "../_shared/cors.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req) => {
  // verify_jwt is false so the CORS preflight passes; auth is enforced here.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Verify caller is an admin via their JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) return new Response("Forbidden", { status: 403, headers: CORS_HEADERS });

  // Safe to use admin client now
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const pageSize = 20;
  const search = url.searchParams.get("search") || "";

  // anthropic_key_encrypted is read only to derive a boolean below — it is
  // stripped from every row before the response leaves this function (SYL-72:
  // "has_anthropic_key and a BYOK request count per user, no last4/key material").
  let query = supabaseAdmin
    .from("profiles")
    .select("id, display_name, created_at, anthropic_key_encrypted", { count: "exact" })
    .range((page - 1) * pageSize, page * pageSize - 1)
    .order("created_at", { ascending: false });

  if (search) {
    query = query.ilike("display_name", `%${search}%`);
  }

  const { data: users, count, error } = await query;
  if (error) {
    // Detail stays server-side (SYL-31); clients get a generic message.
    console.error("admin-get-users query error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const userIds = (users ?? []).map((u) => u.id);
  const byokCounts: Record<string, number> = {};
  if (userIds.length > 0) {
    const { data: byokRows, error: byokError } = await supabaseAdmin
      .from("ai_usage_byok")
      .select("user_id, count")
      .in("user_id", userIds);
    if (byokError) {
      // Non-fatal: the user list is still useful without BYOK counts.
      console.error("admin-get-users: ai_usage_byok query error:", byokError.message);
    } else {
      for (const row of byokRows ?? []) {
        byokCounts[row.user_id] = (byokCounts[row.user_id] ?? 0) + row.count;
      }
    }
  }

  const usersWithByok = (users ?? []).map(({ anthropic_key_encrypted, ...rest }) => ({
    ...rest,
    has_anthropic_key: anthropic_key_encrypted !== null,
    byok_request_count: byokCounts[rest.id] ?? 0,
  }));

  return new Response(JSON.stringify({ users: usersWithByok, total: count, page, pageSize }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});