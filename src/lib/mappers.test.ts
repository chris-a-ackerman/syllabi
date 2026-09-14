import { describe, expect, it } from 'vitest';
import {
  dbChatMessageToApp,
  dbChatToApp,
  dbCourseToApp,
  dbEventToApp,
  dbNoteToApp,
  dbSemesterToApp,
  mapAnalysisStatus,
} from './mappers';

describe('mapAnalysisStatus', () => {
  it('maps DB statuses to app statuses', () => {
    expect(mapAnalysisStatus('complete')).toBe('ready');
    expect(mapAnalysisStatus('failed')).toBe('failed');
    expect(mapAnalysisStatus('processing')).toBe('processing');
  });

  it('treats null and unknown values as ready (no syllabus uploaded yet)', () => {
    expect(mapAnalysisStatus(null)).toBe('ready');
    expect(mapAnalysisStatus('pending')).toBe('ready');
  });
});

describe('dbSemesterToApp', () => {
  it('converts snake_case row to camelCase semester', () => {
    expect(
      dbSemesterToApp({
        id: 's1',
        name: 'Fall 2026',
        start_date: '2026-08-24',
        end_date: '2026-12-18',
        is_active: true,
      }),
    ).toEqual({
      id: 's1',
      name: 'Fall 2026',
      startDate: '2026-08-24',
      endDate: '2026-12-18',
      isActive: true,
    });
  });

  it('coerces a null is_active to false', () => {
    const row = { id: 's2', name: 'Old', start_date: '2025-01-06', end_date: '2025-05-02', is_active: null };
    expect(dbSemesterToApp(row).isActive).toBe(false);
  });
});

describe('dbCourseToApp', () => {
  const baseRow = {
    id: 'c1',
    semester_id: 's1',
    name: 'Intro to Testing',
    code: null,
    professor: null,
    color: null,
    analysis_status: null,
    syllabus_file_path: null,
    syllabus_analysis: null,
  };

  it('applies defaults for null columns', () => {
    const course = dbCourseToApp(baseRow);
    expect(course.code).toBe('');
    expect(course.professor).toBe('');
    expect(course.color).toBe('#6366f1');
    expect(course.status).toBe('ready');
    expect(course.analysisError).toBeUndefined();
    expect(course.syllabusPath).toBeUndefined();
    expect(course.grading_rules).toBeUndefined();
    expect(course.policies).toBeUndefined();
    expect(course.schedule).toBeUndefined();
  });

  it('maps a failed row with its analysis_error (SYL-66)', () => {
    const course = dbCourseToApp({ ...baseRow, analysis_status: 'failed', analysis_error: 'Upload failed: boom' });
    expect(course.status).toBe('failed');
    expect(course.analysisError).toBe('Upload failed: boom');
  });

  it('prefers dedicated columns over the syllabus_analysis blob', () => {
    const columnRules = { components: [{ name: 'Exams', weight: 0.4 }] };
    const analysisRules = { components: [{ name: 'Old', weight: 0.1 }] };
    const course = dbCourseToApp({
      ...baseRow,
      grading_rules: columnRules,
      syllabus_analysis: { grading_rules: analysisRules, policies: { late_work: 'none' } },
    });
    expect(course.grading_rules).toBe(columnRules);
    // policies column absent → falls back to the analysis blob
    expect(course.policies).toEqual({ late_work: 'none' });
  });

  it('falls back to syllabus_analysis when columns are null', () => {
    const analysisRules = { components: [{ name: 'HW', weight: 0.2 }] };
    const course = dbCourseToApp({
      ...baseRow,
      grading_rules: null,
      syllabus_analysis: {
        grading_rules: analysisRules,
        extraction_quality: 'partial',
      },
    });
    expect(course.grading_rules).toBe(analysisRules);
    expect(course.extractionQuality).toBe('partial');
  });

  it('does NOT fall back to the analysis blob for schedule (column only)', () => {
    const course = dbCourseToApp({
      ...baseRow,
      syllabus_analysis: { schedule: { location: 'Hall 5' } },
    });
    expect(course.schedule).toBeUndefined();
  });
});

describe('dbEventToApp', () => {
  it('converts a full row', () => {
    expect(
      dbEventToApp({
        id: 'e1',
        course_id: 'c1',
        title: 'Midterm',
        date: '2026-10-12',
        time: '09:00',
        type: 'exam',
        category: 'Exams',
        confidence: 'high',
        canvas_metadata: { points_possible: 100 },
        canvas_assignment_id: '42',
        source: 'canvas_matched',
        canvas_only: false,
      }),
    ).toEqual({
      id: 'e1',
      courseId: 'c1',
      title: 'Midterm',
      date: '2026-10-12',
      dateUnresolved: null,
      time: '09:00',
      type: 'exam',
      category: 'Exams',
      confidence: 'high',
      canvasMetadata: { points_possible: 100 },
      canvasAssignmentId: '42',
      source: 'canvas_matched',
      canvasOnly: false,
    });
  });

  it('nulls optional fields that are absent and applies the Canvas column defaults', () => {
    const event = dbEventToApp({ id: 'e2', course_id: 'c1', title: 'TBD', type: 'other' });
    expect(event.date).toBeNull();
    expect(event.dateUnresolved).toBeNull();
    expect(event.time).toBeNull();
    expect(event.category).toBeNull();
    expect(event.canvasMetadata).toBeNull();
    expect(event.canvasAssignmentId).toBeNull();
    expect(event.source).toBe('syllabus');
    expect(event.canvasOnly).toBe(false);
  });

  it('maps the Canvas-only columns written by match-canvas-assignments (SYL-69)', () => {
    const event = dbEventToApp({
      id: 'e3',
      course_id: 'c1',
      title: 'Canvas quiz',
      date: null,
      date_unresolved: 'Week 5',
      type: 'deadline',
      source: 'canvas',
      canvas_only: true,
      canvas_assignment_id: '77',
    });
    expect(event.dateUnresolved).toBe('Week 5');
    expect(event.source).toBe('canvas');
    expect(event.canvasOnly).toBe(true);
  });
});

describe('dbChatToApp / dbChatMessageToApp', () => {
  it('maps chat rows with supplied courseIds', () => {
    expect(
      dbChatToApp(
        { id: 'ch1', semester_id: 's1', title: null, created_at: '2026-08-28T00:00:00Z' },
        ['c1', 'c2'],
      ),
    ).toEqual({
      id: 'ch1',
      semesterId: 's1',
      title: null,
      courseIds: ['c1', 'c2'],
      createdAt: '2026-08-28T00:00:00Z',
    });
  });

  it('maps message rows including sequence', () => {
    expect(
      dbChatMessageToApp({
        id: 'm1',
        role: 'assistant',
        content: 'Hello',
        created_at: '2026-08-28T00:00:01Z',
        sequence: 2,
      }),
    ).toEqual({
      id: 'm1',
      role: 'assistant',
      content: 'Hello',
      timestamp: '2026-08-28T00:00:01Z',
      sequence: 2,
    });
  });
});

describe('dbNoteToApp', () => {
  it('maps a course_notes row, renaming body -> text', () => {
    expect(
      dbNoteToApp({
        id: 'n1',
        course_id: 'c1',
        user_id: 'u1',
        body: 'Midterm covers ch 1-5',
        created_at: '2026-08-01T12:00:00Z',
      })
    ).toEqual({
      id: 'n1',
      courseId: 'c1',
      text: 'Midterm covers ch 1-5',
      createdAt: '2026-08-01T12:00:00Z',
    });
  });
});
