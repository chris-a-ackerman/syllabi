// supabase/functions/match-canvas-assignments/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.3";
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

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

interface CanvasAssignment {
  id: number;
  name: string;
  due_at: string | null;
  unlock_at: string | null;
  points_possible: number | null;
  submission_types: string[];
  description: string | null;
  html_url: string;
  allowed_attempts: number | null;
  time_limit: number | null;
  assignment_group?: { id: number; name: string };
}

interface CourseEventRow { id: string; title: string; date: string | null; }

interface MatchResult {
  matches: Array<{ canvas_assignment_id: string; course_event_id: string; confidence: "high" | "medium" | "low" }>;
  unmatched_canvas_assignment_ids: string[];
}

const MATCHING_SYSTEM_PROMPT = `You are a course assignment matcher. Given Canvas LMS assignments and syllabus course events, identify which Canvas assignment corresponds to which syllabus event. Return raw JSON only — no markdown, no explanation. Output must start with { and end with }.

Output schema:
{
  "matches": [
    { "canvas_assignment_id": "<string ID>", "course_event_id": "<UUID>", "confidence": "high" | "medium" | "low" }
  ],
  "unmatched_canvas_assignment_ids": ["<id>", ...]
}

Rules:
- Primary: title similarity (PS3 ↔ Problem Set 3, HW ↔ Homework, etc.)
- Secondary: date proximity within 2 days (accounts for timezone differences)
- confidence high: titles clearly the same; medium: likely same with minor differences; low: ambiguous but plausible
- Prefer confidence "low" over no match when plausible — a low-confidence link is still useful
- Each Canvas assignment and each course event may be matched at most once
- canvas_assignment_id must be an exact string from the provided Canvas list
- course_event_id must be an exact UUID from the provided syllabus list
- List ALL unmatched Canvas assignment IDs in unmatched_canvas_assignment_ids`;

