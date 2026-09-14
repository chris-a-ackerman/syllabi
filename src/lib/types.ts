// Shared domain types for the app.
// Moved verbatim from AppContext.tsx (SYL-36) — the context imports them from here now.

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatar?: string;
  isAdmin: boolean;
  onboardingCompleted: boolean;
}

export interface Semester {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export interface CourseSchedule {
  // Meeting pattern
  meeting_days?: string[] | null;
  meeting_times?: { start: string | null; end: string | null } | null;
  location?: string | null;
  instructor?: {
    name?: string | null;
    email?: string | null;
    office?: string | null;
    office_hours?: string | null;
  } | null;
  // Semester structure
  semester_start?: string | null;
  semester_end?: string | null;
  total_weeks?: number | null;
  finals_period_start?: string | null;
  finals_period_end?: string | null;
  breaks?: Array<{ name: string; start_date: string; end_date: string }>;
  notes?: string | null;
}

export interface Policies {
  attendance?: string | null;
  late_work?: string | null;
  academic_integrity?: string | null;
  technology?: string | null;
  ai_policy?: string | null;
  recording?: string | null;
  other?: string[];
}

export interface GradingRulesComponent {
  name: string;
  weight: number;
  count?: number | null;
  description?: string | null;
  drop_lowest?: number;
}

export interface GradingRules {
  components: GradingRulesComponent[];
  late_policy?: string | null;
  grading_scale?: string | null;
}

export interface Course {
  id: string;
  semesterId: string;
  name: string;
  code: string;
  professor: string;
  color: string;
  status: 'processing' | 'ready' | 'failed';
  /** Why the last syllabus processing failed (courses.analysis_error); set when status is 'failed'. */
  analysisError?: string;
  /** Storage object key in the `syllabi` bucket (`{user}/{course}/{file}`), not a URL. */
  syllabusPath?: string;
  extractionQuality?: 'complete' | 'partial' | 'minimal';
  grading_rules?: GradingRules;
  policies?: Policies;
  schedule?: CourseSchedule;
}

/**
 * The slice of a course the course-form and upload-syllabus modals need to
 * target an existing course (SYL-68: previously also `UploadTarget` here and
 * an identical `CourseModalTarget` interface in CourseFormModal).
 */
export type CourseModalTarget = Pick<Course, 'id' | 'name' | 'code' | 'professor' | 'color'>;

export interface CanvasMetadata {
  points_possible: number | null;
  submission_types: string[] | null;
  assignment_group: string | null;
  description_summary: string | null;
  canvas_url: string | null;
  unlock_at: string | null;
  allowed_attempts: number | null;
  time_limit: number | null;
}

/** `profiles_safe` view columns the Canvas connect/disconnect UI needs. */
export interface CanvasProfile {
  has_canvas_connected: boolean;
  canvas_base_url: string | null;
}

/** One `find-canvas-courses` result item — a Canvas course candidate for import. */
export interface CanvasCourseCandidate {
  canvas_course_id: string;
  name: string;
  course_code: string | null;
  instructor: string | null;
  term_name: string | null;
  term_start: string | null;
  term_end: string | null;
  has_syllabus: boolean;
  needs_review: boolean;
}

export interface FindCanvasCoursesResponse {
  courses: CanvasCourseCandidate[];
  total_found: number;
  needs_review_count: number;
}

export type CanvasSyllabusSourceType = 'file' | 'html' | 'page';

export interface CanvasSyllabusFindResult {
  success: boolean;
  found: boolean;
  course_id: string;
  reason?: string;
  source_type?: CanvasSyllabusSourceType;
  file_name?: string | null;
  file_url?: string | null;
  html_content?: string | null;
  confidence?: 'high' | 'medium';
}

export interface CanvasSyllabusDownloadResult {
  success: boolean;
  course_id?: string;
  file_name?: string;
  file_path?: string;
  processing?: boolean;
}

export interface SaveCanvasTokenResult {
  success: true;
  canvas_user: string;
}

export interface DeleteCanvasTokenResult {
  success: true;
}

/** `profiles_safe` view columns the Settings page's two cards need (SYL-72). */
export interface ApiKeyStatus {
  has_canvas_connected: boolean;
  canvas_base_url: string | null;
  canvas_token_last_tested_at: string | null;
  canvas_token_last_test_ok: boolean | null;
  has_anthropic_key: boolean;
  anthropic_key_last4: string | null;
  anthropic_key_added_at: string | null;
  anthropic_key_last_tested_at: string | null;
  anthropic_key_last_test_ok: boolean | null;
}

export interface SaveAnthropicKeyResult {
  ok: true;
  last4: string;
}

export interface TestAnthropicKeyResult {
  ok: boolean;
  tested_at: string;
}

export interface TestCanvasTokenResult {
  ok: boolean;
  canvas_user?: string | null;
  reason?: 'rejected' | 'unreachable';
}

/** Where a course_events row came from (matches the DB CHECK constraint). */
export type EventSource = 'syllabus' | 'canvas_matched' | 'canvas' | 'canvas_deleted';

export interface Event {
  id: string;
  courseId: string;
  title: string;
  date: string | null;
  /** The raw date text when the parser could not resolve `date` (e.g. "Week 5"). */
  dateUnresolved?: string | null;
  time?: string | null;
  type: 'exam' | 'deadline' | 'quiz' | 'presentation' | 'project_due' | 'no_class' | 'other';
  category?: string | null;
  canvasAssignmentId?: string | null;
  confidence?: 'low' | 'medium' | 'high';
  canvasMetadata?: CanvasMetadata | null;
  source?: EventSource;
  /** True for rows match-canvas-assignments inserted from Canvas with no syllabus counterpart. */
  canvasOnly?: boolean;
}

export interface Note {
  id: string;
  courseId: string;
  text: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sequence?: number;
}

export interface Chat {
  id: string;
  semesterId: string;
  title: string | null;
  courseIds: string[];
  createdAt: string;
}

