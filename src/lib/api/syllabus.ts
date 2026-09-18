import { supabase } from '@/lib/supabase';
import { isClaudeKeyRejected, toastClaudeKeyRejected } from '@/lib/claudeKeyRejection';

// Syllabus storage + processing pipeline (SYL-38). The upload/record/invoke
// sequence previously lived inline in useBulkUpload, useBulkCourseUpload, and
// AddCourseModal; callers keep their own optimistic state and error handling.

export interface ProcessSyllabusResponse {
  success?: boolean;
  events_created?: number;
  completeness?: 'complete' | 'partial' | 'minimal';
  error?: string;
}

const KEY_REJECTED_MESSAGE = 'Your Claude API key was rejected. Update it in Settings.';

/**
 * process-syllabus is invoked fire-and-forget from useBulkUpload and awaited
 * from UploadSyllabusModal — both funnel through uploadAndProcess/
 * reprocessSyllabus below, so the claude_key_rejected check (SYL-72) lives
 * here once rather than in each caller. supabase.functions.invoke collapses
 * a non-2xx response into a FunctionsHttpError whose `.context` is the raw
 * Response — read here, before it's gone by the time a caller only sees a
 * plain `{ message }`.
 */
async function toastIfClaudeKeyRejected(fnError: unknown): Promise<boolean> {
  const rejected = await isClaudeKeyRejected(fnError);
  if (rejected) toastClaudeKeyRejected();
  return rejected;
}

export type UploadStage = 'uploading' | 'processing';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function invokeProcessSyllabus(courseId: string) {
  return supabase.functions.invoke('process-syllabus', { body: { course_id: courseId } });
}

/**
 * Uploads a syllabus PDF to its permanent path, records it on the course row
 * (flipping `analysis_status` to 'processing'), and invokes process-syllabus.
 * The invoke is fire-and-forget unless `awaitProcessing` is set (the
 * single-course flow blocks on it and reads the response). `data.path` is set
 * as soon as the file is in Storage — even when a later stage errors — so
 * callers can roll the upload back.
 */
export async function uploadAndProcess(
  userId: string,
  courseId: string,
  file: File,
  opts: { awaitProcessing?: boolean; onStage?: (stage: UploadStage) => void } = {}
): Promise<{
  data: { path: string | null; fnData?: ProcessSyllabusResponse };
  error: { message: string; code?: string } | null;
}> {
  const path = `${userId}/${courseId}/${file.name}`;

  // Read into memory first so the upload never does disk I/O mid-stream
  // (prevents hangs when files live in iCloud/OneDrive/network drives).
  opts.onStage?.('uploading');
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return {
      data: { path: null },
      error: {
        message: 'Could not read file — make sure it is stored locally and not still syncing',
      },
    };
  }

  const { error: uploadError } = await supabase.storage
    .from('syllabi')
    .upload(path, buffer, { upsert: true, contentType: 'application/pdf' });
  if (uploadError) {
    return { data: { path: null }, error: { message: `Upload failed: ${uploadError.message}` } };
  }

  // Newly inserted rows sit at the DB default 'pending' (which the app shows
  // as ready); mark the row 'processing' here so a poll that runs before the
  // function's own status write cannot flip the card back to done (SYL-66).
  const { error: updateError } = await supabase
    .from('courses')
    .update({
      syllabus_file_path: path,
      syllabus_file_name: file.name,
      analysis_status: 'processing',
      analysis_error: null,
    })
    .eq('id', courseId);
  if (updateError) {
    return {
      data: { path },
      error: { message: `Failed to save file path: ${updateError.message}` },
    };
  }

  opts.onStage?.('processing');
  if (!opts.awaitProcessing) {
    // Fire-and-forget for the UI, but a transport/HTTP failure (network, 401,
    // 429 quota) would otherwise leave the row 'processing' forever and the
    // poll never settles. Mark it failed unless the function got far enough
    // to settle the row itself.
    void invokeProcessSyllabus(courseId)
      .then(async ({ error }) => {
        if (!error) return null;
        if (await toastIfClaudeKeyRejected(error)) return KEY_REJECTED_MESSAGE;
        return `Processing failed: ${error.message}`;
      })
      .catch((e: unknown) => `Processing failed: ${errorMessage(e)}`)
      .then((message) => {
        if (message) return markSyllabusFailed(courseId, message, { onlyIfProcessing: true });
      });
    return { data: { path }, error: null };
  }

  const { data: fnData, error: fnError } = await invokeProcessSyllabus(courseId);
  if (fnError) {
    if (await toastIfClaudeKeyRejected(fnError)) {
      return {
        data: { path },
        error: { message: KEY_REJECTED_MESSAGE, code: 'claude_key_rejected' },
      };
    }
    return { data: { path }, error: { message: `Processing failed: ${fnError.message}` } };
  }
  if (!fnData?.success) {
    return { data: { path, fnData }, error: { message: fnData?.error || 'Processing failed' } };
  }
  return { data: { path, fnData }, error: null };
}

