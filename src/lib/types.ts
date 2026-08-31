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
  syllabusUrl?: string;
  extractionQuality?: 'complete' | 'partial' | 'minimal';
  extractedCount?: number;
  grading_rules?: GradingRules;
  policies?: Policies;
  schedule?: CourseSchedule;
}

/** The slice of a course the upload-syllabus flow needs to target it. */
export type UploadTarget = Pick<Course, 'id' | 'name' | 'code' | 'color'>;

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

export interface Event {
  id: string;
  courseId: string;
  title: string;
  date: string | null;
  time?: string | null;
  type: 'exam' | 'deadline' | 'quiz' | 'presentation' | 'project_due' | 'no_class' | 'other';
  category?: string | null;
  canvasAssignmentId?: string | null;
  confidence?: 'low' | 'medium' | 'high';
  canvasMetadata?: CanvasMetadata | null;
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

