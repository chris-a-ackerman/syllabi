// supabase/functions/find-canvas-syllabus/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.3";
import { assertSafeCanvasUrl, UnsafeCanvasUrlError } from "../_shared/canvas-url.ts";
import { enforceAiQuota } from "../_shared/ai-quota.ts";
import { CORS_HEADERS } from "../_shared/cors.ts";
import { CanvasTokenExpiredError, SYSTEM_PROMPT, TOOLS, executeTools } from "./tools.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

const supabaseService = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const anthropic = new Anthropic({
  apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
});

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
    let body: Record<string, string>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Request body must be valid JSON." }, 400);
    }
    const { course_id, canvas_course_id } = body;
    if (!course_id || !canvas_course_id) {
      return json({ error: "course_id and canvas_course_id are required." }, 400);
    }

    const quotaResponse = await enforceAiQuota(supabaseService, user.id, "find-canvas-syllabus", CORS_HEADERS);
    if (quotaResponse) return quotaResponse;

    // 3. Fetch Canvas token + base URL in parallel
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
      return json({ error: "No Canvas token found. Please connect Canvas first." }, 400);
    }

    let allowedHost: string;
    try {
      allowedHost = (await assertSafeCanvasUrl(canvasBaseUrl)).hostname;
    } catch (err) {
      if (err instanceof UnsafeCanvasUrlError) {
        return json({ error: `Stored Canvas URL is not usable: ${err.message}` }, 400);
      }
      throw err;
    }

    // 4. Fetch course + semester
    const { data: courseData, error: courseError } = await supabaseService
      .from("courses")
      .select("*, semesters(start_date, end_date)")
      .eq("id", course_id)
      .eq("user_id", user.id)
      .single();

    if (courseError || !courseData) {
      return json({ error: "Course not found." }, 404);
    }

    const course = courseData as {
      name: string;
      code: string | null;
      semesters: { start_date: string; end_date: string } | null;
    };

    // Mark find_syllabus as running
    await supabaseService
      .from("courses")
      .update({
        canvas_sync_status: { ...(courseData.canvas_sync_status ?? {}), find_syllabus: "running" },
      })
      .eq("id", course_id);

    // 5. Agentic loop
    type FoundInput = {
      source_type: "file" | "html" | "page";
      file_url?: string | null;
      file_name?: string | null;
      html_content?: string | null;
      confidence: "high" | "medium";
    };
    type AgentResult =
      | { tool: "report_syllabus_found"; input: FoundInput }
      | { tool: "report_not_found"; input: { reason: string } }
      | null;

    let agentResult: AgentResult = null;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    const courseName = course.name + (course.code ? ` (${course.code})` : "");
    let messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content:
          `Find the syllabus for Canvas course ID ${canvas_course_id}. The course is called ${courseName}.`,
      },
    ];

    for (let i = 0; i < 8; i++) {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        // deno-lint-ignore no-explicit-any
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }] as any,
        tools: TOOLS,
        messages,
      });

      console.log(`[loop:${i}] stop_reason=${response.stop_reason} input_tokens=${response.usage?.input_tokens} output_tokens=${response.usage?.output_tokens}`);
      totalInputTokens += response.usage?.input_tokens ?? 0;
      totalOutputTokens += response.usage?.output_tokens ?? 0;

      // Log any text reasoning Claude emitted
      const textBlocks = response.content.filter((b) => b.type === "text");
      for (const tb of textBlocks) {
        console.log(`[loop:${i}] Claude text: ${(tb as Anthropic.TextBlock).text}`);
      }

      if (response.stop_reason === "end_turn") break;

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      if (toolUseBlocks.length === 0) break;

      console.log(`[loop:${i}] tools called: ${toolUseBlocks.map((t) => t.name).join(", ")}`);

      // Execute all tools (may throw CanvasTokenExpiredError)
      const toolResults = await executeTools(toolUseBlocks, canvasToken, canvasBaseUrl, allowedHost);

      // Check for terminal tools
      for (const block of toolUseBlocks) {
        if (block.name === "report_syllabus_found") {
          const foundInput = block.input as FoundInput;
          if (foundInput.source_type === "file" && !foundInput.file_url) break; // rejected in executeTools — let Claude retry
          if (
            (foundInput.source_type === "html" || foundInput.source_type === "page") &&
            !foundInput.html_content?.trim()
          ) break; // rejected in executeTools — let Claude retry
          console.log(`[loop] report_syllabus_found ACCEPTED by loop check: ${JSON.stringify(foundInput)}`);
          agentResult = { tool: "report_syllabus_found", input: foundInput };
          break;
        }
        if (block.name === "report_not_found") {
          agentResult = {
            tool: "report_not_found",
            input: block.input as { reason: string },
          };
          break;
        }
      }
      if (agentResult) break;

      messages = [
        ...messages,
        { role: "assistant", content: response.content },
        { role: "user", content: toolResults },
      ];
    }

    console.log(`[result] agentResult: ${JSON.stringify(agentResult)}`);

    // Log to claude_api_logs
    await supabaseService.from("claude_api_logs").insert({
      user_id: user.id,
      course_id,
      model: "claude-sonnet-4-6",
      status: "success",
      input: JSON.stringify(messages),
      output: agentResult ? JSON.stringify(agentResult) : "no_result",
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
    });

    // 6. Handle result
    if (!agentResult || agentResult.tool === "report_not_found") {
      const reason =
        agentResult?.tool === "report_not_found"
          ? agentResult.input.reason
          : "Search exhausted without result";

      await supabaseService
        .from("courses")
        .update({
          canvas_sync_status: { ...(courseData.canvas_sync_status ?? {}), find_syllabus: "failed" },
          canvas_sync_error: { ...(courseData.canvas_sync_error ?? {}), find_syllabus: reason },
        })
        .eq("id", course_id);

      return json({ success: false, found: false, course_id, reason });
    }

    // 7. Syllabus found — update status and return location metadata
    const found = agentResult.input;

    await supabaseService
      .from("courses")
      .update({
        canvas_sync_status: { ...(courseData.canvas_sync_status ?? {}), find_syllabus: "complete" },
      })
      .eq("id", course_id);

    return json({
      success: true,
      found: true,
      course_id,
      source_type: found.source_type,
      file_name: found.file_name ?? null,
      file_url: found.file_url ?? null,
      html_content: found.html_content ?? null,
      confidence: found.confidence,
    });
  } catch (err) {
    if (err instanceof CanvasTokenExpiredError) {
      return json({ error: "Canvas token expired. Please reconnect Canvas." }, 400);
    }
    // Detail stays server-side (SYL-31); clients get a generic message.
    console.error("find-canvas-syllabus unexpected error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
