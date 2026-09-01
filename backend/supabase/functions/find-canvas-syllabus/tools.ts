// supabase/functions/find-canvas-syllabus/tools.ts
//
// Tool definitions + executor for the find-canvas-syllabus agentic loop.
// Pulled out of index.ts (which calls serve() and builds clients from env at
// module load) so this layer can be unit-tested in isolation — same pattern
// as chat/query.ts, process-syllabus/parse.ts, generate-ics/ics.ts.
import type Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.3";
import { safeCanvasFetch, UnsafeCanvasUrlError } from "../_shared/canvas-url.ts";

export const SYSTEM_PROMPT =
  `You are searching for the course syllabus on Canvas for a student.
Your goal is to find the document or page that contains the full course syllabus — including the schedule, assignments, grading policy, and course policies.

Search strategy (follow this order):
1. Check syllabus_body first — it is fastest. If syllabus_body is empty or only whitespace, treat it as not found and move to step 2.
2. Search files for 'syllabus' — if this returns a 403 or other error, skip to step 3
3. Check modules — look for a module whose name contains 'syllabus' AND a File item whose title also contains 'syllabus'. If both match, report that file's download_url as found. Otherwise check the first module's items for anything syllabus-related. Only report a file as found if it has a non-null download_url.
4. Search pages for 'syllabus' or 'course overview' — if this returns a 404 or other error, skip this step
5. If nothing found after these four steps, report_not_found

Rules:
- Stop as soon as you find something that looks like a real syllabus
- Do not search exhaustively if you find a strong match early
- Prefer PDF files over HTML content when both exist
- If a tool returns an error, treat that resource as unavailable and move to the next step
- A module named 'Syllabus' does not itself count as the syllabus — you must find a File item within it whose title contains 'syllabus'
- Never call report_syllabus_found unless you have actual content: a non-null file_url (for source_type 'file') or non-empty html_content (for source_type 'html' or 'page')
- Call report_syllabus_found or report_not_found to end your search
- You have a maximum of 8 tool calls — use them efficiently`;

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_course_syllabus_body",
    description:
      "Get the syllabus_body field for this course. Returns inline HTML content if the professor used the Canvas syllabus editor. Often empty at MIT.",
    input_schema: {
      type: "object",
      properties: {
        course_id: { type: "string", description: "The Canvas course ID" },
      },
      required: ["course_id"],
    },
  },
  {
    name: "search_course_files",
    description:
      "Search for files in the course that might be the syllabus. Search for terms like 'syllabus', 'course overview', 'schedule'. Returns file names, IDs, and download URLs.",
    input_schema: {
      type: "object",
      properties: {
        course_id: { type: "string", description: "The Canvas course ID" },
        search_term: { type: "string", description: "Search term, e.g. 'syllabus'" },
      },
      required: ["course_id", "search_term"],
    },
  },
  {
    name: "get_course_modules",
    description:
      "List the modules in this course. Modules often contain a syllabus item in the first module. Returns module names and item counts.",
    input_schema: {
      type: "object",
      properties: {
        course_id: { type: "string", description: "The Canvas course ID" },
      },
      required: ["course_id"],
    },
  },
  {
    name: "get_course_pages",
    description:
      "Search for pages in the course that might contain syllabus content. Pages are often used at MIT instead of the built-in syllabus field.",
    input_schema: {
      type: "object",
      properties: {
        course_id: { type: "string", description: "The Canvas course ID" },
        search_term: { type: "string", description: "Search term, e.g. 'syllabus'" },
      },
      required: ["course_id", "search_term"],
    },
  },
  {
    name: "get_page_content",
    description:
      "Get the full HTML content of a specific Canvas page by its page URL slug. Use this after get_course_pages identifies a promising page.",
    input_schema: {
      type: "object",
      properties: {
        course_id: { type: "string", description: "The Canvas course ID" },
        page_url: { type: "string", description: "The page URL slug" },
      },
      required: ["course_id", "page_url"],
    },
  },
  {
    name: "report_syllabus_found",
    description:
      "Call this when you have located the syllabus. IMPORTANT requirements by source_type — 'file': file_url must be a non-null valid download URL; 'html': html_content must be the actual syllabus HTML (non-empty); 'page': html_content must be the page body (non-empty). Do NOT call this tool if these conditions are not met. Call this as soon as you are confident you have found the syllabus — do not keep searching.",
    input_schema: {
      type: "object",
      properties: {
        source_type: {
          type: "string",
          enum: ["file", "html", "page"],
          description: "Where the syllabus was found",
        },
        file_url: {
          type: "string",
          description: "Canvas file download URL (required when source_type is 'file')",
        },
        file_name: {
          type: "string",
          description: "Original filename (required when source_type is 'file')",
        },
        html_content: {
          type: "string",
          description:
            "Syllabus HTML content — required and must be non-empty when source_type is 'html' or 'page'",
        },
        confidence: {
          type: "string",
          enum: ["high", "medium"],
          description: "Confidence that this is the actual course syllabus",
        },
      },
      required: ["source_type", "confidence"],
    },
  },
  {
    name: "report_not_found",
    description:
      "Call this if you have exhausted your search and cannot locate a syllabus for this course.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Explanation of why the syllabus could not be found",
        },
      },
      required: ["reason"],
    },
  },
];

