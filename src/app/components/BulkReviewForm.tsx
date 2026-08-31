import { Card } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Alert, AlertDescription } from './ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { AlertCircle, FileText } from 'lucide-react';
import type { DetectedCourse } from '../hooks/useBulkUpload';
import type { Semester } from '@/lib/types';

interface BulkReviewFormProps {
  detectedCourses: DetectedCourse[];
  updateDetectedCourse: (
    id: string,
    updates: Partial<Pick<DetectedCourse, 'courseName' | 'courseCode' | 'semesterName' | 'semesterStart' | 'semesterEnd'>>
  ) => void;
  /** 'page' is the larger full-page styling (Onboarding); default is the modal scale. */
  variant?: 'compact' | 'page';
  /**
   * When provided, each group gets a "use existing semester" dropdown that
   * propagates the picked semester's name and dates to the whole group and
   * hides the manual fields (the BulkUploadModal flow).
   */
  semesters?: Semester[];
  /** Show the per-file detection-confidence chip (Onboarding). */
  showConfidence?: boolean;
}

/**
 * The review-detected-courses card list: courses grouped by detected semester,
 * with semester fields propagating to every course in the group (SYL-41:
 * previously triplicated in BulkUploadModal, AddSemesterModal, Onboarding).
 * Cards are keyed by their first course id — never by the semester name being
 * edited, which remounted the card and dropped input focus on each keystroke.
 */
export function BulkReviewForm({
  detectedCourses,
  updateDetectedCourse,
  variant = 'compact',
  semesters,
  showConfidence = false,
}: BulkReviewFormProps) {
  const compact = variant === 'compact';

  const semesterGroups = detectedCourses.reduce<Record<string, DetectedCourse[]>>(
    (acc, dc) => {
      const key = dc.semesterName.trim() || '__unknown__';
      if (!acc[key]) acc[key] = [];
      acc[key].push(dc);
      return acc;
    },
    {}
  );

  const propagate = (
    groupCourses: DetectedCourse[],
    updates: Partial<Pick<DetectedCourse, 'semesterName' | 'semesterStart' | 'semesterEnd'>>,
  ) => {
    groupCourses.forEach(dc => updateDetectedCourse(dc.id, updates));
  };

  const semLabelCls = compact ? 'text-xs' : undefined;
  const semInputCls = compact ? 'mt-1 rounded-lg h-8 text-sm' : 'mt-1 rounded-lg';

  return (
    <>
      {Object.values(semesterGroups).map((groupCourses) => {
        const matchedSem = semesters?.find(s => s.name === groupCourses[0].semesterName);
        return (
          <Card
            key={groupCourses[0].id}
            className={compact ? 'p-4 rounded-xl space-y-3' : 'p-6 rounded-2xl space-y-4'}
          >
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Semester</p>

            {semesters && semesters.length > 0 && (
              <div>
                <Label className={semLabelCls}>Use existing semester</Label>
                <Select
                  value={matchedSem?.id ?? '__new__'}
                  onValueChange={(semesterId) => {
                    if (semesterId === '__new__') return;
                    const sem = semesters.find(s => s.id === semesterId);
                    if (!sem) return;
                    propagate(groupCourses, {
                      semesterName: sem.name,
                      semesterStart: sem.startDate,
                      semesterEnd: sem.endDate,
                    });
                  }}
                >
                  <SelectTrigger className={semInputCls}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg">
                    <SelectItem value="__new__">Create new semester</SelectItem>
                    {semesters.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Manual fields only when not mapped onto an existing semester */}
            {!matchedSem && (
              <div className={compact ? 'space-y-2' : 'space-y-3'}>
                <div>
                  <Label className={semLabelCls}>Semester Name</Label>
                  <Input
                    value={groupCourses[0].semesterName}
                    onChange={(e) => propagate(groupCourses, { semesterName: e.target.value })}
                    placeholder="e.g. Spring 2026"
                    className={semInputCls}
                  />
                </div>
                <div className={compact ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-2 gap-3'}>
                  <div>
                    <Label className={semLabelCls}>Start Date</Label>
                    <Input
                      type="date"
                      value={groupCourses[0].semesterStart}
                      onChange={(e) => propagate(groupCourses, { semesterStart: e.target.value })}
                      className={semInputCls}
                    />
                  </div>
                  <div>
                    <Label className={semLabelCls}>End Date</Label>
                    <Input
                      type="date"
                      value={groupCourses[0].semesterEnd}
                      onChange={(e) => propagate(groupCourses, { semesterEnd: e.target.value })}
                      className={semInputCls}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className={compact ? 'border-t border-gray-100 pt-3 space-y-3' : 'border-t border-gray-100 pt-4 space-y-4'}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Courses</p>
              {groupCourses.map((dc) => (
                <div key={dc.id} className="space-y-2">
                  {dc.error && (
                    <Alert className={`${compact ? 'py-1.5' : 'py-2'} bg-amber-50 border-amber-200`}>
                      <AlertCircle className="h-3 w-3 text-amber-500" />
                      <AlertDescription className="text-xs text-amber-800">
                        Detection failed — fill in the fields below manually.
                      </AlertDescription>
                    </Alert>
                  )}
                  <div className="flex items-center gap-2 text-xs text-gray-400 min-w-0">
                    <FileText className="w-3 h-3 shrink-0" />
                    <span className="truncate min-w-0">{dc.fileItem.file.name}</span>
                    {showConfidence && !dc.error && (
                      <span className={`ml-auto shrink-0 ${
                        dc.confidence === 'high' ? 'text-green-500' :
                        dc.confidence === 'medium' ? 'text-amber-500' : 'text-gray-400'
                      }`}>
                        {dc.confidence} confidence
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Course Name</Label>
                      <Input
                        value={dc.courseName}
                        onChange={(e) => updateDetectedCourse(dc.id, { courseName: e.target.value })}
                        placeholder="e.g. Calculus II"
                        className="mt-1 rounded-lg h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Course Code</Label>
                      <Input
                        value={dc.courseCode}
                        onChange={(e) => updateDetectedCourse(dc.id, { courseCode: e.target.value })}
                        placeholder="e.g. MATH 202"
                        className="mt-1 rounded-lg h-8 text-sm"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })}
    </>
  );
}
