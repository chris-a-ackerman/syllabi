import { assertEquals } from "@std/assert";
import {
  type CourseEventsClient,
  replaceCourseEvents,
} from "../../functions/process-syllabus/events.ts";

// A small fake client that records every call so the tests below can assert
// call order and argument shape without touching a real database.

type Call =
  | { op: "select"; courseId: string }
  | { op: "insert"; rows: Record<string, unknown>[] }
  | { op: "delete"; ids: string[] };

interface FakeClientOptions {
  existingIds?: string[];
  selectError?: unknown;
  insertError?: unknown;
  insertedIds?: string[];
  /** Zero-based index (into the chunk sequence) of the delete call that should error. */
  deleteErrorOnChunkIndex?: number;
  deleteError?: unknown;
}

function makeFakeClient(options: FakeClientOptions = {}) {
  const calls: Call[] = [];
  let deleteCallCount = 0;

  const client: CourseEventsClient = {
    from(table: string) {
      assertEquals(table, "course_events");
      return {
        select(columns: string) {
          assertEquals(columns, "id");
          return {
            eq(column: string, value: string) {
              assertEquals(column, "course_id");
              calls.push({ op: "select", courseId: value });
              return Promise.resolve(
                options.selectError
                  ? { data: null, error: options.selectError }
                  : {
                      data: (options.existingIds ?? []).map((id) => ({ id })),
                      error: null,
                    },
              );
            },
          };
        },
        insert(rows: Record<string, unknown>[]) {
          return {
            select(columns: string) {
              assertEquals(columns, "id");
              calls.push({ op: "insert", rows });
              if (options.insertError) {
                return Promise.resolve({ data: null, error: options.insertError });
              }
              const ids = options.insertedIds ?? rows.map((_, i) => `new-${i}`);
              return Promise.resolve({ data: ids.map((id) => ({ id })), error: null });
            },
          };
        },
        delete() {
          return {
            in(column: string, ids: string[]) {
              assertEquals(column, "id");
              calls.push({ op: "delete", ids });
              const isErrorChunk = deleteCallCount === options.deleteErrorOnChunkIndex;
              deleteCallCount += 1;
              if (isErrorChunk) {
                return Promise.resolve({ data: null, error: options.deleteError ?? "delete failed" });
              }
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };

  return { client, calls };
}

Deno.test("insert error → ok:false, stage:insert, and no delete call is issued (old rows untouched)", async () => {
  const { client, calls } = makeFakeClient({
    existingIds: ["old-1", "old-2"],
    insertError: { message: "invalid input syntax for type time" },
  });

  const result = await replaceCourseEvents(client, "course-1", [{ title: "Quiz" }]);

  assertEquals(result.ok, false);
  assertEquals(result.stage, "insert");
  assertEquals(result.inserted, 0);
  assertEquals(result.error, { message: "invalid input syntax for type time" });
  assertEquals(calls.some((c) => c.op === "delete"), false);
});

Deno.test("success with 250 pre-existing ids → one insert, three delete calls partitioning all 250 ids", async () => {
  const existingIds = Array.from({ length: 250 }, (_, i) => `old-${i}`);
  const insertedIds = ["new-1", "new-2"];
  const { client, calls } = makeFakeClient({ existingIds, insertedIds });

  const result = await replaceCourseEvents(client, "course-1", [
    { title: "A" },
    { title: "B" },
  ]);

  assertEquals(result.ok, true);
  assertEquals(result.inserted, insertedIds.length);
  assertEquals(result.deleted, 250);

  const insertCalls = calls.filter((c) => c.op === "insert");
  assertEquals(insertCalls.length, 1);

  const deleteCalls = calls.filter((c) => c.op === "delete") as Extract<Call, { op: "delete" }>[];
  assertEquals(deleteCalls.length, 3);
  assertEquals(deleteCalls[0].ids.length, 100);
  assertEquals(deleteCalls[1].ids.length, 100);
  assertEquals(deleteCalls[2].ids.length, 50);

  const allDeletedIds = deleteCalls.flatMap((c) => c.ids);
  assertEquals(allDeletedIds, existingIds);
});

Deno.test("zero new rows → no insert call, old ids still deleted", async () => {
  const existingIds = ["old-1", "old-2", "old-3"];
  const { client, calls } = makeFakeClient({ existingIds });

  const result = await replaceCourseEvents(client, "course-1", []);

  assertEquals(result.ok, true);
  assertEquals(result.inserted, 0);
  assertEquals(result.deleted, 3);
  assertEquals(calls.some((c) => c.op === "insert"), false);

  const deleteCalls = calls.filter((c) => c.op === "delete") as Extract<Call, { op: "delete" }>[];
  assertEquals(deleteCalls.length, 1);
  assertEquals(deleteCalls[0].ids, existingIds);
});

Deno.test("delete error → ok:false, stage:delete, inserted reflects the successful insert", async () => {
  const existingIds = Array.from({ length: 150 }, (_, i) => `old-${i}`);
  const insertedIds = ["new-1", "new-2", "new-3"];
  const { client, calls } = makeFakeClient({
    existingIds,
    insertedIds,
    deleteErrorOnChunkIndex: 1,
    deleteError: { message: "delete timed out" },
  });

  const result = await replaceCourseEvents(client, "course-1", [
    { title: "A" },
    { title: "B" },
    { title: "C" },
  ]);

  assertEquals(result.ok, false);
  assertEquals(result.stage, "delete");
  assertEquals(result.inserted, 3);
  assertEquals(result.error, { message: "delete timed out" });

  // First chunk (100) succeeded, second chunk (50) is the one that errored —
  // it should not attempt further chunks after the failure.
  const deleteCalls = calls.filter((c) => c.op === "delete");
  assertEquals(deleteCalls.length, 2);
});

Deno.test("select error → ok:false, stage:select, no insert or delete attempted", async () => {
  const { client, calls } = makeFakeClient({
    selectError: { message: "connection reset" },
  });

  const result = await replaceCourseEvents(client, "course-1", [{ title: "A" }]);

  assertEquals(result.ok, false);
  assertEquals(result.stage, "select");
  assertEquals(result.inserted, 0);
  assertEquals(calls.some((c) => c.op === "insert"), false);
  assertEquals(calls.some((c) => c.op === "delete"), false);
});
