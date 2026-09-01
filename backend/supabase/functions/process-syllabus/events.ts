// Safe course_events rewrite. No I/O beyond the client passed in — unit
// tested with a fake client in tests/unit/.
//
// SYL-60: index.ts used to delete every existing event for a course and then
// insert all new rows in one statement. A single rejected row (e.g. an
// unnormalised time — see parse.ts) failed the insert *after* the delete had
// already committed, leaving the course with zero events while the caller
// still reported success. replaceCourseEvents() reorders this: insert first,
// delete the old rows only once the insert has succeeded, so a failed insert
// leaves the previous events intact and reports failure instead of silently
// emptying the course.

// Minimal structural type for the pieces of the Supabase client this module
// touches, so tests/unit/process-syllabus-events.test.ts can pass a small
// fake instead of a real SupabaseClient (whose generated type is enormous
// and not worth satisfying structurally for a handful of calls).
export interface CourseEventsClient {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): PromiseLike<{ data: { id: string }[] | null; error: unknown }>;
    };
    insert(rows: Record<string, unknown>[]): {
      select(
        columns: string,
      ): PromiseLike<{ data: { id: string }[] | null; error: unknown }>;
    };
    delete(): {
      in(
        column: string,
        values: string[],
      ): PromiseLike<{ data: unknown; error: unknown }>;
    };
  };
}

// PostgREST puts the id list in the query string (`id=in.(...)` /
// `id=not.in.(...)`); a few hundred UUIDs would push that past request-line
// limits, so deletes are chunked.
const DELETE_CHUNK_SIZE = 100;

export interface ReplaceCourseEventsResult {
  ok: boolean;
  /** Present only when ok is false. */
  stage?: "select" | "insert" | "delete";
  /** Rows actually inserted — reported even on a later delete failure. */
  inserted: number;
  /** Rows removed from the prior snapshot. Present on success. */
  deleted?: number;
  error?: unknown;
}

/**
 * Replace all course_events rows for `courseId` with `rows`, insert-then-delete
 * so a failed insert never leaves the course with zero events.
 */
export async function replaceCourseEvents(
  client: CourseEventsClient,
  courseId: string,
  rows: Record<string, unknown>[],
): Promise<ReplaceCourseEventsResult> {
  // 1. Snapshot the ids of the events we'll be replacing. Nothing is deleted
  // yet — if the insert below fails, this snapshot is simply discarded and
  // the existing rows are left untouched.
  const { data: existing, error: selectError } = await client
    .from("course_events")
    .select("id")
    .eq("course_id", courseId);

  if (selectError) {
    return { ok: false, stage: "select", inserted: 0, error: selectError };
  }
  const existingIds = (existing ?? []).map((row) => row.id);

  // 2. Insert the new rows first. On failure, return without touching the
  // old rows at all — the course keeps its previous events.
  let insertedIds: string[] = [];
  if (rows.length > 0) {
    const { data: insertedRows, error: insertError } = await client
      .from("course_events")
      .insert(rows)
      .select("id");

    if (insertError) {
      return { ok: false, stage: "insert", inserted: 0, error: insertError };
    }
    insertedIds = (insertedRows ?? []).map((row) => row.id);
  }

  // 3. Only now delete the old rows, chunked to stay under PostgREST's
  // query-string limits.
  for (let i = 0; i < existingIds.length; i += DELETE_CHUNK_SIZE) {
    const chunk = existingIds.slice(i, i + DELETE_CHUNK_SIZE);
    const { error: deleteError } = await client
      .from("course_events")
      .delete()
      .in("id", chunk);

    if (deleteError) {
      // The new rows are already in; some stale rows may remain. Reported
      // as a failure (not partial success) so it's visible — a reprocess
      // will clean up the leftovers via the same insert-then-delete path.
      return {
        ok: false,
        stage: "delete",
        inserted: insertedIds.length,
        error: deleteError,
      };
    }
  }

  return { ok: true, inserted: insertedIds.length, deleted: existingIds.length };
}
