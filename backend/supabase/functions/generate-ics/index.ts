import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { escapeICS, formatICSDate } from "./ics.ts";
import { CORS_HEADERS } from "../_shared/cors.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SERVICE_ROLE_KEY")!
);

serve(async (req) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS_HEADERS });
  }

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  try {
    const url = new URL(req.url);
    const semesterId = url.searchParams.get("semester_id");
    const courseId = url.searchParams.get("course_id"); // optional: filter to one course

    if (!semesterId) {
      return new Response(JSON.stringify({ error: "semester_id required" }), { status: 400, headers: CORS_HEADERS });
    }

    // Fetch events with course info
    let query = supabaseUser
      .from("course_events")
      .select("*, courses(name, code)")
      .not("date", "is", null)
      .order("date");

    if (courseId) {
      query = query.eq("course_id", courseId);
    } else {
      query = query.eq("courses.semester_id", semesterId);
    }

    const { data: events, error } = await query;

    if (error) throw error;

    // Build ICS content
    const icsLines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Syllabus Chatbot//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
    ];

    for (const event of events || []) {
      const course = event.courses;
      const courseName = course?.code || course?.name || "Course";
      const dtstart = formatICSDate(event.date, event.time);
      const dtend = formatICSDate(event.date, event.time, true);
      const uid = `${event.id}@syllabuschatbot`;
      const summary = `${event.title} [${courseName}]`;
      const description = `Type: ${event.type}${event.category ? `\\nCategory: ${event.category}` : ""}`;

      const isAllDay = !dtstart.includes("T");
      icsLines.push(
        "BEGIN:VEVENT",
        `UID:${uid}`,
        isAllDay ? `DTSTART;VALUE=DATE:${dtstart}` : `DTSTART:${dtstart}`,
        isAllDay ? `DTEND;VALUE=DATE:${dtend}` : `DTEND:${dtend}`,
        `SUMMARY:${escapeICS(summary)}`,
        `DESCRIPTION:${escapeICS(description)}`,
        "END:VEVENT"
      );
    }

    icsLines.push("END:VCALENDAR");
    const icsContent = icsLines.join("\r\n");

    // Store ICS in Supabase Storage
    const { data: { user } } = await supabaseUser.auth.getUser();
    const storagePath = `calendars/${user?.id}/${courseId ?? semesterId}.ics`;
    const { error: storageError } = await supabaseAdmin.storage
      .from("syllabi")
      .upload(storagePath, new Blob([icsContent], { type: "text/calendar" }), {
        upsert: true,
        contentType: "text/calendar; charset=utf-8",
      });
    if (storageError) {
      console.error("Storage upload error:", storageError);
    }

    return new Response(icsContent, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="schedule.ics"`,
      },
    });
  } catch (err) {
    // Detail stays server-side (SYL-31); clients get a generic message.
    console.error("generate-ics error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: CORS_HEADERS });
  }
});