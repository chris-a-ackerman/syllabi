// supabase/functions/test-canvas-token/index.ts
//
// SYL-72: "Test connection" for a stored Canvas token — the same
// GET {base}/api/v1/users/self round trip save-canvas-token already makes,
// without touching the stored token or base URL.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { safeCanvasFetch, UnsafeCanvasUrlError } from "../_shared/canvas-url.ts";
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

    // 2. Rate limit — a free-standing test endpoint is a token-validation
    // oracle without one (SYL-72).
    const quotaResponse = await enforceAiQuota(supabaseService, user.id, "manage-api-keys", CORS_HEADERS);
    if (quotaResponse) return quotaResponse;

    // 3. Fetch the stored token + base URL.
    const encryptionKey = Deno.env.get("CANVAS_ENCRYPTION_KEY");
    if (!encryptionKey) {
      console.error("CANVAS_ENCRYPTION_KEY is not set");
      return json({ error: "Server misconfiguration." }, 500);
    }
    const [tokenResult, profileResult] = await Promise.all([
      supabaseService.rpc("get_canvas_token", { p_user_id: user.id, p_key: encryptionKey }),
      supabaseService.from("profiles").select("canvas_base_url").eq("id", user.id).single(),
    ]);
    const canvasToken: string | null = tokenResult.data ?? null;
    const canvasBaseUrl: string | null = profileResult.data?.canvas_base_url ?? null;
    if (!canvasToken || !canvasBaseUrl) {
      return json({ error: "No Canvas connection is set up." }, 404);
    }

    // 4. Call Canvas and record the outcome.
    let ok: boolean;
    let reason: "rejected" | "unreachable" | undefined;
    let canvasUser: string | null = null;
    try {
      const res = await safeCanvasFetch(`${canvasBaseUrl}/api/v1/users/self`, {
        headers: { Authorization: `Bearer ${canvasToken}` },
      });
      ok = res.ok;
      if (ok) {
        const body = await res.json();
        canvasUser = body?.name ?? null;
      } else {
        reason = "rejected";
      }
    } catch (err) {
      ok = false;
      reason = "unreachable";
      if (!(err instanceof UnsafeCanvasUrlError)) throw err;
    }

    const { error: testError } = await supabaseService.rpc("record_key_test", {
      p_user_id: user.id,
      p_provider: "canvas",
      p_ok: ok,
    });
    if (testError) console.error("test-canvas-token: record_key_test RPC error:", testError.message);

    if (!ok) return json({ ok: false, reason });
    return json({ ok: true, canvas_user: canvasUser });
  } catch (err) {
    // Detail stays server-side (SYL-31); clients get a generic message.
    console.error("test-canvas-token unexpected error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
