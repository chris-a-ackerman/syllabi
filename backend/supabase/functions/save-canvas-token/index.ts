// supabase/functions/save-canvas-token/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
    // 1. Require Authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    // 2. Parse body
    const { canvas_token, canvas_base_url } = await req.json();

    // 3. Validate inputs
    if (!canvas_token || !canvas_base_url) {
      return json({ error: "canvas_token and canvas_base_url are required." }, 400);
    }
    if (!canvas_base_url.startsWith("https://")) {
      return json({ error: "canvas_base_url must start with https://" }, 400);
    }

    // 4. Validate token against Canvas API
    const canvasRes = await fetch(`${canvas_base_url}/api/v1/users/self`, {
      headers: { Authorization: `Bearer ${canvas_token}` },
    });
    if (!canvasRes.ok) {
      return json(
        { error: "Could not authenticate with Canvas. Check your token and institution URL." },
        400
      );
    }
    const canvasUser = await canvasRes.json();

    // 5. Get user ID from JWT
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    // 6. Encrypt and store the token
    const encryptionKey = Deno.env.get("CANVAS_ENCRYPTION_KEY");
    if (!encryptionKey) {
      console.error("CANVAS_ENCRYPTION_KEY is not set");
      return json({ error: "Server misconfiguration." }, 500);
    }

    const { error: rpcError } = await supabaseService.rpc("store_canvas_token", {
      p_user_id: user.id,
      p_token: canvas_token,
      p_base_url: canvas_base_url,
      p_key: encryptionKey,
    });
    if (rpcError) {
      console.error("store_canvas_token RPC error:", rpcError);
      return json({ error: "Failed to store Canvas token." }, 500);
    }

    // 7. Return success with Canvas user name
    return json({ success: true, canvas_user: canvasUser.name });
  } catch (err) {
    console.error("save-canvas-token unexpected error:", err);
    return json({ error: err instanceof Error ? err.message : "Unexpected error." }, 500);
  }
});
