// agent-upcoming (SYL-92): read-only snapshot of the caller's active semester
// for an external agent — courses, concrete class sessions and dated
// course_events in the next `days` days (default 3, max 14), in the user's
// timezone.
//
//   GET /functions/v1/agent-upcoming?days=3
//   → { timezone, courses: [...], sessions: [...], events: [...] }
//
// Every read goes through the caller's JWT (RLS-scoped user client, same
// pattern as generate-ics); no service-role client exists here.
//
// Agent auth — the documented shortcut: the agent signs in as the user with
// Supabase email/password (`supabase.auth.signInWithPassword`) from its
// container, stores the refresh token under /data, and refreshes the session
// before each call, sending `Authorization: Bearer <access_token>`. That needs
// zero backend change and keeps this function on the standard in-handler
// Authorization + auth.getUser check (tests/unit/config-drift.test.ts).
// Upgrade path (out of scope for V1): an `agent_tokens` table of hashed,
// revocable tokens resolved with a service-role lookup.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS } from "../_shared/cors.ts";
import { addDays, expandSessions, localDate, parseDays, sortSessions, type Session } from "./expand.ts";

const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };
const DEFAULT_TIMEZONE = "America/New_York";

interface EventRow {
  course_id: string;
  date: string;
  time: string | null;
  title: string;
  type: string;
  category: string | null;
  confidence: string | null;
  source: string | null;
  canvas_metadata: { canvas_url?: string | null } | null;
  courses: { code: string | null } | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

serve(async (req) => {
  // verify_jwt is false so the CORS preflight passes; auth is enforced here.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
  if (authError || !user) return json({ error: "Unauthorized" }, 401);

  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  try {
    const days = parseDays(new URL(req.url).searchParams.get("days"));

    const { data: profile } = await supabaseUser
      .from("profiles_safe")
      .select("timezone")
      .maybeSingle();
    const timezone = profile?.timezone || DEFAULT_TIMEZONE;

    const today = localDate(new Date(), timezone);
    const windowEnd = addDays(today, days);

    const { data: semester, error: semesterError } = await supabaseUser
      .from("semesters")
      .select("id, start_date, end_date")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (semesterError) throw semesterError;
    if (!semester) return json({ timezone, courses: [], sessions: [], events: [] });

    const { data: courseRows, error: coursesError } = await supabaseUser
      .from("courses")
      .select("id, name, code, canvas_course_id, schedule, grading_rules, policies")
      .eq("semester_id", semester.id)
      .order("code");
    if (coursesError) throw coursesError;
    const courses = courseRows ?? [];
    const courseIds = courses.map((c) => c.id);

    let eventRows: EventRow[] = [];
    if (courseIds.length > 0) {
      const { data, error } = await supabaseUser
        .from("course_events")
        .select("course_id, date, time, title, type, category, confidence, source, canvas_metadata, courses(code)")
        .in("course_id", courseIds)
        .gte("date", today)
        .lte("date", windowEnd)
        .order("date")
        .order("time");
      if (error) throw error;
      eventRows = (data ?? []) as unknown as EventRow[];
    }

    // Class meetings only happen inside the semester itself.
    const sessionStart = semester.start_date && semester.start_date > today ? semester.start_date : today;
    const sessionEnd = semester.end_date && semester.end_date < windowEnd ? semester.end_date : windowEnd;

    const sessions: Session[] = [];
    for (const course of courses) {
      const noClassDates = eventRows
        .filter((e) => e.course_id === course.id && e.type === "no_class")
        .map((e) => e.date);
      sessions.push(
        ...expandSessions({
          course_id: course.id,
          code: course.code,
          schedule: course.schedule,
          start: sessionStart,
          end: sessionEnd,
          noClassDates,
        })
      );
    }

    const events = eventRows.map((e) => ({
      course_id: e.course_id,
      code: e.courses?.code ?? null,
      date: e.date,
      time: e.time,
      title: e.title,
      type: e.type,
      category: e.category,
      confidence: e.confidence,
      source: e.source,
      canvas_url: e.canvas_metadata?.canvas_url ?? null,
    }));

    return json({
      timezone,
      courses: courses.map((c) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        canvas_course_id: c.canvas_course_id,
        schedule: c.schedule,
        grading_rules: c.grading_rules,
        policies: c.policies,
      })),
      sessions: sortSessions(sessions),
      events,
    });
  } catch (err) {
    // Detail stays server-side (SYL-31); clients get a generic message.
    console.error("agent-upcoming error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
