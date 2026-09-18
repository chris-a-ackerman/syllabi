import { Check, Loader2, RefreshCw, X } from 'lucide-react';
import type { Course } from '@/lib/types';
import { Button } from './ui/button';
import { Card } from './ui/card';

interface ProcessingCourseListProps {
  /** Created course ids in creation order; a course missing from `courses` renders as processing. */
  courseIds: string[];
  courses: Course[];
  onRetry: (courseId: string) => void;
  /** 'page' is the card-per-course full-page styling (Onboarding); default is the compact modal list. */
  variant?: 'compact' | 'page';
}

/**
 * Per-course Processing / Done / Failed + Retry list shown while syllabi are
 * being processed (SYL-68: previously duplicated in BulkUploadModal and
 * Onboarding). Failed courses show the recorded reason (SYL-66).
 */
export function ProcessingCourseList({
  courseIds,
  courses,
  onRetry,
  variant = 'compact',
}: ProcessingCourseListProps) {
  const page = variant === 'page';
  const text = page ? 'text-sm' : 'text-xs';
  const icon = page ? 'w-4 h-4' : 'w-3.5 h-3.5';

  return (
    <div className={page ? 'space-y-4' : 'space-y-3'}>
      {courseIds.map((courseId) => {
        const course = courses.find((c) => c.id === courseId);
        const row = (
          <>
            <div className="min-w-0">
              <p className={`font-medium text-gray-900 ${page ? '' : 'text-sm'}`}>
                {course?.code || '—'}
              </p>
              <p className={`${text} text-gray-500 truncate`}>{course?.name}</p>
              {course?.status === 'failed' && course.analysisError && (
                <p className="text-xs text-red-600 mt-0.5">{course.analysisError}</p>
              )}
            </div>
            <div className="flex items-center gap-2 ml-4 shrink-0">
              {(!course || course.status === 'processing') && (
                <span className={`flex items-center gap-1 ${text} text-indigo-600`}>
                  <Loader2 className={`${icon} animate-spin`} />
                  Processing
                </span>
              )}
              {course?.status === 'ready' && (
                <span className={`flex items-center gap-1 ${text} text-green-600`}>
                  <Check className={icon} />
                  Done
                </span>
              )}
              {course?.status === 'failed' && (
                <>
                  <span className={`flex items-center gap-1 ${text} text-red-600`}>
                    <X className={icon} />
                    Failed
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className={`text-xs rounded-lg ${page ? 'h-7' : 'h-6 px-2'}`}
                    onClick={() => onRetry(courseId)}
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Retry
                  </Button>
                </>
              )}
            </div>
          </>
        );
        return page ? (
          <Card key={courseId} className="p-4 rounded-xl">
            <div className="flex items-center justify-between">{row}</div>
          </Card>
        ) : (
          <div
            key={courseId}
            className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
          >
            {row}
          </div>
        );
      })}
    </div>
  );
}
