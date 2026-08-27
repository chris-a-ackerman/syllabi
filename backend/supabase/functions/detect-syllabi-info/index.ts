import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.3";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
          const cleaned = rawOutput
            .replace(/^[\s\S]*?```json\n?/, "")
            .replace(/\n?```[\s\S]*$/, "")
            .trim();
          parsed = JSON.parse(cleaned);
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
      return { file_path: file_paths[idx], error: result.reason?.message ?? "Unknown error" };
    });

    return new Response(
      JSON.stringify({ results }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (err) {
    console.error("detect-syllabi-info error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
