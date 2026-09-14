import { useEffect } from 'react';
import { useData } from '../context/DataProvider';
import { useProcessingPoll } from '../hooks/useProcessingPoll';
import { BulkReviewForm } from './BulkReviewForm';
import { ProcessingCourseList } from './ProcessingCourseList';
import { SyllabusDropzone } from './SyllabusDropzone';
import { useBulkUpload } from '../hooks/useBulkUpload';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import { X, Loader2, AlertCircle, ChevronRight, FileText } from 'lucide-react';

interface BulkUploadModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * When provided, every uploaded syllabus is assigned to this semester and
   * no semester detection/creation happens (the Add Course entry point,
   * SYL-61). Omit to keep the detect-and-group behaviour (Onboarding, Add
   * Semester).
   */
  fixedSemesterId?: string;
}

export function BulkUploadModal({ open, onClose, fixedSemesterId }: BulkUploadModalProps) {
  const { courses: allCourses, semesters, refreshCourses } = useData();
  const {
    step,
    fileItems,
    detectedCourses,
    createdCourseIds,
    allDone,
    globalError,
    addFiles,
    removeFile,
    reset,
    analyze,
    updateDetectedCourse,
    confirm,
    retryProcessing,
  } = useBulkUpload({ fixedSemesterId });

  const fixedSemester =
    fixedSemesterId !== undefined ? semesters.find((s) => s.id === fixedSemesterId) : undefined;
  // The Add Course entry points pass '' when there is no active semester
  // (useBulkUpload treats '' as "no semester available" and confirm() then
  // creates nothing). Block the flow up front instead of showing the
  // detect-a-semester form and silently discarding the upload (SYL-61 review).
  const noSemesterAvailable = fixedSemesterId === '';

  // Reset state whenever the modal opens
  useEffect(() => {
    if (open) reset();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll during processing; stop as soon as every course has settled
  useProcessingPoll(step === 'processing' && !allDone, refreshCourses);

  // Close automatically when all courses are done
  useEffect(() => {
    if (step !== 'processing' || !allDone) return;
    const t = setTimeout(() => onClose(), 5000);
    return () => clearTimeout(t);
  }, [step, allDone, onClose]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="rounded-2xl max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload Multiple Courses</DialogTitle>
          <DialogDescription>
            {noSemesterAvailable && 'Create a semester before uploading courses.'}
            {!noSemesterAvailable &&
              step === 'upload' &&
              "Drop your syllabi and we'll detect course info automatically."}
            {step === 'detecting' && 'Analyzing your syllabi…'}
            {step === 'review' &&
              fixedSemester &&
              `Review detected info and confirm. Courses will be added to ${fixedSemester.name}.`}
            {step === 'review' && !fixedSemester && 'Review detected info and confirm.'}
            {step === 'processing' && 'Creating your courses and processing syllabi.'}
          </DialogDescription>
        </DialogHeader>

        {globalError && (
          <Alert className="bg-red-50 border-red-200">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">{globalError}</AlertDescription>
          </Alert>
        )}

        {noSemesterAvailable && (
          <div className="space-y-3">
            <Alert className="bg-amber-50 border-amber-200">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                There is no active semester to add these courses to. Create a semester first, then
                upload your syllabi.
              </AlertDescription>
            </Alert>
            <Button variant="outline" className="w-full rounded-lg" onClick={onClose}>
              Close
            </Button>
          </div>
        )}

        {/* ── Step 1: Upload ── */}
        {!noSemesterAvailable && step === 'upload' && (
          <div className="space-y-3">
            <SyllabusDropzone multiple onFiles={addFiles} />

            {fileItems.length > 0 && (
              <Card className="p-2 rounded-lg divide-y divide-gray-100">
                {fileItems.map((fi) => (
                  <div key={fi.id} className="flex items-center justify-between px-2 py-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      <span className="text-sm text-gray-700 truncate flex-1 min-w-0">
                        {fi.file.name}
                      </span>
                      <span className="text-xs text-gray-400 shrink-0">
                        {(fi.file.size / (1024 * 1024)).toFixed(1)} MB
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-gray-400 hover:text-red-500 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(fi.id);
                      }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </Card>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1 rounded-lg" onClick={onClose}>
                Cancel
              </Button>
              <Button
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                disabled={fileItems.length === 0}
                onClick={analyze}
              >
                Analyze
                <ChevronRight className="ml-1 w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Detecting ── */}
        {!noSemesterAvailable && step === 'detecting' && (
          <div className="space-y-3 py-2">
            {fileItems.map((fi) => (
              <div key={fi.id} className="flex items-center gap-3">
                <Loader2 className="w-4 h-4 text-indigo-500 animate-spin shrink-0" />
                <span className="text-sm text-gray-700">{fi.file.name}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Step 3: Review ── */}
        {!noSemesterAvailable && step === 'review' && (
          <div className="space-y-4">
            <BulkReviewForm
              detectedCourses={detectedCourses}
              updateDetectedCourse={updateDetectedCourse}
              semesters={semesters}
              fixedSemester={fixedSemester}
            />

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 rounded-lg" onClick={onClose}>
                Cancel
              </Button>
              <Button
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                onClick={confirm}
              >
                Confirm &amp; Set Up
                <ChevronRight className="ml-1 w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 4: Processing ── */}
        {!noSemesterAvailable && step === 'processing' && (
          <div className="space-y-3">
            <ProcessingCourseList
              courseIds={createdCourseIds}
              courses={allCourses}
              onRetry={retryProcessing}
            />

            <Button variant="outline" className="w-full rounded-lg mt-2" onClick={onClose}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
