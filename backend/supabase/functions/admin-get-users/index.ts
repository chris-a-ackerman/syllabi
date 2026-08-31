// supabase/functions/admin-get-users/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS } from "../_shared/cors.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req) => {
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

  let query = supabaseAdmin
    .from("profiles")
    .select("id, display_name, created_at", { count: "exact" })
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

  return new Response(JSON.stringify({ users, total: count, page, pageSize }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});