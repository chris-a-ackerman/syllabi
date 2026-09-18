import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../context/AuthProvider';
import { useData } from '../context/DataProvider';
import { BulkReviewForm } from '../components/BulkReviewForm';
import { ProcessingCourseList } from '../components/ProcessingCourseList';
import { SyllabusDropzone } from '../components/SyllabusDropzone';
import { useBulkUpload } from '../hooks/useBulkUpload';
import { useProcessingPoll } from '../hooks/useProcessingPoll';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import { X, Loader2, AlertCircle, ChevronRight, FileText } from 'lucide-react';

export function Onboarding() {
  const navigate = useNavigate();
  const { user, markOnboardingComplete } = useAuth();
  const { courses: allCourses, refreshCourses, refreshEvents } = useData();
  const {
    step,
    fileItems,
    detectedCourses,
    createdCourseIds,
    allDone,
    globalError,
    addFiles,
    removeFile,
    analyze,
    updateDetectedCourse,
    confirm,
    retryProcessing,
  } = useBulkUpload();

  // Poll for course status updates during processing; stop once all have settled
  useProcessingPoll(step === 'processing' && !allDone, refreshCourses);

  // Auto-navigate when all courses finish
  useEffect(() => {
    if (step !== 'processing' || !allDone) return;
    const t = setTimeout(async () => {
      await Promise.all([markOnboardingComplete(), refreshEvents()]);
      navigate('/dashboard');
    }, 1500);
    return () => clearTimeout(t);
  }, [step, allDone, navigate, markOnboardingComplete, refreshEvents]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-indigo-50">
      <div className="max-w-2xl mx-auto px-4 py-12">
        {/* Wordmark */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-indigo-600 mb-4">Syllabi</h1>
          {step === 'upload' && (
            <>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Welcome{user?.displayName ? `, ${user.displayName}` : ''}!
              </h2>
              <p className="text-gray-600">
                Upload your syllabi and we'll set everything up automatically.
              </p>
            </>
          )}
          {step === 'detecting' && (
            <>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Analyzing your syllabi…</h2>
              <p className="text-gray-600">Extracting course and semester info from each file.</p>
            </>
          )}
          {step === 'review' && (
            <>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Review & confirm</h2>
              <p className="text-gray-600">
                Check the detected info below and edit anything that looks wrong.
              </p>
            </>
          )}
          {step === 'processing' && (
            <>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Setting up your courses</h2>
              <p className="text-gray-600">
                Extracting events, deadlines, and policies from each syllabus.
              </p>
            </>
          )}
        </div>

        {globalError && (
          <Alert className="mb-6 bg-red-50 border-red-200">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">{globalError}</AlertDescription>
          </Alert>
        )}

        {/* ── Step 1: Upload ── */}
        {step === 'upload' && (
          <div className="space-y-4">
            <SyllabusDropzone
              multiple
              onFiles={addFiles}
              title="Drop your syllabi here"
              hint="or click to browse — PDF files only, up to 50 MB each"
              variant="page"
            />

            {fileItems.length > 0 && (
              <Card className="p-2 rounded-xl divide-y divide-gray-100">
                {fileItems.map((fi) => (
                  <div key={fi.id} className="flex items-center justify-between px-2 py-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
                      <span className="text-sm text-gray-700 truncate">{fi.file.name}</span>
                      <span className="text-xs text-gray-400 shrink-0">
                        {(fi.file.size / (1024 * 1024)).toFixed(1)} MB
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-gray-400 hover:text-red-500 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(fi.id);
                      }}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </Card>
            )}

            <Button
              className="w-full bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              disabled={fileItems.length === 0}
              onClick={analyze}
            >
              Analyze Syllabi
              <ChevronRight className="ml-2 w-4 h-4" />
            </Button>

            <p className="text-center text-sm text-gray-500">
              Prefer to add courses manually?{' '}
              <button
                className="text-indigo-600 hover:underline"
                onClick={async () => {
                  await markOnboardingComplete();
                  navigate('/dashboard');
                }}
              >
                Skip for now
              </button>
            </p>
          </div>
        )}

        {/* ── Step 2: Detecting ── */}
        {step === 'detecting' && (
          <Card className="p-6 rounded-2xl">
            <div className="space-y-3">
              {fileItems.map((fi) => (
                <div key={fi.id} className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-indigo-500 animate-spin shrink-0" />
                  <span className="text-sm text-gray-700">{fi.file.name}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ── Step 3: Review ── */}
        {step === 'review' && (
          <div className="space-y-6">
            <BulkReviewForm
              detectedCourses={detectedCourses}
              updateDetectedCourse={updateDetectedCourse}
              variant="page"
              showConfidence
            />

            <Button
              className="w-full bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              onClick={confirm}
            >
              Confirm &amp; Set Up Courses
              <ChevronRight className="ml-2 w-4 h-4" />
            </Button>
          </div>
        )}

        {/* ── Step 4: Processing ── */}
        {step === 'processing' && (
          <div className="space-y-4">
            <ProcessingCourseList
              courseIds={createdCourseIds}
              courses={allCourses}
              onRetry={retryProcessing}
              variant="page"
            />

            <Button
              variant="outline"
              className="w-full rounded-lg mt-2"
              onClick={async () => {
                // Navigating away unmounts this page, which stops the poll.
                await Promise.all([markOnboardingComplete(), refreshEvents()]);
                navigate('/dashboard');
              }}
            >
              Go to Dashboard
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
