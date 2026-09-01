// supabase/functions/download-canvas-syllabus/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assertSafeCanvasUrl, safeCanvasFetch, UnsafeCanvasUrlError } from "../_shared/canvas-url.ts";

import { CORS_HEADERS } from "../_shared/cors.ts";

declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

const supabaseService = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

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
    let body: {
      course_id: string;
      source_type: "file" | "html" | "page";
      file_url: string | null;
      file_name: string | null;
      html_content: string | null;
    };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Request body must be valid JSON." }, 400);
    }

    const { course_id, source_type, file_url, file_name, html_content } = body;
    // file_url itself never goes to the logs (SYL-31) — only whether it was sent.
    console.log(`[download] received: course_id=${course_id} source_type=${source_type} has_file_url=${!!file_url} file_name=${file_name ?? "MISSING"} html_content_length=${html_content?.length ?? "MISSING"}`);
    if (!course_id || !source_type) {
      return json({ error: "course_id and source_type are required." }, 400);
    }
    if (source_type === "file" && !file_url) {
      console.error("[download] REJECTED: source_type=file but file_url missing");
      return json({ error: "file_url is required when source_type is 'file'." }, 400);
    }
    if ((source_type === "html" || source_type === "page") && !html_content) {
      console.error("[download] REJECTED: source_type=html/page but html_content missing");
      return json({ error: "html_content is required when source_type is 'html' or 'page'." }, 400);
    }

    // 3. Fetch current canvas_sync_status/error for merge, and Canvas token in parallel
    const encryptionKey = Deno.env.get("CANVAS_ENCRYPTION_KEY");
    if (!encryptionKey) {
      console.error("CANVAS_ENCRYPTION_KEY is not set");
      return json({ error: "Server misconfiguration." }, 500);
    }

    const [courseResult, tokenResult, profileResult] = await Promise.all([
      supabaseService
        .from("courses")
        .select("canvas_sync_status, canvas_sync_error")
        .eq("id", course_id)
        .eq("user_id", user.id)
        .single(),
      supabaseService.rpc("get_canvas_token", { p_user_id: user.id, p_key: encryptionKey }),
      supabaseService.from("profiles").select("canvas_base_url").eq("id", user.id).single(),
    ]);

    if (courseResult.error || !courseResult.data) {
      return json({ error: "Course not found." }, 404);
    }

    const currentStatus = courseResult.data.canvas_sync_status ?? {};
    const currentError = courseResult.data.canvas_sync_error ?? {};
    const canvasToken: string | null = tokenResult.data ?? null;

    // Canvas token is only required for file downloads
    if (source_type === "file" && !canvasToken) {
      return json({ error: "No Canvas token found. Please connect Canvas first." }, 400);
    }

    // file_url comes straight from the request body and is fetched below with
    // the user's Canvas token, so pin it to the host of their connected Canvas
    // instance before any request leaves the function. Checked here rather than
    // at the fetch so a rejection cannot leave canvas_sync_status on "running".
    let allowedHost: string | null = null;
    if (source_type === "file" && file_url) {
      const canvasBaseUrl: string | null = profileResult.data?.canvas_base_url ?? null;
      if (!canvasBaseUrl) {
        return json({ error: "No Canvas instance connected. Please connect Canvas first." }, 400);
      }
      try {
        allowedHost = (await assertSafeCanvasUrl(canvasBaseUrl)).hostname;
        await assertSafeCanvasUrl(file_url, allowedHost);
      } catch (err) {
        if (err instanceof UnsafeCanvasUrlError) {
          console.error(`[download] REJECTED file_url ${file_url}: ${err.message}`);
          return json({ error: `file_url is not an allowed Canvas URL: ${err.message}` }, 400);
        }
        throw err;
      }
    }

    // 4. Mark process_syllabus as running (clear any prior error for this step)
    const cleanedError = { ...currentError };
    delete cleanedError.process_syllabus;

    await supabaseService
      .from("courses")
      .update({
        canvas_sync_status: { ...currentStatus, process_syllabus: "running" },
        canvas_sync_error: cleanedError,
      })
      .eq("id", course_id);

    // 5. Download and upload to Storage
    let uploadData: ArrayBuffer | Uint8Array;
    let uploadContentType: string;
    let resolvedFileName: string;

    if (source_type === "file" && file_url) {
      console.log("[download] fetching Canvas file");
      let fileRes: Response;
      try {
        fileRes = await safeCanvasFetch(file_url, {
          headers: { Authorization: `Bearer ${canvasToken}` },
        }, allowedHost);
      } catch (err) {
        if (err instanceof UnsafeCanvasUrlError) {
          const errMsg = `Failed to download syllabus file: ${err.message}`;
          console.error(`[download] ${errMsg}`);
          await supabaseService
            .from("courses")
            .update({
              canvas_sync_status: { ...currentStatus, process_syllabus: "failed" },
              canvas_sync_error: { ...currentError, process_syllabus: errMsg },
            })
            .eq("id", course_id);
          return json({ error: errMsg }, 502);
        }
        throw err;
      }
      console.log(`[download] Canvas file fetch status: ${fileRes.status} content-type: ${fileRes.headers.get("content-type")} content-length: ${fileRes.headers.get("content-length")}`);
      if (!fileRes.ok) {
        const errMsg = `Failed to download syllabus file: ${fileRes.status}`;
        console.error(`[download] ${errMsg}`);
        await supabaseService
          .from("courses")
          .update({
            canvas_sync_status: { ...currentStatus, process_syllabus: "failed" },
            canvas_sync_error: { ...currentError, process_syllabus: errMsg },
          })
          .eq("id", course_id);
        return json({ error: errMsg }, 500);
      }
      uploadData = await fileRes.arrayBuffer();
      uploadContentType = fileRes.headers.get("content-type") ?? "application/octet-stream";
      if (file_name) {
        resolvedFileName = file_name;
      } else {
        const ext = uploadContentType.includes("pdf") ? ".pdf"
          : uploadContentType.includes("html") ? ".html"
          : "";
        resolvedFileName = `syllabus_${course_id}${ext}`;
      }
      console.log(`[download] file downloaded: ${uploadData.byteLength} bytes content-type=${uploadContentType} resolvedFileName=${resolvedFileName}`);
    } else {
      resolvedFileName = "syllabus.html";
      uploadData = new TextEncoder().encode(html_content ?? "");
      uploadContentType = "text/html";
      console.log(`[download] using html_content: ${uploadData.byteLength} bytes`);
    }

    const storagePath = `${user.id}/${course_id}/${resolvedFileName}`;
    console.log(`[download] uploading to storage: ${storagePath}`);

    const { error: uploadError } = await supabaseService.storage
      .from("syllabi")
      .upload(storagePath, uploadData, { contentType: uploadContentType, upsert: true });

    if (uploadError) {
      const errMsg = "Storage upload failed";
      console.error(`[download] ${errMsg}: ${uploadError.message}`);
      await supabaseService
        .from("courses")
        .update({
          canvas_sync_status: { ...currentStatus, process_syllabus: "failed" },
          canvas_sync_error: { ...currentError, process_syllabus: "Storage upload failed" },
        })
        .eq("id", course_id);
      return json({ error: errMsg }, 500);
    }

    console.log(`[download] storage upload success: ${storagePath}`);

    // 6. Update course record
    const { error: updateError } = await supabaseService
      .from("courses")
      .update({
        syllabus_file_path: storagePath,
        syllabus_file_name: resolvedFileName,
        analysis_status: "pending",
      })
      .eq("id", course_id);

    if (updateError) {
      console.error(`[download] course record update failed: ${updateError.message} code=${updateError.code}`);
    } else {
      console.log(`[download] course record updated: syllabus_file_path=${storagePath}`);
    }

    // 7. Fire-and-forget: trigger process-syllabus, then match-canvas-assignments
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const processSyllabusUrl = `${supabaseUrl}/functions/v1/process-syllabus`;
    const matchCanvasUrl = `${supabaseUrl}/functions/v1/match-canvas-assignments`;
    console.log(`[download] triggering process-syllabus for course_id=${course_id}`);
    EdgeRuntime.waitUntil(
      fetch(processSyllabusUrl, {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ course_id }),
      }).then(async (r) => {
        console.log(`[download] process-syllabus trigger status: ${r.status}`);
        if (!r.ok) {
          const text = await r.text().catch(() => "(unreadable)");
          console.error(`[download] process-syllabus trigger failed: ${text}`);
          return;
        }
        // Chain: after process-syllabus succeeds, run Canvas assignment matching
        console.log(`[download] triggering match-canvas-assignments for course_id=${course_id}`);
        await fetch(matchCanvasUrl, {
          method: "POST",
          headers: {
            "Authorization": authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ course_id }),
        }).then((r2) => {
          console.log(`[download] match-canvas-assignments status: ${r2.status}`);
        }).catch((e) => {
          console.error(`[download] match-canvas-assignments threw: ${e}`);
        });
      }).catch((e) => {
        console.error(`[download] process-syllabus trigger threw: ${e}`);
      })
    );

    // 8. Return immediately
    return json({
      success: true,
      course_id,
      file_name: resolvedFileName,
      file_path: storagePath,
      processing: true,
    });
  } catch (err) {
    // Detail stays server-side (SYL-31); clients get a generic message.
    console.error("download-canvas-syllabus unexpected error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
