import { useState } from 'react';
import { useAuth } from '../context/AuthProvider';
import { useData } from '../context/DataProvider';
import { deleteCourse, fetchCourse } from '@/lib/api/courses';
import {
  matchCanvasAssignmentsIfLinked,
  removeSyllabusFile,
  uploadAndProcess,
} from '@/lib/api/syllabus';
import { COURSE_COLORS } from '@/lib/courseColors';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { AddCourseChooser } from './AddCourseChooser';
import { SyllabusDropzone } from './SyllabusDropzone';
import { CourseFormFields, type CourseFormValues } from './CourseFormFields';
import type { CourseModalTarget } from './CourseFormModal';

interface UploadSyllabusModalProps {
  open: boolean;
  onClose: () => void;
  /** When set, the chooser is skipped and the upload targets this course. */
  existingCourse?: CourseModalTarget;
  /** Chooser cards — the caller swaps this modal for the matching flow. */
  onCreateManually?: () => void;
  onBulkUpload?: () => void;
}

type Step = 'choose' | 'upload' | 'processing' | 'review' | 'error';

const EMPTY_VALUES: CourseFormValues = { name: '', code: '', professor: '', color: COURSE_COLORS[0] };

/** Single-syllabus upload → process → review flow (SYL-39: split out of AddCourseModal). */
export function UploadSyllabusModal({ open, ...props }: UploadSyllabusModalProps) {
  // Mounted only while open so flow state initializes fresh from props each time
  if (!open) return null;
  return <UploadSyllabusModalContent {...props} />;
}