/**
 * Records a failed syllabus stage on the course row so the status the poll
 * reads back agrees with the failed card the UI shows (SYL-66). With
 * `onlyIfProcessing` the write is a compare-and-set that leaves a row
 * process-syllabus has already settled ('complete' / 'failed') untouched.
 */
export async function markSyllabusFailed(
  courseId: string,
  message: string,
  opts: { onlyIfProcessing?: boolean } = {}
) {
  let query = supabase
    .from('courses')
    .update({ analysis_status: 'failed', analysis_error: message })
    .eq('id', courseId);
  if (opts.onlyIfProcessing) query = query.eq('analysis_status', 'processing');
  const { error } = await query;
  return { error };
}

/**
 * Uploads a PDF to the user's temp area ahead of detect-syllabi-info.
 * The path is returned even on failure so results can be mapped back to
 * their file.
 */
export async function uploadTempSyllabus(
  userId: string,
  timestamp: number,
  file: File
): Promise<{ data: { path: string }; error: { message: string } | null }> {
  const path = `${userId}/temp/${timestamp}_${file.name}`;

  // Load into memory with a timeout — catches inaccessible/still-syncing files early
  let buffer: ArrayBuffer;
  try {
    buffer = await Promise.race([
      file.arrayBuffer(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                'Could not read file — make sure it is stored locally and not still syncing'
              )
            ),
          15_000
        )
      ),
    ]);
  } catch (e: unknown) {
    return { data: { path }, error: { message: (e as Error).message } };
  }

  const { error } = await supabase.storage
    .from('syllabi')
    .upload(path, buffer, { upsert: true, contentType: 'application/pdf' });
  return { data: { path }, error: error ? { message: error.message } : null };
}

/** Runs the lightweight course-info detection over already-uploaded temp files. */
export async function detectSyllabiInfo(filePaths: string[]) {
  return supabase.functions.invoke('detect-syllabi-info', { body: { file_paths: filePaths } });
}

/**
 * Re-runs syllabus processing for a course (the bulk-flow retry button) and
 * waits for it. A transport/HTTP failure is recorded on the row the same way
 * `uploadAndProcess` does and returned to the caller.
 */
export async function reprocessSyllabus(
  courseId: string
): Promise<{ error: { message: string } | null }> {
  // Flip the row back to 'processing' first so the poll agrees with the
  // retrying card, and so the compare-and-set below can record a transport
  // failure that happens before the function's own status write.
  await supabase
    .from('courses')
    .update({ analysis_status: 'processing', analysis_error: null })
    .eq('id', courseId);
  const { error } = await invokeProcessSyllabus(courseId);
  if (error) {
    const message = (await toastIfClaudeKeyRejected(error))
      ? KEY_REJECTED_MESSAGE
      : `Processing failed: ${error.message}`;
    await markSyllabusFailed(courseId, message, { onlyIfProcessing: true });
    return { error: { message } };
  }
  await matchCanvasAssignmentsIfLinked(courseId);
  return { error: null };
}

/**
 * Kicks off Canvas assignment matching (fire-and-forget) when the course is
 * linked to a Canvas course; no-op otherwise.
 */
export async function matchCanvasAssignmentsIfLinked(courseId: string) {
  const { data } = await supabase
    .from('courses')
    .select('canvas_course_id')
    .eq('id', courseId)
    .single();
  if (data?.canvas_course_id) {
    supabase.functions.invoke('match-canvas-assignments', { body: { course_id: courseId } });
  }
}

/** Removes an uploaded syllabus PDF (rollback after a failed upload flow). */
export async function removeSyllabusFile(path: string) {
  return supabase.storage.from('syllabi').remove([path]);
}