function isoToDate(iso: string): string {
  return iso.slice(0, 10);
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    // 1. Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    // 2. Parse body
    let body: { course_id: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Request body must be valid JSON." }, 400);
    }
    const { course_id } = body;
    if (!course_id) return json({ error: "course_id is required." }, 400);

    console.log(`[match-canvas] start course_id=${course_id} user_id=${user.id}`);

    // 3. Fetch course — check canvas_course_id
    const { data: course, error: courseErr } = await supabaseService
      .from("courses")
      .select("canvas_course_id, user_id")
      .eq("id", course_id)
      .eq("user_id", user.id)
      .single();

    if (courseErr || !course) return json({ error: "Course not found." }, 404);

    if (!course.canvas_course_id) {
      console.log(`[match-canvas] no canvas_course_id, skipping`);
      return json({ success: true, skipped: true, reason: "no_canvas_course_id" });
    }

    // 4. Canvas token + base URL in parallel
    const encryptionKey = Deno.env.get("CANVAS_ENCRYPTION_KEY");
    if (!encryptionKey) {
      console.error("[match-canvas] CANVAS_ENCRYPTION_KEY not set");
      return json({ error: "Server misconfiguration." }, 500);
    }

    const [tokenRes, profileRes] = await Promise.all([
      supabaseService.rpc("get_canvas_token", { p_user_id: user.id, p_key: encryptionKey }),
      supabaseService.from("profiles").select("canvas_base_url").eq("id", user.id).single(),
    ]);

    const canvasToken: string | null = tokenRes.data ?? null;
    const canvasBaseUrl: string | null = profileRes.data?.canvas_base_url ?? null;

    if (!canvasToken || !canvasBaseUrl) {
      console.log(`[match-canvas] no canvas token/url, skipping`);
      return json({ success: true, skipped: true, reason: "no_canvas_token" });
    }

    try {
      await assertSafeCanvasUrl(canvasBaseUrl);
    } catch (err) {
      if (err instanceof UnsafeCanvasUrlError) {
        return json({ error: `Stored Canvas URL is not usable: ${err.message}` }, 400);
      }
      throw err;
    }

    // 5. Fetch Canvas assignments
    const assignmentsRes = await fetch(
      `${canvasBaseUrl}/api/v1/courses/${course.canvas_course_id}/assignments?per_page=100&include[]=assignment_group`,
      { headers: { Authorization: `Bearer ${canvasToken}` } }
    );
    if (assignmentsRes.status === 401) {
      return json({ error: "Canvas token invalid or expired. Please reconnect Canvas." }, 400);
    }
    if (!assignmentsRes.ok) {
      console.error(`[match-canvas] Canvas API error: ${assignmentsRes.status}`);
      return json({ error: "Could not reach Canvas. Please try again." }, 502);
    }
    const canvasAssignments: CanvasAssignment[] = await assignmentsRes.json();
    console.log(`[match-canvas] fetched ${canvasAssignments.length} canvas assignments`);

    // 6. Fetch syllabus course_events
    const { data: courseEvents } = await supabaseService
      .from("course_events")
      .select("id, title, date")
      .eq("course_id", course_id)
      .eq("source", "syllabus");

    const syllabusEvents: CourseEventRow[] = courseEvents ?? [];
    console.log(`[match-canvas] fetched ${syllabusEvents.length} syllabus events`);

    let matched = 0;
    let inserted = 0;
    const matchedCanvasIds = new Set<string>();

    // 7. Run Claude matching if both lists are non-empty
    if (canvasAssignments.length > 0 && syllabusEvents.length > 0) {
      const canvasList = canvasAssignments.map(a => ({
        id: String(a.id),
        name: a.name,
        due_date: a.due_at ? isoToDate(a.due_at) : null,
      }));
      const eventList = syllabusEvents.map(e => ({ id: e.id, title: e.title, date: e.date }));

      const matchingResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        temperature: 0,
        system: MATCHING_SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: `Match these Canvas assignments to syllabus course events.\n\nCanvas assignments:\n${JSON.stringify(canvasList, null, 2)}\n\nSyllabus course events:\n${JSON.stringify(eventList, null, 2)}`,
        }],
      });

      const rawOutput = matchingResponse.content[0].type === "text" ? matchingResponse.content[0].text : "";
      console.log(`[match-canvas] claude tokens=${matchingResponse.usage?.output_tokens}`);

      let matchResult: MatchResult;
      try {
        const cleaned = rawOutput.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
        matchResult = JSON.parse(cleaned);
      } catch (e) {
        throw new Error(`Failed to parse matching response: ${(e as Error).message}`);
      }

      // 8. Apply high/medium confidence matches
      const updatePromises = (matchResult.matches ?? [])
        .filter(m => m.confidence !== "low")
        .map(m => {
          const assignment = canvasAssignments.find(a => String(a.id) === m.canvas_assignment_id);
          if (!assignment) return null;
          matchedCanvasIds.add(m.canvas_assignment_id);

          const updateData: Record<string, unknown> = {
            canvas_assignment_id: m.canvas_assignment_id,
            canvas_matched_at: new Date().toISOString(),
            source: "canvas_matched",
            canvas_metadata: {
              points_possible: assignment.points_possible ?? null,
              submission_types: assignment.submission_types ?? [],
              assignment_group: assignment.assignment_group?.name ?? null,
              description_summary: assignment.description ? stripHtml(assignment.description).slice(0, 500) || null : null,
              canvas_url: assignment.html_url ?? null,
              unlock_at: assignment.unlock_at ? assignment.unlock_at.split('T')[0] : null,
              allowed_attempts: assignment.allowed_attempts ?? null,
              time_limit: assignment.time_limit ?? null,
            },
          };
          if (assignment.due_at) updateData.date = isoToDate(assignment.due_at);

          return supabaseService
            .from("course_events")
            .update(updateData)
            .eq("id", m.course_event_id)
            .eq("course_id", course_id);
        })
        .filter(Boolean);

      await Promise.all(updatePromises);
      matched = updatePromises.length;
      console.log(`[match-canvas] updated ${matched} matched events`);
    }

    // 9. Insert unmatched Canvas assignments as canvas-only events
    const insertRows = canvasAssignments
      .filter(a => !matchedCanvasIds.has(String(a.id)))
      .map(a => ({
        course_id,
        user_id: user.id,
        title: a.name,
        date: a.due_at ? isoToDate(a.due_at) : null,
        type: "deadline",
        source: "canvas",
        canvas_only: true,
        canvas_assignment_id: String(a.id),
        canvas_matched_at: new Date().toISOString(),
        canvas_metadata: {
          points_possible: a.points_possible ?? null,
          submission_types: a.submission_types ?? [],
          assignment_group: a.assignment_group?.name ?? null,
          description_summary: a.description ? stripHtml(a.description).slice(0, 500) || null : null,
          canvas_url: a.html_url ?? null,
          unlock_at: a.unlock_at ? a.unlock_at.split('T')[0] : null,
          allowed_attempts: a.allowed_attempts ?? null,
          time_limit: a.time_limit ?? null,
        },
      }));

    if (insertRows.length > 0) {
      const { error: insertErr } = await supabaseService.from("course_events").insert(insertRows);
      if (insertErr) {
        console.error(`[match-canvas] insert error:`, insertErr);
      } else {
        inserted = insertRows.length;
        console.log(`[match-canvas] inserted ${inserted} canvas-only events`);
      }
    }

    // 10. Log to claude_api_logs
    await supabaseService.from("claude_api_logs").insert({
      user_id: user.id,
      course_id,
      model: "match-canvas-assignments",
      status: "success",
      output: JSON.stringify({ matched, inserted }),
      error_message: null,
    });

    return json({ success: true, matched, inserted });
  } catch (err) {
    console.error("[match-canvas] unexpected error:", err);
    // Best-effort error log — don't let this throw
    try {
      const authHeader = req.headers.get("Authorization");
      const body = await req.clone().json().catch(() => ({}));
      const supabaseUser = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader ?? "" } } }
      );
      const { data: { user } } = await supabaseUser.auth.getUser();
      if (user) {
        await supabaseService.from("claude_api_logs").insert({
          user_id: user.id,
          course_id: body.course_id ?? null,
          model: "match-canvas-assignments",
          status: "error",
          output: null,
          error_message: err instanceof Error ? err.message : String(err),
        });
      }
    } catch {
      // ignore logging failure
    }
    return json({ success: true, skipped: true, reason: "error" });
  }
});
