import { Upload } from 'lucide-react';
import type { Course } from '@/lib/types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

/** The "No syllabus" chip shown on a course that has nothing to chat about yet. */
export function NoSyllabusBadge() {
  return (
    <Badge variant="outline" className="text-xs text-gray-500 border-gray-300">
      No syllabus
    </Badge>
  );
}

interface UploadSyllabusButtonProps {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

/** The outline "Upload Syllabus" action for an existing course. */
export function UploadSyllabusButton({ onClick, className = '' }: UploadSyllabusButtonProps) {
  return (
    <Button size="sm" variant="outline" className={`rounded-lg ${className}`} onClick={onClick}>
      <Upload className="h-3 w-3 mr-1" />
      Upload Syllabus
    </Button>
  );
}

interface UploadExistingCourseCardProps {
  course: Course;
  onUploadSyllabus: (course: Course) => void;
}

/**
 * Sidebar card body for a course that has no usable syllabus yet: code with
 * the "No syllabus" chip, name, and the upload action (SYL-68: previously
 * inline in DashboardSidebar, with the chip + button repeated in Courses).
 */
export function UploadExistingCourseCard({ course, onUploadSyllabus }: UploadExistingCourseCardProps) {
  return (
    <div className="flex-1">
      <div className="flex items-center gap-2 mb-2">
        <div className="text-sm font-medium text-gray-500">{course.code}</div>
        <NoSyllabusBadge />
      </div>
      <div className="text-xs text-gray-500 line-clamp-1 mb-2">{course.name}</div>
      <UploadSyllabusButton className="h-7 text-xs w-full" onClick={() => onUploadSyllabus(course)} />
    </div>
  );
}
