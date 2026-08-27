import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.3";

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

// ── Helpers (unchanged from original) ──────────────────────────────────────

function detectQueryType(message: string): string {
  const lower = message.toLowerCase();
  const dateKeywords = ["due", "today", "tomorrow", "this week", "next week", "monday", "tuesday", "wednesday", "thursday", "friday", "deadline", "exam", "quiz", "when is", "what's on"];
  const scheduleKeywords = ["class", "meet", "miss", "skip class", "office hours", "location", "room"];
  const gradingKeywords = ["worth", "grade", "points", "percent", "drop", "weight", "gpa", "final grade", "can i skip", "need on"];
  const policyKeywords = ["late", "policy", "ai", "artificial intelligence", "extra credit", "attendance", "absence", "extension", "integrity", "cheat"];
  if (dateKeywords.some(k => lower.includes(k))) return "date";
  if (policyKeywords.some(k => lower.includes(k))) return "policy";
  if (gradingKeywords.some(k => lower.includes(k))) return "grading";
  if (scheduleKeywords.some(k => lower.includes(k))) return "schedule";
  return "general";
}

function extractDateRange(message: string): { start: string; end: string; isSpecific: boolean } {
  const lower = message.toLowerCase();
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  // Check multi-word phrases FIRST — "next week" and "this week" must be matched
  // before "today" so that messages like "What's due next week? Today is March 5th"
  // don't erroneously collapse to a single-day range.
  if (lower.includes("next week")) {
    const start = new Date(today); start.setDate(today.getDate() + (7 - today.getDay() + 1));
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return { start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0], isSpecific: true };
  }
  if (lower.includes("this week")) {
    const end = new Date(today); end.setDate(today.getDate() + (7 - today.getDay()));
    return { start: todayStr, end: end.toISOString().split("T")[0], isSpecific: true };
  }
  if (lower.includes("tomorrow")) {
    const d = new Date(today); d.setDate(d.getDate() + 1);
    const s = d.toISOString().split("T")[0];
    return { start: s, end: s, isSpecific: true };
  }
  if (lower.includes("today")) return { start: todayStr, end: todayStr, isSpecific: true };

  // No specific time keyword — caller should fall back to semester-wide range
  const nextWeek = new Date(today); nextWeek.setDate(today.getDate() + 7);
  return { start: todayStr, end: nextWeek.toISOString().split("T")[0], isSpecific: false };
}

function buildCourseContext(courses: any[], events: any[], queryType: string): string {
  if (!courses.length) return "No courses found for this query.";

  const courseSections = courses.map(c => {
    const header = `${c.name}${c.code ? ` (${c.code})` : ""}${c.professor ? ` — Prof. ${c.professor}` : ""}`;

    // Schedule
    const s = c.schedule || {};
    const days = (s.meeting_days || []).join(", ") || "TBD";
    const time = s.meeting_time ? `${s.meeting_time.start || ""}–${s.meeting_time.end || ""}` : "TBD";
    const schedule = `Meets: ${days} ${time} at ${s.location || "TBD"}`;

    // Grading
    const rules = c.grading_rules || {};
    const components = (rules.components || []).map((comp: any) =>
      `  - ${comp.name}: ${comp.weight}%${comp.drop_lowest ? ` (drop lowest ${comp.drop_lowest})` : ""}${comp.late_policy ? `, late: ${comp.late_policy}` : ""}`
    ).join("\n");
    const grading = components
      ? `${components}${rules.grading_scale ? `\n  Scale: ${rules.grading_scale}` : ""}`
      : "  Not available.";

    // Policies — all fields including other[]
    const p = c.policies || {};
    const policyLines = [
      p.attendance         ? `  Attendance: ${p.attendance}` : null,
      p.late_work          ? `  Late work: ${p.late_work}` : null,
      p.academic_integrity ? `  Academic integrity: ${p.academic_integrity}` : null,
      p.ai_policy          ? `  AI policy: ${p.ai_policy}` : null,
      p.technology         ? `  Technology: ${p.technology}` : null,
      p.recording          ? `  Recording: ${p.recording}` : null,
      ...(Array.isArray(p.other) ? p.other.map((o: string) => `  Other: ${o}`) : []),
    ].filter(Boolean);
    const policies = policyLines.length ? policyLines.join("\n") : "  Not available.";

    return `### ${header}\n**Schedule:** ${schedule}\n**Grading:**\n${grading}\n**Policies:**\n${policies}`;
  });

  const eventLabel = queryType === "date" ? "Events in requested date range" : "Upcoming events (next 30 days)";
  const eventsSection = events.length
    ? events.map(e => {
        const course = e.courses ? ` [${e.courses.code || e.courses.name}]` : "";
        const time = e.time ? ` at ${e.time}` : "";
        const low = e.confidence === "low" ? " (date approximate)" : "";
        return `- ${e.date}${time}${course}: ${e.title} (${e.type})${low}`;
      }).join("\n")
    : "  None found.";

  return `${courseSections.join("\n\n")}\n\n**${eventLabel}:**\n${eventsSection}`;
}