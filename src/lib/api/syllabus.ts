import { supabase } from '@/lib/supabase';

// Syllabus storage + processing pipeline (SYL-38). The upload/record/invoke
// sequence previously lived inline in useBulkUpload, useBulkCourseUpload, and
// AddCourseModal; callers keep their own optimistic state and error handling.

export interface ProcessSyllabusResponse {
  success?: boolean;
  events_created?: number;
  completeness?: 'complete' | 'partial' | 'minimal';
  error?: string;
}

export type UploadStage = 'uploading' | 'processing';

/**
 * Uploads a syllabus PDF to its permanent path, records it on the course row,
 * and invokes process-syllabus. The invoke is fire-and-forget unless
 * `awaitProcessing` is set (the single-course flow blocks on it and reads the
 * response). `data.path` is set as soon as the file is in Storage — even when
 * a later stage errors — so callers can roll the upload back.
 */
export async function uploadAndProcess(
  userId: string,
  courseId: string,
  file: File,
  opts: { awaitProcessing?: boolean; onStage?: (stage: UploadStage) => void } = {}
): Promise<{
  data: { path: string | null; fnData?: ProcessSyllabusResponse };
  error: { message: string } | null;
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
      error: { message: 'Could not read file — make sure it is stored locally and not still syncing' },
    };
  }

  const { error: uploadError } = await supabase.storage
    .from('syllabi')
    .upload(path, buffer, { upsert: true, contentType: 'application/pdf' });
  if (uploadError) {
    return { data: { path: null }, error: { message: `Upload failed: ${uploadError.message}` } };
  }

  const { error: updateError } = await supabase
    .from('courses')
    .update({ syllabus_file_path: path, syllabus_file_name: file.name })
    .eq('id', courseId);
  if (updateError) {
    return { data: { path }, error: { message: `Failed to save file path: ${updateError.message}` } };
  }

  opts.onStage?.('processing');
  if (!opts.awaitProcessing) {
    supabase.functions.invoke('process-syllabus', { body: { course_id: courseId } });
    return { data: { path }, error: null };
  }

  const { data: fnData, error: fnError } = await supabase.functions.invoke('process-syllabus', {
    body: { course_id: courseId },
  });
  if (fnError) {
    return { data: { path }, error: { message: `Processing failed: ${fnError.message}` } };
  }
  if (!fnData?.success) {
    return { data: { path, fnData }, error: { message: fnData?.error || 'Processing failed' } };
  }
  return { data: { path, fnData }, error: null };
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
        setTimeout(() => reject(new Error('Could not read file — make sure it is stored locally and not still syncing')), 15_000)
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

/** Re-runs syllabus processing for a course (the bulk-flow retry button). */
export async function reprocessSyllabus(courseId: string) {
  await supabase.functions.invoke('process-syllabus', { body: { course_id: courseId } });
  await matchCanvasAssignmentsIfLinked(courseId);
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
