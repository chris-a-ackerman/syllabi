import { supabase, supabaseUrl, supabaseAnonKey } from '@/lib/supabase';
import type {
  CanvasProfile,
  CanvasSyllabusSourceType,
  DeleteCanvasTokenResult,
  FindCanvasCoursesResponse,
  CanvasSyllabusDownloadResult,
  CanvasSyllabusFindResult,
  SaveCanvasTokenResult,
} from '@/lib/types';

// Data access for the Canvas integration (SYL-63). Queries/fetches moved
// verbatim from AddSemesterModal, CanvasSettings and useCanvasFlow.

export async function fetchCanvasProfile() {
  const { data, error } = await supabase
    .from('profiles_safe')
    .select('has_canvas_connected, canvas_base_url')
    .single();
  return { data: data as CanvasProfile | null, error };
}

export async function findCanvasCourses(semesterStart: string, semesterEnd: string) {
  return supabase.functions.invoke<FindCanvasCoursesResponse>('find-canvas-courses', {
    body: { semester_start: semesterStart, semester_end: semesterEnd },
  });
}

export async function findCanvasSyllabus(courseId: string, canvasCourseId: string) {
  return supabase.functions.invoke<CanvasSyllabusFindResult>('find-canvas-syllabus', {
    body: { course_id: courseId, canvas_course_id: canvasCourseId },
  });
}

export async function downloadCanvasSyllabus(params: {
  courseId: string;
  sourceType: CanvasSyllabusSourceType;
  fileUrl?: string | null;
  fileName?: string | null;
  htmlContent?: string | null;
}) {
  return supabase.functions.invoke<CanvasSyllabusDownloadResult>('download-canvas-syllabus', {
    body: {
      course_id: params.courseId,
      source_type: params.sourceType,
      file_url: params.fileUrl ?? undefined,
      file_name: params.fileName ?? undefined,
      html_content: params.htmlContent ?? undefined,
    },
  });
}

/** Stamps the Canvas course a created course was imported from. Not part of the Course interface, so a direct column update. */
export async function linkCanvasCourse(courseId: string, canvasCourseId: string) {
  return supabase.from('courses').update({ canvas_course_id: canvasCourseId }).eq('id', courseId);
}

/**
 * save-canvas-token and delete-canvas-token are plain POST functions but are
 * fetched directly (rather than through supabase.functions.invoke) so the
 * caller can read the `{ error }` body Supabase sends back on a non-2xx
 * response — invoke() discards it. Never throws; failures come back as
 * `{ data: null, error }` like the rest of this module.
 */
async function postCanvasFunction<T>(path: string, body?: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { data: null, error: { message: 'Not signed in' } };

  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: supabaseAnonKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { data: null, error: { message: 'Unexpected error. Please try again.' } };
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return { data: null, error: { message: json?.error ?? `${path} failed (${res.status})` } };
  }
  return { data: json as T, error: null };
}

export async function saveCanvasToken(canvasToken: string, canvasBaseUrl: string) {
  return postCanvasFunction<SaveCanvasTokenResult>('save-canvas-token', {
    canvas_token: canvasToken,
    canvas_base_url: canvasBaseUrl,
  });
}

export async function deleteCanvasToken() {
  return postCanvasFunction<DeleteCanvasTokenResult>('delete-canvas-token');
}
