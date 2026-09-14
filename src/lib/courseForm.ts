import { nextCourseColor } from './courseColors';
import type { CourseModalTarget } from './types';

/** The editable field set shared by the manual course form and the post-upload review form. */
export interface CourseFormValues {
  name: string;
  code: string;
  professor: string;
  color: string;
}

/**
 * Initial form values for the course modals (SYL-62).
 *
 * Targeting an existing course seeds every field from it, so re-uploading a
 * syllabus or editing details keeps the course's colour unless the user
 * changes it. A new course starts blank with the next free palette colour
 * relative to `existingCourses` (the courses already in the semester).
 */
export function initialFormValues(
  existingCourse?: CourseModalTarget,
  existingCourses: ReadonlyArray<{ color: string }> = [],
): CourseFormValues {
  if (existingCourse) {
    return {
      name: existingCourse.name,
      code: existingCourse.code,
      professor: existingCourse.professor,
      color: existingCourse.color,
    };
  }
  return { name: '', code: '', professor: '', color: nextCourseColor(existingCourses) };
}
