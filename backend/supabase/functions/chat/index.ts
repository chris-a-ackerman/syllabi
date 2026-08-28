import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.3";
import { buildCourseContext, detectQueryType, extractDateRange } from "./query.ts";

const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Service-role client for reading app_settings (not user-scoped)
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CHAT_SYSTEM_PROMPT = `You are a helpful academic assistant for a student. You answer questions about their courses, assignments, schedules, and deadlines based only on the course data provided.

Guidelines:
- Be concise and direct — students want quick answers
- If an event has confidence "low", mention the date might not be exact
- If asked "can I skip X?", check drop_lowest in the grading rules and give a clear yes/no with reasoning
- If student notes are provided, treat them as reliable supplemental information from the student themselves
- If you don't have enough data to answer confidently, say so and explain what's missing
- Format dates in a friendly way (e.g., "Friday, March 14" not "2026-03-14")
- Never make up information not present in the provided data
- When referencing policies, reproduce the exact wording — do not paraphrase numbers, conditions, or requirements (e.g., if a policy says "all 3 guest lectures", do not write "one of the 3 guest lectures")`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }

  // ── 1. Kill switch check (server-side enforcement) ──────────────────────
  const { data: settings } = await supabaseAdmin
    .from("app_settings")
    .select("ai_enabled")
    .eq("id", "global")
    .single();

  if (!settings?.ai_enabled) {
    return new Response(
      JSON.stringify({ error: "AI features are temporarily disabled." }),
      { status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // User-scoped client (respects RLS)
  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  try {
    const {
      message,
      semester_id,
      conversation_history = [],
      course_notes = [],   // array of { body, courses: { name, code } }
      course_ids = [],     // selected course IDs to scope responses
    } = await req.json();

    if (!message || !semester_id) {
      return new Response(
        JSON.stringify({ error: "message and semester_id required" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const queryType = detectQueryType(message);
    const hasCourseFilter = course_ids.length > 0;

    // ── 1. Fetch semester dates + full course context in parallel ──────────
    const [semesterResult, coursesResult] = await Promise.all([
      supabaseUser.from("semesters").select("start_date, end_date").eq("id", semester_id).single(),
      (() => {
        let q = supabaseUser
          .from("courses")
          .select("id, name, code, professor, syllabus_analysis->schedule, syllabus_analysis->grading_rules, syllabus_analysis->policies")
          .eq("semester_id", semester_id);
        if (hasCourseFilter) q = q.in("id", course_ids);
        return q;
      })(),
    ]);

    const courses = coursesResult.data;
    const semesterStart = semesterResult.data?.start_date;
    const semesterEnd   = semesterResult.data?.end_date;

    // ── 2. Fetch events scoped to these courses ───────────────────────────
    // Use course IDs from the DB result so event filtering is always exact,
    // regardless of what the client passed.
    const effectiveCourseIds = (courses || []).map((c: any) => c.id);

    let events: any[] = [];
    if (effectiveCourseIds.length > 0) {
      const today = new Date().toISOString().split("T")[0];
      const thirtyDaysOut = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

      let dateRange: { start: string; end: string };
      if (queryType === "date") {
        const extracted = extractDateRange(message);
        if (extracted.isSpecific) {
          // "today", "this week", etc. — use the narrow window
          dateRange = extracted;
        } else {
          // Named event lookup ("When is Quiz 4?") — search the full semester
          // so past events and far-future events are both reachable.
          dateRange = {
            start: semesterStart || new Date(Date.now() - 180 * 86400000).toISOString().split("T")[0],
            end:   semesterEnd   || new Date(Date.now() + 180 * 86400000).toISOString().split("T")[0],
          };
        }
      } else {
        dateRange = { start: today, end: thirtyDaysOut };
      }

      console.log("[chat] effectiveCourseIds:", effectiveCourseIds);
      console.log("[chat] dateRange:", dateRange);

      const { data: eventsData, error: eventsError } = await supabaseUser
        .from("course_events")
        .select("date, time, title, type, category, confidence, courses(name, code)")
        .in("course_id", effectiveCourseIds)
        .gte("date", dateRange.start)
        .lte("date", dateRange.end)
        .order("date")
        .order("time");

      if (eventsError) console.error("[chat] events query error:", eventsError);
      console.log("[chat] eventsData count:", eventsData?.length ?? 0);

      events = eventsData || [];
    }

    // ── 3. Build unified context ──────────────────────────────────────────
    const todayForContext = new Date().toISOString().split("T")[0];
    let contextData = `Today's date: ${todayForContext}\n\n` + buildCourseContext(courses || [], events, queryType);

    // ── 2. Append course notes to context ──────────────────────────────────
    if (course_notes.length > 0) {
      const notesText = course_notes
        .map((n: any) => {
          const courseLabel = n.courses?.code || n.courses?.name || "Unknown course";
          return `[${courseLabel}] ${n.body}`;
        })
        .join("\n");
      contextData += `\n\nStudent notes (added by the student, treat as reliable):\n${notesText}`;
    }

    const messages = [
      ...conversation_history,
      {
        role: "user" as const,
        content: `Student question: ${message}\n\n---\nCourse data:\n${contextData}`,
      },
    ];

    const { data: { user } } = await supabaseUser.auth.getUser();

    const response = await anthropic.messages.create({
      //model: "claude-haiku-4-5-20251001",
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      temperature: 0, // extraction task — deterministic output
      system: CHAT_SYSTEM_PROMPT,
      messages,
    });

    const reply = response.content[0].type === "text" ? response.content[0].text : "";

    // Log the API call (mirrors process-syllabus pattern)
    const { error: logError } = await supabaseAdmin.from("claude_api_logs").insert({
      user_id: user?.id ?? null,
      course_id: null,
      model: response.model,
      status: "success",
      input: JSON.stringify({ system: CHAT_SYSTEM_PROMPT, messages }),
      output: reply,
      error_message: null,
      input_tokens: response.usage?.input_tokens ?? null,
      output_tokens: response.usage?.output_tokens ?? null,
    });
    if (logError) console.error("Log insert error:", logError);

    return new Response(
      JSON.stringify({
        reply,
        query_type: queryType,
        assistant_message: { role: "assistant", content: reply },
      }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("chat error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
});