function UploadSyllabusModalContent({ onClose, existingCourse, onCreateManually, onBulkUpload }: Omit<UploadSyllabusModalProps, 'open'>) {
  const { addCourse, updateCourse, refreshCourses, refreshEvents, semesters } = useData();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>(existingCourse ? 'upload' : 'choose');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Upload flow tracking
  const [createdCourseId, setCreatedCourseId] = useState<string | null>(null);
  const [uploadedFilePath, setUploadedFilePath] = useState<string | null>(null);
  const [processingLog, setProcessingLog] = useState<string[]>([]);
  const [processingError, setProcessingError] = useState<string | null>(null);

  // Review form state
  const [values, setValues] = useState<CourseFormValues>(EMPTY_VALUES);
  const [extractionQuality, setExtractionQuality] = useState<'complete' | 'partial' | 'minimal'>('complete');
  const [extractedCount, setExtractedCount] = useState(0);

  const activeSemester = semesters.find(s => s.isActive);

  const handleContinue = async () => {
    if (!selectedFile || !activeSemester || !user) return;

    setStep('processing');
    setProcessingLog([]);
    setProcessingError(null);

    try {
      let courseId: string;

      if (existingCourse) {
        courseId = existingCourse.id;
      } else {
        // 1. Create a placeholder course record so we have an ID for the file path
        setProcessingLog(['Creating course record...']);
        const newId = await addCourse({
          semesterId: activeSemester.id,
          name: selectedFile.name.replace(/\.[^.]+$/, ''),
          code: '',
          professor: '',
          color: values.color,
          status: 'processing',
        });
        if (!newId) throw new Error('Failed to create course record');
        courseId = newId;
        setCreatedCourseId(newId);
      }

      // 2. Upload to Storage, record the path, and run process-syllabus
      //    (synchronous — waits for Claude)
      const { data: result, error: pipelineError } = await uploadAndProcess(
        user.id,
        courseId,
        selectedFile,
        {
          awaitProcessing: true,
          onStage: (stage) =>
            setProcessingLog(prev => [
              ...prev,
              stage === 'uploading'
                ? 'Uploading syllabus file...'
                : 'Analyzing syllabus with AI (this takes ~30 seconds)...',
            ]),
        }
      );
      if (result.path) setUploadedFilePath(result.path);
      if (pipelineError) throw new Error(pipelineError.message);

      setProcessingLog(prev => [...prev, `Done! Extracted ${result.fnData?.events_created} events.`]);

      // 3. Pull updated courses and events into context so all data is visible immediately
      await Promise.all([refreshCourses(), refreshEvents()]);

      // 4. Fetch the updated course to populate the review form
      const { data: updatedCourse } = await fetchCourse(courseId);

      if (updatedCourse) {
        setValues(prev => ({
          ...prev,
          name: updatedCourse.name || '',
          code: updatedCourse.code || '',
          professor: updatedCourse.professor || '',
        }));

        setExtractionQuality(result.fnData?.completeness ?? 'partial');
        setExtractedCount(result.fnData?.events_created ?? 0);

        // Fire-and-forget Canvas matching for courses connected to Canvas
        matchCanvasAssignmentsIfLinked(courseId);
      }

      setStep('review');
    } catch (err: unknown) {
      console.error('Syllabus processing error:', err);
      const message = err instanceof Error ? err.message : 'An unexpected error occurred';
      setProcessingError(message);
      setStep('error');
    }
  };

  const handleSave = () => {
    // In the upload flow the course already exists in DB — just persist any user edits
    const courseId = createdCourseId ?? existingCourse?.id;
    if (courseId) {
      updateCourse(courseId, {
        name: values.name,
        code: values.code,
        professor: values.professor,
        color: values.color,
      });
    }
    onClose();
  };


  const handleCancelAfterError = async () => {
    if (uploadedFilePath) {
      await removeSyllabusFile(uploadedFilePath);
    }
    if (createdCourseId) {
      await deleteCourse(createdCourseId);
      await refreshCourses();
    }
    onClose();
  };

  const getQualityColor = (quality: string) => {
    switch (quality) {
      case 'complete': return 'bg-green-100 text-green-800';
      case 'partial': return 'bg-yellow-100 text-yellow-800';
      case 'minimal': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="rounded-2xl max-w-2xl">
        {step === 'choose' && (
          <AddCourseChooser
            onUpload={() => setStep('upload')}
            onCreateManually={() => onCreateManually?.()}
            onBulkUpload={() => onBulkUpload?.()}
            onCancel={onClose}
          />
        )}

        {step === 'upload' && (
          <>
            <DialogHeader>
              <DialogTitle>
                {existingCourse ? `Upload Syllabus for ${existingCourse.code}` : 'Upload Syllabus'}
              </DialogTitle>
              <DialogDescription>
                {existingCourse
                  ? `Upload a syllabus for ${existingCourse.name} to extract course information and enable AI chat.`
                  : 'Upload your syllabus to automatically extract course information.'
                }
              </DialogDescription>
            </DialogHeader>

            <div className="py-4">
              <SyllabusDropzone selectedFile={selectedFile} onSelect={setSelectedFile} />
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={existingCourse ? onClose : () => { setSelectedFile(null); setStep('choose'); }}
                className="rounded-lg"
              >
                {existingCourse ? 'Cancel' : 'Back'}
              </Button>
              <Button
                onClick={handleContinue}
                disabled={!selectedFile}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                Continue
              </Button>
            </div>
          </>
        )}

        {step === 'processing' && (
          <div className="py-10 space-y-6">
            <div className="text-center">
              <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-1">
                Reading your syllabus...
              </h3>
              <p className="text-sm text-gray-500">
                This usually takes 20–40 seconds.
              </p>
            </div>

            {processingLog.length > 0 && (
              <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                {processingLog.map((msg, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    {i < processingLog.length - 1 ? (
                      <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                    ) : (
                      <Loader2 className="w-4 h-4 text-indigo-500 animate-spin flex-shrink-0" />
                    )}
                    <span className={i < processingLog.length - 1 ? 'text-gray-500' : 'text-gray-900 font-medium'}>
                      {msg}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 'error' && (
          <>
            <DialogHeader>
              <DialogTitle>Processing Failed</DialogTitle>
            </DialogHeader>

            <div className="py-6 space-y-4">
              <div className="flex justify-center">
                <AlertCircle className="w-12 h-12 text-red-500" />
              </div>
              <p className="text-sm text-gray-600 text-center">
                {processingError || 'Something went wrong while processing your syllabus.'}
              </p>
            </div>

            <div className="flex gap-3 pt-4">
              <Button variant="outline" onClick={handleCancelAfterError} className="flex-1 rounded-lg">
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setStep('upload');
                  setProcessingLog([]);
                  setProcessingError(null);
                }}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                Try Again
              </Button>
            </div>
          </>
        )}

        {step === 'review' && (
          <>
            <DialogHeader>
              <DialogTitle>Review & Confirm</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
              <CourseFormFields values={values} onChange={(updates) => setValues(prev => ({ ...prev, ...updates }))} />

              <div className="pt-4 border-t">
                <h4 className="font-semibold text-gray-900 mb-3">Extraction Summary</h4>

                <div className="flex items-center gap-4 mb-3">
                  <Badge className={`${getQualityColor(extractionQuality)} rounded-full`}>
                    {extractionQuality.charAt(0).toUpperCase() + extractionQuality.slice(1)}
                  </Badge>
                  <span className="text-sm text-gray-600">
                    {extractedCount} deadlines and exams extracted
                  </span>
                </div>

                {extractionQuality === 'partial' && (
                  <Alert className="rounded-lg bg-yellow-50 border-yellow-200">
                    <AlertCircle className="h-4 w-4 text-yellow-600" />
                    <AlertDescription className="text-sm text-yellow-800">
                      Some information could not be extracted. You may need to manually add missing details.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <Button variant="outline" onClick={onClose} className="rounded-lg">
                Close
              </Button>
              <Button
                onClick={handleSave}
                disabled={!values.name}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                Save Course
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