// Thrown when Canvas returns 401 — surfaces as 400 at the top level
export class CanvasTokenExpiredError extends Error {}

export async function executeTools(
  toolUseBlocks: Anthropic.ToolUseBlock[],
  canvasToken: string,
  canvasBaseUrl: string,
  allowedHost: string,
): Promise<Anthropic.ToolResultBlockParam[]> {
  return await Promise.all(
    toolUseBlocks.map(async (block): Promise<Anthropic.ToolResultBlockParam> => {
      const input = block.input as Record<string, string>;
      try {
        let result: unknown;

        console.log(`[tool:${block.name}] input: ${JSON.stringify(block.input)}`);

        if (block.name === "get_course_syllabus_body") {
          const url = `${canvasBaseUrl}/api/v1/courses/${input.course_id}?include[]=syllabus_body`;
          const res = await safeCanvasFetch(url, { headers: { Authorization: `Bearer ${canvasToken}` } }, allowedHost);
          console.log(`[tool:get_course_syllabus_body] Canvas status: ${res.status}`);
          if (res.status === 401) throw new CanvasTokenExpiredError();
          if (!res.ok) throw new Error(`Canvas API error: ${res.status}`);
          const data = await res.json() as Record<string, unknown>;
          const body = data.syllabus_body ?? null;
          console.log(
            `[tool:get_course_syllabus_body] syllabus_body type=${typeof body} length=${typeof body === "string" ? body.length : "n/a"} value=${JSON.stringify(typeof body === "string" ? body.slice(0, 300) : body)}`,
          );
          result = { syllabus_body: body };
        } else if (block.name === "search_course_files") {
          const params = new URLSearchParams({ search_term: input.search_term, per_page: "10" });
          const url = `${canvasBaseUrl}/api/v1/courses/${input.course_id}/files?${params}`;
          const res = await safeCanvasFetch(url, { headers: { Authorization: `Bearer ${canvasToken}` } }, allowedHost);
          console.log(`[tool:search_course_files] Canvas status: ${res.status}`);
          if (res.status === 401) throw new CanvasTokenExpiredError();
          if (!res.ok) throw new Error(`Canvas API error: ${res.status}`);
          const files = await res.json() as Array<Record<string, unknown>>;
          const mapped = files.map((f) => ({
            id: f.id,
            display_name: f.display_name,
            url: f.url,
            "content-type": f["content-type"],
            size: f.size,
          }));
          console.log(`[tool:search_course_files] count=${mapped.length} files=${JSON.stringify(mapped.map((f) => f.display_name))}`);
          result = mapped;
        } else if (block.name === "get_course_modules") {
          const url =
            `${canvasBaseUrl}/api/v1/courses/${input.course_id}/modules?include[]=items&per_page=5`;
          const res = await safeCanvasFetch(url, { headers: { Authorization: `Bearer ${canvasToken}` } }, allowedHost);
          console.log(`[tool:get_course_modules] Canvas status: ${res.status}`);
          if (res.status === 401) throw new CanvasTokenExpiredError();
          if (!res.ok) throw new Error(`Canvas API error: ${res.status}`);
          const modules = await res.json() as Array<Record<string, unknown>>;
          console.log(`[tool:get_course_modules] count=${modules.length} modules=${JSON.stringify(modules.map((m) => m.name))}`);
          result = await Promise.all(modules.map(async (m) => ({
            id: m.id,
            name: m.name,
            items: await Promise.all(
              ((m.items as Array<Record<string, unknown>> | null) ?? []).map(async (item) => {
                const base = { title: item.title, type: item.type, url: item.url };
                if (item.type === "File" && typeof item.url === "string") {
                  try {
                    // SYL-58: item.url comes from the modules response body —
                    // pin it to the connected Canvas instance's host before any
                    // fetch. safeCanvasFetch validates (and rejects redirects)
                    // before the network call happens.
                    const fileRes = await safeCanvasFetch(
                      item.url,
                      { headers: { Authorization: `Bearer ${canvasToken}` } },
                      allowedHost,
                    );
                    console.log(`[tool:get_course_modules] file item "${item.title}" fetch status: ${fileRes.status}`);
                    if (fileRes.ok) {
                      const fileData = await fileRes.json() as Record<string, unknown>;
                      return { ...base, download_url: fileData.url ?? null };
                    }
                    return { ...base, download_url: null, download_url_unavailable: true };
                  } catch (err) {
                    if (err instanceof UnsafeCanvasUrlError) {
                      // Message text alone is enough context to debug — never log the URL itself.
                      console.log(`[tool:get_course_modules] file item "${item.title}" skipped (unsafe URL or redirect): ${err.message}`);
                    } else {
                      console.log(`[tool:get_course_modules] file item "${item.title}" fetch threw: ${err}`);
                    }
                    return { ...base, download_url: null, download_url_unavailable: true };
                  }
                }
                return base;
              })
            ),
          })));
          console.log(`[tool:get_course_modules] result: ${JSON.stringify(result)}`);
        } else if (block.name === "get_course_pages") {
          const params = new URLSearchParams({ search_term: input.search_term, per_page: "10" });
          const url = `${canvasBaseUrl}/api/v1/courses/${input.course_id}/pages?${params}`;
          const res = await safeCanvasFetch(url, { headers: { Authorization: `Bearer ${canvasToken}` } }, allowedHost);
          console.log(`[tool:get_course_pages] Canvas status: ${res.status}`);
          if (res.status === 401) throw new CanvasTokenExpiredError();
          if (!res.ok) throw new Error(`Canvas API error: ${res.status}`);
          const pages = await res.json() as Array<Record<string, unknown>>;
          const mapped = pages.map((p) => ({ page_id: p.page_id, title: p.title, url: p.url }));
          console.log(`[tool:get_course_pages] count=${mapped.length} pages=${JSON.stringify(mapped.map((p) => p.title))}`);
          result = mapped;
        } else if (block.name === "get_page_content") {
          const url =
            `${canvasBaseUrl}/api/v1/courses/${input.course_id}/pages/${encodeURIComponent(input.page_url)}`;
          const res = await safeCanvasFetch(url, { headers: { Authorization: `Bearer ${canvasToken}` } }, allowedHost);
          console.log(`[tool:get_page_content] Canvas status: ${res.status}`);
          if (res.status === 401) throw new CanvasTokenExpiredError();
          if (!res.ok) throw new Error(`Canvas API error: ${res.status}`);
          const page = await res.json() as Record<string, unknown>;
          const bodyStr = typeof page.body === "string" ? page.body : "";
          console.log(`[tool:get_page_content] title="${page.title}" body_length=${bodyStr.length}`);
          result = { title: page.title, body: page.body };
        } else if (block.name === "report_syllabus_found") {
          const foundInput = block.input as Record<string, string | null | undefined>;
          console.log(`[tool:report_syllabus_found] FULL INPUT: ${JSON.stringify(foundInput)}`);
          console.log(`[tool:report_syllabus_found] source_type=${foundInput.source_type} file_url=${foundInput.file_url ?? "MISSING"} html_content_length=${foundInput.html_content?.length ?? "MISSING"} confidence=${foundInput.confidence}`);
          if (foundInput.source_type === "file" && !foundInput.file_url) {
            console.log(`[tool:report_syllabus_found] REJECTED: source_type=file but file_url missing`);
            return {
              type: "tool_result",
              tool_use_id: block.id,
              content:
                '{"error":"file_url is required when source_type is \\"file\\". The file is inaccessible — do not report it as found. Continue searching or call report_not_found."}',
              is_error: true,
            };
          }
          if (
            (foundInput.source_type === "html" || foundInput.source_type === "page") &&
            !foundInput.html_content?.trim()
          ) {
            console.log(`[tool:report_syllabus_found] REJECTED: source_type=${foundInput.source_type} but html_content empty/missing`);
            return {
              type: "tool_result",
              tool_use_id: block.id,
              content:
                '{"error":"html_content is required and must be non-empty when source_type is \\"html\\" or \\"page\\". If syllabus_body was empty, do not report it as found. Continue searching or call report_not_found."}',
              is_error: true,
            };
          }
          console.log(`[tool:report_syllabus_found] ACCEPTED`);
          result = { acknowledged: true };
        } else {
          // report_not_found
          console.log(`[tool:report_not_found] reason: ${(block.input as Record<string, string>).reason}`);
          result = { acknowledged: true };
        }

        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        };
      } catch (err) {
        if (err instanceof CanvasTokenExpiredError) throw err;
        console.error(`Tool ${block.name} error:`, err);
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: `{"error":"${err instanceof Error ? err.message.replace(/"/g, "'") : "Unknown error"}"}`,
          is_error: true,
        };
      }
    })
  );
}
