import type {
  Chat,
  ChatMessage,
  Course,
  CourseSchedule,
  Event,
  GradingRules,
  Policies,
  Semester,
} from '@/lib/types';

// ─── DB → App mappers ────────────────────────────────────────────────────────
// These will be replaced by generated Supabase types once `supabase gen types` is run.

export function mapAnalysisStatus(dbStatus: string | null): Course['status'] {
  if (dbStatus === 'complete') return 'ready';
  if (dbStatus === 'failed') return 'failed';
  if (dbStatus === 'processing') return 'processing';
  return 'ready'; // null or 'pending' = no syllabus uploaded yet
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dbSemesterToApp(row: any): Semester {
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    isActive: row.is_active,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dbCourseToApp(row: any): Course {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const analysis = row.syllabus_analysis as Record<string, any> | null;
  const gradingRules: GradingRules | undefined =
    row.grading_rules ?? analysis?.grading_rules ?? undefined;
  const policies: Policies | undefined =
    row.policies ?? analysis?.policies ?? undefined;
  const schedule: CourseSchedule | undefined =
    row.schedule ?? undefined;
  return {
    id: row.id,
    semesterId: row.semester_id,
    name: row.name,
    code: row.code ?? '',
    professor: row.professor ?? '',
    color: row.color ?? '#6366f1',
    status: mapAnalysisStatus(row.analysis_status),
    syllabusUrl: row.syllabus_file_path ?? undefined,
    extractionQuality: analysis?.extraction_quality ?? undefined,
    grading_rules: gradingRules,
    policies,
    schedule,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dbEventToApp(row: any): Event {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    date: row.date ?? null,
    time: row.time ?? null,
    type: row.type as Event['type'],
    category: row.category ?? null,
    confidence: row.confidence as Event['confidence'],
    canvasMetadata: row.canvas_metadata ?? null,
    canvasAssignmentId: row.canvas_assignment_id ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dbChatToApp(row: any, courseIds: string[]): Chat {
  return {
    id: row.id,
    semesterId: row.semester_id,
    title: row.title ?? null,
    courseIds,
    createdAt: row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dbChatMessageToApp(row: any): ChatMessage {
  return {
    id: row.id,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    timestamp: row.created_at,
    sequence: row.sequence,
  };
}
