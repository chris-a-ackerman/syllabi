import { beforeEach, describe, expect, it, vi } from 'vitest';

// SYL-66: pins uploadAndProcess's partial-failure contract. Each stage that
// fails after the file reached Storage must still return `data.path`, because
// UploadSyllabusModal.handleCancelAfterError deletes the orphaned object with
// it. Also pins the row writes the bulk flow's poll now depends on.

interface RecordedUpdate {
  table: string;
  payload: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

const {
  uploadResult,
  updateResult,
  invokeResult,
  selectResult,
  updates,
  uploadCalls,
  invokeCalls,
} = vi.hoisted(() => ({
  uploadResult: vi.fn(),
  updateResult: vi.fn(),
  invokeResult: vi.fn(),
  selectResult: vi.fn(),
  updates: [] as RecordedUpdate[],
  uploadCalls: [] as unknown[][],
  invokeCalls: [] as unknown[][],
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: (...args: unknown[]) => {
          uploadCalls.push(args);
          return Promise.resolve(uploadResult());
        },
      }),
    },
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => {
        const record: RecordedUpdate = { table, payload, filters: [] };
        updates.push(record);
        const query = {
          eq(column: string, value: unknown) {
            record.filters.push([column, value]);
            return query;
          },
          then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
            return Promise.resolve(updateResult(record)).then(resolve, reject);
          },
        };
        return query;
      },
      select: () => ({
        eq: () => ({ single: () => Promise.resolve(selectResult()) }),
      }),
    }),
    functions: {
      invoke: (...args: unknown[]) => {
        invokeCalls.push(args);
        return Promise.resolve(invokeResult());
      },
    },
  },
}));

import { markSyllabusFailed, reprocessSyllabus, uploadAndProcess } from './syllabus';

const file = new File([new TextEncoder().encode('%PDF-1.4\n')], 'syllabus.pdf', {
  type: 'application/pdf',
});
const STORAGE_PATH = 'u1/c1/syllabus.pdf';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  uploadCalls.length = 0;
  invokeCalls.length = 0;
  uploadResult.mockReturnValue({ error: null });
  updateResult.mockReturnValue({ error: null });
  invokeResult.mockReturnValue({
    data: { success: true, events_created: 3, completeness: 'complete' },
    error: null,
  });
  selectResult.mockReturnValue({ data: { canvas_course_id: null } });
});

