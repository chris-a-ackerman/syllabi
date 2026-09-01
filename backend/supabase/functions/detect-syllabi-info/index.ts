import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.3";
import { stripJsonFences } from "../_shared/strip-json-fences.ts";
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

const DETECT_SYSTEM_PROMPT = `Extract course and semester info from this syllabus. Output raw JSON only, no markdown fences.
{
  "course_name": "<string | null>",
  "course_code": "<string | null>",
  "semester_name": "<string | null>",
  "semester_start": "<YYYY-MM-DD | null>",
  "semester_end": "<YYYY-MM-DD | null>",
  "confidence": "<high | medium | low>"
}`;

// Bounds the fan-out: each path costs one Storage download and one Haiku call.
const MAX_FILE_PATHS = 10;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Verify JWT
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

    const { file_paths } = await req.json();
    if (!file_paths || !Array.isArray(file_paths) || file_paths.length === 0) {
      return new Response(JSON.stringify({ error: "file_paths array required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (file_paths.length > MAX_FILE_PATHS) {
      return new Response(
        JSON.stringify({ error: `At most ${MAX_FILE_PATHS} file_paths per request` }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Downloads below use the service-role Storage client, which bypasses the
    // syllabi bucket's owner-folder RLS. Enforce the same rule here — a path
    // must sit in the caller's own {user.id}/ folder — before anything is read.
    const isOwnedByCaller = (filePath: unknown): boolean => {
      if (typeof filePath !== "string") return false;
      const segments = filePath.split("/");
      return segments[0] === user.id && segments.every((segment) => segment !== "..");
    };

    if (!file_paths.every(isOwnedByCaller)) {
      return new Response(
        JSON.stringify({ error: "file_paths must be inside your own storage folder" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // One quota unit per file — each path costs a Storage download and a Haiku call.
    const quotaResponse = await enforceAiQuota(
      supabase,
      user.id,
      "detect-syllabi-info",
      corsHeaders,
      file_paths.length,
    );
    if (quotaResponse) return quotaResponse;

    // Process all files in parallel; partial failures are OK
    const settled = await Promise.allSettled(
      // deno-lint-ignore no-explicit-any
      file_paths.map(async (filePath: string): Promise<any> => {
        // Download from Storage
        const { data: fileData, error: fileError } = await supabase.storage
          .from("syllabi")
          .download(filePath);

        if (fileError || !fileData) {
          return { file_path: filePath, error: "Could not download file" };
        }

        // Base64 encode — same chunked approach as process-syllabus to avoid stack overflow
        const fileBuffer = await fileData.arrayBuffer();

        // Cost cap (SYL-29): skip oversized files before any base64 work or model call.
        if (fileBuffer.byteLength > MAX_SYLLABUS_BYTES) {
          return { file_path: filePath, error: "File is too large to analyze" };
        }

        const uint8Array = new Uint8Array(fileBuffer);
        let base64File = "";
        const chunkSize = 8192;
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          base64File += String.fromCharCode(...uint8Array.slice(i, i + chunkSize));
        }
        base64File = btoa(base64File);

        const isPDF = filePath.toLowerCase().endsWith(".pdf");
        const mediaType = isPDF ? "application/pdf" : "image/jpeg";

        // Call Claude Haiku — 25s timeout so one slow PDF never blocks the whole response
        const response = await anthropic.messages.create(
          {
            model: "claude-haiku-4-5-20251001",
            max_tokens: 256,
            temperature: 0,
            system: DETECT_SYSTEM_PROMPT,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "document",
                    source: {
                      type: "base64",
                      media_type: mediaType,
                      data: base64File,
                    },
                  },
                  {
                    type: "text",
                    text: "Extract course and semester info from this syllabus.",
                  },
                ],
              },
            ],
          },
          { timeout: 25000 },
        );

        const rawOutput = response.content[0].type === "text" ? response.content[0].text : "";

        let parsed;
        try {
          parsed = JSON.parse(stripJsonFences(rawOutput));
        } catch {
          return { file_path: filePath, error: "Could not parse Claude response" };
        }

        return {
          file_path: filePath,
          course_name: parsed.course_name ?? null,
          course_code: parsed.course_code ?? null,
          semester_name: parsed.semester_name ?? null,
          semester_start: parsed.semester_start ?? null,
          semester_end: parsed.semester_end ?? null,
          confidence: parsed.confidence ?? "low",
        };
      })
    );

    const results = settled.map((result, idx) => {
      if (result.status === "fulfilled") return result.value;
      // Detail stays server-side (SYL-31); clients get a generic per-file error.
      console.error(`detect-syllabi-info failed for a file:`, result.reason);
      return { file_path: file_paths[idx], error: "Could not analyze file" };
    });

    return new Response(
      JSON.stringify({ results }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (err) {
    // Detail stays server-side (SYL-31); clients get a generic message.
    console.error("detect-syllabi-info error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
