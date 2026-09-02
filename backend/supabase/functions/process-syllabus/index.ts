import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.3";
import { mapAnalysisToCourseUpdate, mapEventsToRows, stripJsonFences } from "./parse.ts";
import { type CourseEventsClient, type ReplaceCourseEventsResult, replaceCourseEvents } from "./events.ts";
import { enforceAiQuota } from "../_shared/ai-quota.ts";
import { MAX_SYLLABUS_BYTES } from "../_shared/ai-limits.ts";
import { CORS_HEADERS as corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SERVICE_ROLE_KEY")!
);

const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
});

// The full prompt from Syllabus_Agent_Instructions_v2.md
const SYLLABUS_SYSTEM_PROMPT = `You are a syllabus parsing agent. Extract structured information from the provided course syllabus and return it as valid JSON matching the schema exactly. Do not wrap your response in markdown code fences. Output raw JSON only, starting with { and ending with }

Your output must be a single JSON object with these top-level keys:
course_id, analysis_timestamp, parse_successful, course, schedule, events, recurring_patterns, grading_rules, policies, extraction_quality.

Key rules:
- Convert all relative dates (e.g., "Week 5") to YYYY-MM-DD using the semester_start_date provided
- Every events[].category must match a grading_rules.components[].name exactly
- Generate ALL recurring event instances as individual entries in the events array
- All times in 24-hour HH:MM format
- Every events[].type must be one of: 'deadline', 'exam', 'quiz', 'presentation', 'project_due', 'no_class', 'other'. Use 'other' if no type fits
- Return ONLY valid JSON with no markdown, no preamble, no explanation`;