describe('uploadAndProcess', () => {
  it('reports an unreadable file before anything is uploaded', async () => {
    const unreadable = {
      name: 'cloud.pdf',
      arrayBuffer: () => Promise.reject(new Error('EIO')),
    } as unknown as File;
    const result = await uploadAndProcess('u1', 'c1', unreadable);
    expect(result.data.path).toBeNull();
    expect(result.error?.message).toMatch(/Could not read file/);
    expect(uploadCalls).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('returns no path and touches nothing else when the Storage upload fails', async () => {
    uploadResult.mockReturnValue({ error: { message: 'bucket quota exceeded' } });
    const result = await uploadAndProcess('u1', 'c1', file);
    expect(result).toEqual({
      data: { path: null },
      error: { message: 'Upload failed: bucket quota exceeded' },
    });
    expect(updates).toHaveLength(0);
    expect(invokeCalls).toHaveLength(0);
  });

  it('returns the Storage path on a post-upload failure (courses.update fails)', async () => {
    updateResult.mockReturnValue({ error: { message: 'row-level security' } });
    const result = await uploadAndProcess('u1', 'c1', file);
    // The file is in Storage, so the caller must be able to roll it back.
    expect(result.data.path).toBe(STORAGE_PATH);
    expect(result.error?.message).toBe('Failed to save file path: row-level security');
    expect(invokeCalls).toHaveLength(0);
  });

  it('records the path and flips the row to processing before invoking the function', async () => {
    const onStage = vi.fn();
    const result = await uploadAndProcess('u1', 'c1', file, { awaitProcessing: true, onStage });
    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      path: STORAGE_PATH,
      fnData: { success: true, events_created: 3, completeness: 'complete' },
    });
    expect(uploadCalls[0][0]).toBe(STORAGE_PATH);
    expect(updates).toEqual([
      {
        table: 'courses',
        payload: {
          syllabus_file_path: STORAGE_PATH,
          syllabus_file_name: 'syllabus.pdf',
          analysis_status: 'processing',
          analysis_error: null,
        },
        filters: [['id', 'c1']],
      },
    ]);
    expect(invokeCalls).toEqual([['process-syllabus', { body: { course_id: 'c1' } }]]);
    expect(onStage.mock.calls.map((c) => c[0])).toEqual(['uploading', 'processing']);
  });

  it('awaitProcessing: returns the path with the transport error when the invoke fails', async () => {
    invokeResult.mockReturnValue({
      data: null,
      error: { message: 'Edge Function returned a non-2xx status code' },
    });
    const result = await uploadAndProcess('u1', 'c1', file, { awaitProcessing: true });
    expect(result.data.path).toBe(STORAGE_PATH);
    expect(result.error?.message).toBe(
      'Processing failed: Edge Function returned a non-2xx status code'
    );
    // The single-course flow owns the failure here; nothing is written back.
    expect(updates).toHaveLength(1);
  });

  it("awaitProcessing: returns the path, fnData and the function's own error when success is false", async () => {
    invokeResult.mockReturnValue({
      data: { success: false, error: 'Failed to save course events' },
      error: null,
    });
    const result = await uploadAndProcess('u1', 'c1', file, { awaitProcessing: true });
    expect(result.data).toEqual({
      path: STORAGE_PATH,
      fnData: { success: false, error: 'Failed to save course events' },
    });
    expect(result.error?.message).toBe('Failed to save course events');
  });

  it('fire-and-forget: resolves at once, then marks a still-processing row failed when the invoke fails', async () => {
    invokeResult.mockReturnValue({ data: null, error: { message: 'FunctionsFetchError' } });
    const result = await uploadAndProcess('u1', 'c1', file);
    expect(result).toEqual({ data: { path: STORAGE_PATH }, error: null });

    await flush();
    expect(updates).toHaveLength(2);
    expect(updates[1]).toEqual({
      table: 'courses',
      payload: {
        analysis_status: 'failed',
        analysis_error: 'Processing failed: FunctionsFetchError',
      },
      // Compare-and-set: a row the function already settled keeps its own status/message.
      filters: [
        ['id', 'c1'],
        ['analysis_status', 'processing'],
      ],
    });
  });

  it('fire-and-forget: leaves the row to the function when the invoke succeeds', async () => {
    const result = await uploadAndProcess('u1', 'c1', file);
    expect(result).toEqual({ data: { path: STORAGE_PATH }, error: null });
    await flush();
    expect(updates).toHaveLength(1);
  });
});

describe('markSyllabusFailed', () => {
  it('writes the failed status and message for the course', async () => {
    const { error } = await markSyllabusFailed('c9', 'Upload failed: boom');
    expect(error).toBeNull();
    expect(updates).toEqual([
      {
        table: 'courses',
        payload: { analysis_status: 'failed', analysis_error: 'Upload failed: boom' },
        filters: [['id', 'c9']],
      },
    ]);
  });

  it('adds the processing guard when asked', async () => {
    await markSyllabusFailed('c9', 'x', { onlyIfProcessing: true });
    expect(updates[0].filters).toEqual([
      ['id', 'c9'],
      ['analysis_status', 'processing'],
    ]);
  });

  it('surfaces the write error', async () => {
    updateResult.mockReturnValue({ error: { message: 'offline' } });
    const { error } = await markSyllabusFailed('c9', 'x');
    expect(error).toEqual({ message: 'offline' });
  });
});

describe('reprocessSyllabus', () => {
  it('flips the row back to processing, re-invokes, and resolves cleanly on success', async () => {
    const { error } = await reprocessSyllabus('c1');
    expect(error).toBeNull();
    expect(updates).toEqual([
      {
        table: 'courses',
        payload: { analysis_status: 'processing', analysis_error: null },
        filters: [['id', 'c1']],
      },
    ]);
    expect(invokeCalls).toEqual([['process-syllabus', { body: { course_id: 'c1' } }]]);
  });

  it('records and returns a transport failure', async () => {
    invokeResult.mockReturnValue({ data: null, error: { message: '429' } });
    const { error } = await reprocessSyllabus('c1');
    expect(error).toEqual({ message: 'Processing failed: 429' });
    expect(updates[1]).toEqual({
      table: 'courses',
      payload: { analysis_status: 'failed', analysis_error: 'Processing failed: 429' },
      filters: [
        ['id', 'c1'],
        ['analysis_status', 'processing'],
      ],
    });
  });
});
