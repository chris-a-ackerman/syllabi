// supabase/functions/find-canvas-courses/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assertSafeCanvasUrl, UnsafeCanvasUrlError } from "../_shared/canvas-url.ts";

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

// Convert an ISO 8601 datetime string to YYYY-MM-DD, or return null
function isoToDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    // 1. Require Authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    // 2. Get user ID from JWT
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    // 3. Parse body
    const rawBody = await req.text();
    console.log("find-canvas-courses raw body:", JSON.stringify(rawBody));
    console.log("find-canvas-courses content-type:", req.headers.get("content-type"));
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json({ error: "Request body must be valid JSON." }, 400);
    }
    const { semester_start, semester_end } = body;
    if (!semester_start || !semester_end) {
      return json({ error: "semester_start and semester_end are required." }, 400);
    }

    const semesterStartMs = new Date(semester_start).getTime();
    const semesterEndMs = new Date(semester_end).getTime();
    const MS_PER_DAY = 86_400_000;

    // 4. Fetch Canvas token and base URL in parallel
    const encryptionKey = Deno.env.get("CANVAS_ENCRYPTION_KEY");
    if (!encryptionKey) {
      console.error("CANVAS_ENCRYPTION_KEY is not set");
      return json({ error: "Server misconfiguration." }, 500);
    }

    const [tokenResult, profileResult] = await Promise.all([
      supabaseService.rpc("get_canvas_token", {
        p_user_id: user.id,
        p_key: encryptionKey,
      }),
      supabaseService
        .from("profiles")
        .select("canvas_base_url")
        .eq("id", user.id)
        .single(),
    ]);

    console.log("find-canvas-courses tokenResult:", { data: tokenResult.data, error: tokenResult.error });
    console.log("find-canvas-courses profileResult:", { data: profileResult.data, error: profileResult.error });

    const decryptedToken: string | null = tokenResult.data ?? null;
    const canvasBaseUrl: string | null = profileResult.data?.canvas_base_url ?? null;

    console.log("find-canvas-courses resolved:", { hasToken: !!decryptedToken, canvasBaseUrl });

    if (!decryptedToken || !canvasBaseUrl) {
      return json({ error: "No Canvas token found. Please connect Canvas first." }, 400);
    }

    try {
      await assertSafeCanvasUrl(canvasBaseUrl);
    } catch (err) {
      if (err instanceof UnsafeCanvasUrlError) {
        return json({ error: `Stored Canvas URL is not usable: ${err.message}` }, 400);
      }
      throw err;
    }

    // 5. Fetch all active courses from Canvas with pagination
    const allCourses: unknown[] = [];
    let page = 1;

    while (true) {
      const url =
        `${canvasBaseUrl}/api/v1/courses` +
        `?enrollment_state=active` +
        `&enrollment_type=student` +
        `&include[]=term` +
        `&include[]=syllabus_body` +
        `&include[]=teachers` +
        `&per_page=50` +
        `&page=${page}`;

      const canvasRes = await fetch(url, {
        headers: { Authorization: `Bearer ${decryptedToken}` },
      });

      if (canvasRes.status === 401) {
        return json(
          { error: "Canvas token is invalid or expired. Please reconnect Canvas." },
          400
        );
      }
      if (!canvasRes.ok) {
        console.error("Canvas API error:", canvasRes.status, await canvasRes.text());
        return json({ error: "Could not reach Canvas. Please try again." }, 502);
      }

      const page_courses = await canvasRes.json() as unknown[];
      allCourses.push(...page_courses);

      if (page_courses.length < 50) break;
      page++;
    }

    // 6. Filter to semester date range and shape response
    const courses = [];
    for (const course of allCourses) {
      const c = course as Record<string, unknown>;
      const term = c.term as Record<string, unknown> | null | undefined;

      const termStartIso = term?.start_at as string | null | undefined;
      const termEndIso = term?.end_at as string | null | undefined;

      let keep = false;
      const needsReview = !termStartIso;

      if (needsReview) {
        // No term dates — include and flag for review
        keep = true;
      } else {
        const termStartMs = new Date(termStartIso!).getTime();
        const termEndMs = termEndIso ? new Date(termEndIso).getTime() : null;

        // term.start_at within 30 days before semester_start
        if (termStartMs >= semesterStartMs - 30 * MS_PER_DAY && termStartMs <= semesterStartMs) {
          keep = true;
        }
        // term.end_at within 30 days after semester_end
        if (termEndMs !== null && termEndMs >= semesterEndMs && termEndMs <= semesterEndMs + 30 * MS_PER_DAY) {
          keep = true;
        }
      }

      if (!keep) continue;

      const teachers = c.teachers as Array<Record<string, unknown>> | null | undefined;

      courses.push({
        canvas_course_id: String(c.id),
        name: c.name as string,
        course_code: (c.course_code as string | null | undefined) ?? null,
        instructor: teachers?.[0]?.display_name as string ?? null,
        term_name: (term?.name as string | null | undefined) ?? null,
        term_start: isoToDate(termStartIso),
        term_end: isoToDate(termEndIso),
        has_syllabus:
          typeof c.syllabus_body === "string" && (c.syllabus_body as string).length > 0,
        needs_review: needsReview,
      });
    }

    const needs_review_count = courses.filter((c) => c.needs_review).length;

    return json({ courses, total_found: courses.length, needs_review_count });
  } catch (err) {
    console.error("find-canvas-courses unexpected error:", err);
    return json({ error: err instanceof Error ? err.message : "Unexpected error." }, 500);
  }
});