// Revised prompt with an explicit schema template to eliminate field-name drift across runs.
// Swap `SYLLABUS_SYSTEM_PROMPT` → `SYLLABUS_SYSTEM_PROMPT_NEW` in the messages.create call
// and add `temperature: 0` to maximize output consistency.
const SYLLABUS_SYSTEM_PROMPT_NEW = `You are a syllabus parsing agent. Extract structured information from the provided course syllabus and return it as valid JSON. Output raw JSON only — no markdown code fences, no preamble, no explanation. Your output must start with { and end with }.

Your output must be a single JSON object matching this exact schema. Use null for any optional field that is absent — never omit a key, never use an empty string in place of null.

{
  "course_id": "<copy exactly from user message>",
  "analysis_timestamp": "<ISO 8601 UTC timestamp>",
  "parse_successful": true,
  "course": {
    "code": "<string | null>",
    "title": "<string>",
    "credits": "<number | null>",
    "semester": "<string | null>",
    "location": "<primary classroom string | null>",
    "description": "<string | null>",
    "prerequisites": "<string | null>",
    "meeting_days": ["<day of week>"],
    "meeting_times": { "start": "<HH:MM | null>", "end": "<HH:MM | null>" },
    "instructor": {
      "name": "<string | null>",
      "email": "<string | null>",
      "office": "<string | null>",
      "office_hours": "<string | null>"
    }
  },
  "schedule": {
    "semester_start": "<YYYY-MM-DD>",
    "semester_end": "<YYYY-MM-DD>",
    "total_weeks": "<number | null>",
    "finals_period_start": "<YYYY-MM-DD | null>",
    "finals_period_end": "<YYYY-MM-DD | null>",
    "breaks": [{ "name": "<string>", "start_date": "<YYYY-MM-DD>", "end_date": "<YYYY-MM-DD>" }],
    "notes": "<string | null>"
  },
  "grading_rules": {
    "components": [
      {
        "name": "<string>",
        "weight": "<decimal 0–1, e.g. 0.15 for 15%>",
        "count": "<number | null>",
        "description": "<string | null>",
        "drop_lowest": "<number, default 0>"
      }
    ],
    "late_policy": "<string | null>",
    "grading_scale": "<string | null>"
  },
  "events": [
    {
      "event_id": "<string, sequential e.g. evt-001>",
      "date": "<YYYY-MM-DD — resolve ALL relative dates using semester_start_date>",
      "title": "<string>",
      "type": "<one of: deadline | exam | quiz | presentation | project_due | no_class | other>",
      "category": "<must exactly match a grading_rules.components[].name>",
      "description": "<string | null>",
      "location": "<string | null>",
      "time_start": "<HH:MM | null>",
      "time_end": "<HH:MM | null>",
      "weight": "<decimal 0–1 | null — only for graded events, matches grading component weight>",
      "is_recurring_instance": false,
      "confidence": "<high | medium | low>"
    }
  ],
  "recurring_patterns": [
    {
      "pattern_id": "<string, e.g. pat-001>",
      "description": "<string>",
      "day_of_week": "<single day string>",
      "frequency": "<weekly | biweekly | monthly | irregular>",
      "time_start": "<HH:MM | null>",
      "time_end": "<HH:MM | null>",
      "location": "<string | null>",
      "exceptions": ["<YYYY-MM-DD>"]
    }
  ],
  "policies": {
    "attendance": "<string | null>",
    "late_work": "<string | null>",
    "academic_integrity": "<string | null>",
    "technology": "<string | null>",
    "ai_policy": "<string | null>",
    "recording": "<string | null>",
    "other": ["<one string per distinct miscellaneous policy>"]
  },
  "extraction_quality": {
    "confidence_score": "<number 0–1>",
    "missing_fields": ["<field path that could not be extracted>"],
    "ambiguous_fields": ["<field path with uncertain value>"],
    "notes": ["<one string per notable extraction decision>"]
  }
}

Strict rules:
- Use null (not "") for absent optional values; never omit a key from the schema
- policies.other and extraction_quality.notes and extraction_quality.missing_fields and extraction_quality.ambiguous_fields must always be arrays (use [] if empty)
- grading_rules.components[].weight must be a decimal (0.15, not 15); all weights must sum to 1.0
- events[].category must exactly match one grading_rules.components[].name — character for character
- events[].type must be exactly one of: deadline, exam, quiz, presentation, project_due, no_class, other
- events[].confidence must be exactly one of: high, medium, low
- All dates in YYYY-MM-DD; all times in 24-hour HH:MM; if meeting_times are not explicitly stated in the syllabus, set both start and end to null — never use 00:00 as a placeholder
- Resolve ALL relative dates (e.g. "Week 5", "next Tuesday") to YYYY-MM-DD using the semester_start_date in the user message
- Generate every course event as an individual entry in events[] — classes, deadlines, exams, no-class days, optional sessions
- recurring_patterns[].exceptions must be an array of YYYY-MM-DD strings (never descriptive text)`;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Verify JWT manually (since verify_jwt = false to allow OPTIONS through)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    console.log(`[process-syllabus][auth] user_id=${user.id}`);

    const bodyText = await req.text();
    console.log("[process-syllabus] method:", req.method, "| content-type:", req.headers.get("content-type"), "| body:", bodyText.slice(0, 200));

    if (!bodyText) {
      return new Response(JSON.stringify({ error: "Empty request body" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const { course_id } = JSON.parse(bodyText);

    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const quotaResponse = await enforceAiQuota(supabase, user.id, "process-syllabus", corsHeaders);
    if (quotaResponse) return quotaResponse;

    // 1. Fetch course + semester data.
    // Scoped to the caller: this is a service-role client, so without the
    // user_id filter any authenticated user could reprocess anyone's course.
    const { data: course, error: courseError } = await supabase
      .from("courses")
      .select("*, semesters(name, start_date, end_date)")
      .eq("id", course_id)
      .eq("user_id", user.id)
      .single();

    if (courseError || !course) {
      return new Response(JSON.stringify({ error: "Course not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    console.log(`[process-syllabus][course] id=${course.id} | name=${course.name} | analysis_status=${course.analysis_status}`);
    console.log(`[process-syllabus][course] syllabus_file_path=${course.syllabus_file_path} | syllabus_file_name=${course.syllabus_file_name}`);
    console.log(`[process-syllabus][semester] name=${course.semesters.name} | start=${course.semesters.start_date} | end=${course.semesters.end_date}`);

    // 2. Mark as processing
    await supabase
      .from("courses")
      .update({ analysis_status: "processing" })
      .eq("id", course_id);

    // 3. Download syllabus file from Storage
    const { data: fileData, error: fileError } = await supabase.storage
      .from("syllabi")
      .download(course.syllabus_file_path);

    if (fileError || !fileData) {
      await supabase
        .from("courses")
        .update({ analysis_status: "failed", analysis_error: "Could not retrieve syllabus file" })
        .eq("id", course_id);
      return new Response(JSON.stringify({ error: "File not found" }), { status: 404, headers: corsHeaders });
    }

    // 4. Convert file for Claude
    const fileBuffer = await fileData.arrayBuffer();

    // Cost cap (SYL-29): refuse oversized files before any base64 work or model call.
    if (fileBuffer.byteLength > MAX_SYLLABUS_BYTES) {
      await supabase
        .from("courses")
        .update({
          analysis_status: "failed",
          analysis_error: "Syllabus file exceeds the maximum size for analysis",
        })
        .eq("id", course_id);
      return new Response(JSON.stringify({ error: "Syllabus file is too large to analyze" }), {
        status: 413,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const uint8Array = new Uint8Array(fileBuffer);
    const fileNameForCheck = course.syllabus_file_name ?? course.syllabus_file_path ?? "";
    const isPDF = fileNameForCheck.toLowerCase().endsWith(".pdf") || fileData.type === "application/pdf";
    console.log(`[process-syllabus][file] downloaded OK | bytes=${fileBuffer.byteLength} | isPDF=${isPDF} | name_check="${fileNameForCheck}" | blob_type="${fileData.type}"`);

    // 5. Build user message with context
    const userMessage = `Parse this syllabus for course_id: "${course_id}".

Semester context:
- Semester name: ${course.semesters.name}
- Semester start date: ${course.semesters.start_date}
- Semester end date: ${course.semesters.end_date}

Return the complete JSON analysis as specified.`;

    // Build content blocks — PDFs go as base64 documents; HTML/text goes inline as text
    let contentBlocks: unknown[];
    if (isPDF) {
      let base64File = "";
      const chunkSize = 8192;
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        base64File += String.fromCharCode(...uint8Array.slice(i, i + chunkSize));
      }
      base64File = btoa(base64File);
      contentBlocks = [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64File },
        },
        { type: "text", text: userMessage },
      ];
    } else {
      // HTML or other text format — decode and pass as text
      const syllabusText = new TextDecoder().decode(uint8Array);
      contentBlocks = [
        { type: "text", text: `Syllabus content:\n\n${syllabusText}` },
        { type: "text", text: userMessage },
      ];
    }

    console.log(`[process-syllabus][claude] sending | isPDF=${isPDF} | content_blocks=${contentBlocks.length} | user_message_preview=${userMessage.slice(0, 200)}`);

    // 6. Call Claude with the document
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      temperature: 0,
      system: SYLLABUS_SYSTEM_PROMPT_NEW,
      messages: [
        {
          role: "user",
          // deno-lint-ignore no-explicit-any
          content: contentBlocks as any,
        },
      ],
    });

    // 7. Parse Claude's response
    const rawOutput = response.content[0].type === "text" ? response.content[0].text : "";
    console.log(`[process-syllabus][claude] response | model=${response.model} | input_tokens=${response.usage?.input_tokens} | output_tokens=${response.usage?.output_tokens} | stop_reason=${response.stop_reason}`);

    let analysisJson;
    try {
      // Strip any accidental markdown code fences
      analysisJson = JSON.parse(stripJsonFences(rawOutput));
      console.log(`[process-syllabus][parse] parse_successful=${analysisJson.parse_successful} | events_count=${analysisJson.events?.length ?? 0} | confidence=${analysisJson.extraction_quality?.confidence_score} | missing_fields=${JSON.stringify(analysisJson.extraction_quality?.missing_fields ?? [])}`);
      console.log(`[process-syllabus][parse] course_title="${analysisJson.course?.title}" | code="${analysisJson.course?.code}" | instructor="${analysisJson.course?.instructor?.name}"`);
    } catch (parseError) {
      await supabase
        .from("courses")
        .update({
          analysis_status: "failed",
          analysis_error: `JSON parse failed: ${parseError.message}`,
        })
        .eq("id", course_id);
      return new Response(JSON.stringify({ error: "Failed to parse Claude response" }), { status: 500, headers: corsHeaders });
    }

    // 8. Replace course_events — insert the new rows first, delete the stale
    // ones only once that succeeds (SYL-60). The old delete-then-insert order
    // let one rejected row (e.g. an unnormalised time) fail the insert *after*
    // the prior events were already gone, leaving the course with zero events
    // while the response still reported success. The course row (analysis
    // blob + analysis_status = "complete") is written only after this step
    // succeeds, so a failed rewrite never pairs a new grading_rules blob with
    // old events or leaves a course reporting "complete" with events it never
    // received.
    const events = analysisJson.events || [];
    let replaceResult: ReplaceCourseEventsResult;
    try {
      const eventRows = mapEventsToRows(events, course_id, course.user_id);

      const nullDateCount = eventRows.filter((e: any) => !e.date).length;
      console.log(`[process-syllabus][events] mapped ${eventRows.length} rows | null_dates=${nullDateCount}`);
      if (eventRows.length > 0) {
        console.log(`[process-syllabus][events] first_3=${JSON.stringify(eventRows.slice(0, 3).map((e: any) => ({ title: e.title, date: e.date, type: e.type })))}`);
      }

      const replaceStart = Date.now();
      // Cast: structurally checking the real (deeply generic) SupabaseClient
      // type against the minimal CourseEventsClient interface blows up
      // TypeScript's instantiation depth (TS2589). The real client already
      // satisfies the few methods this module calls.
      replaceResult = await replaceCourseEvents(supabase as unknown as CourseEventsClient, course_id, eventRows);
      console.log(`[process-syllabus][events] replaceCourseEvents ok=${replaceResult.ok} inserted=${replaceResult.inserted} deleted=${replaceResult.deleted ?? "n/a"} stage=${replaceResult.stage ?? "n/a"} | ${Date.now() - replaceStart}ms`);
    } catch (err) {
      // e.g. a null entry in analysisJson.events. Anything thrown here must
      // surface as a failed analysis, not fall through to the generic 500
      // with the course left on "processing".
      replaceResult = { ok: false, stage: "map", inserted: 0, error: err };
    }

    if (!replaceResult.ok) {
      const errObj = replaceResult.error as { message?: string } | null | undefined;
      const errorMessage = errObj?.message ?? JSON.stringify(replaceResult.error);
      console.error(`[process-syllabus][events] course_events ${replaceResult.stage} failed:`, replaceResult.error);

      await supabase
        .from("courses")
        .update({
          analysis_status: "failed",
          analysis_error: `course_events ${replaceResult.stage} failed: ${errorMessage}`,
        })
        .eq("id", course_id);

      const { error: logError } = await supabase.from("claude_api_logs").insert({
        user_id: course.user_id,
        course_id,
        model: response.model,
        status: "error",
        output: rawOutput,
        error_message: `course_events ${replaceResult.stage} failed: ${errorMessage}`,
        input_tokens: response.usage?.input_tokens ?? null,
        output_tokens: response.usage?.output_tokens ?? null,
      });
      if (logError) {
        console.error("[process-syllabus][db] Log insert error:", logError);
      }

      return new Response(
        JSON.stringify({ success: false, error: "Failed to save course events" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    // 9. Store full analysis on course, update basic fields + extracted
    // columns, and mark the analysis complete — only now that the events are in.
    const {
      name: courseName,
      code: courseCode,
      professor: courseProfessor,
      schedule: scheduleData,
    } = mapAnalysisToCourseUpdate(analysisJson, course);

    await supabase
      .from("courses")
      .update({
        syllabus_analysis: analysisJson,
        policies: analysisJson.policies ?? null,
        grading_rules: analysisJson.grading_rules ?? null,
        schedule: scheduleData,
        analysis_status: "complete",
        name: courseName,
        code: courseCode,
        professor: courseProfessor,
        updated_at: new Date().toISOString(),
      })
      .eq("id", course_id);

    console.log(`[process-syllabus][db] course updated | name="${courseName}" | code="${courseCode}" | professor="${courseProfessor}"`);

    // 10. Log the Claude API call
    const { error: logError } = await supabase.from("claude_api_logs").insert({
      user_id: course.user_id,
      course_id,
      model: response.model,
      status: "success",
      output: rawOutput,
      error_message: null,
      input_tokens: response.usage?.input_tokens ?? null,
      output_tokens: response.usage?.output_tokens ?? null,
    });
    if (logError) {
      console.error("Log insert error:", logError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        course_id,
        events_created: replaceResult.inserted,
        parse_successful: analysisJson.parse_successful,
        completeness: analysisJson.extraction_quality?.completeness,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (err) {
    // Detail stays server-side (SYL-31); clients get a generic message.
    console.error("process-syllabus error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});