import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../../lib/supabase';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Upload, Loader2, CheckCircle, AlertCircle, X, FileText, PenSquare, ChevronRight, Layers } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Card } from '../components/ui/card';
import { useBulkCourseUpload } from '../hooks/useBulkCourseUpload';

interface AddCourseModalProps {
  open: boolean;
  onClose: () => void;
  existingCourse?: {
    id: string;
    name: string;
    code: string;
    color: string;
    professor?: string;
  };
  editMode?: boolean;
}

type Step = 'choose' | 'upload' | 'processing' | 'review' | 'manual' | 'manualSuccess' | 'error' | 'bulk';

const PRESET_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f59e0b', // amber
  '#ef4444', // red
  '#3b82f6', // blue
  '#10b981', // emerald
];

export function AddCourseModal({ open, onClose, existingCourse, editMode }: AddCourseModalProps) {
  const { addCourse, updateCourse, refreshCourses, refreshEvents, semesters, user } = useApp();
  const initialStep = editMode ? 'manual' : existingCourse ? 'upload' : 'choose';
  const [step, setStep] = useState<Step>(initialStep);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Upload flow tracking
  const [createdCourseId, setCreatedCourseId] = useState<string | null>(null);
  const [uploadedFilePath, setUploadedFilePath] = useState<string | null>(null);
  const [processingLog, setProcessingLog] = useState<string[]>([]);
  const [processingError, setProcessingError] = useState<string | null>(null);

  // Review form state
  const [courseName, setCourseName] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [professor, setProfessor] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [extractionQuality, setExtractionQuality] = useState<'complete' | 'partial' | 'minimal'>('complete');
  const [extractedCount, setExtractedCount] = useState(0);

  const activeSemester = semesters.find(s => s.isActive);

  const {
    step: bulkStep,
    fileItems,
    detectedCourses,
    createdCourseIds,
    globalError: bulkError,
    addFiles,
    removeFile,
    reset: resetBulk,
    analyze,
    updateDetectedCourse,
    confirm,
  } = useBulkCourseUpload(activeSemester?.id ?? '');

  const bulkFileInputRef = useRef<HTMLInputElement>(null);
  const [bulkDragActive, setBulkDragActive] = useState(false);

  const handleBulkDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setBulkDragActive(false);
    addFiles(Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf'));
  }, [addFiles]);

  const handleBulkFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files).filter(f => f.type === 'application/pdf'));
    e.target.value = '';
  };

  // Auto-close when bulk processing completes
  useEffect(() => {
    if (step !== 'bulk' || bulkStep !== 'processing' || createdCourseIds.length === 0) return;
    resetBulk();
    onClose();
  }, [step, bulkStep, createdCourseIds.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset state when modal opens/closes or existingCourse changes
  useEffect(() => {
    if (open) {
      if (editMode && existingCourse) {
        setStep('manual');
        setCourseName(existingCourse.name);
        setCourseCode(existingCourse.code);
        setProfessor(existingCourse.professor ?? '');
        setColor(existingCourse.color);
      } else {
        setStep(existingCourse ? 'upload' : 'choose');
        setCourseName('');
        setCourseCode('');
        setProfessor('');
        setColor(PRESET_COLORS[0]);
      }
      setSelectedFile(null);
      setCreatedCourseId(null);
      setUploadedFilePath(null);
      setProcessingLog([]);
      setProcessingError(null);
      resetBulk();
    }
  }, [open, existingCourse]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      alert('Only PDF files are supported. Please upload a PDF.');
      return;
    }
    setSelectedFile(file);
  };

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
          color,
          status: 'processing',
        });
        if (!newId) throw new Error('Failed to create course record');
        courseId = newId;
        setCreatedCourseId(newId);
      }

      // 2. Upload file to Supabase Storage
      setProcessingLog(prev => [...prev, 'Uploading syllabus file...']);
      const filePath = `${user.id}/${courseId}/${selectedFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from('syllabi')
        .upload(filePath, selectedFile, { upsert: true });

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
      setUploadedFilePath(filePath);

      // 3. Update course row with the file path
      const { error: updateError } = await supabase
        .from('courses')
        .update({ syllabus_file_path: filePath, syllabus_file_name: selectedFile.name })
        .eq('id', courseId);

      if (updateError) throw new Error(`Failed to save file path: ${updateError.message}`);

      // 4. Call the process-syllabus edge function (synchronous — waits for Claude)
      setProcessingLog(prev => [...prev, 'Analyzing syllabus with AI (this takes ~30 seconds)...']);
      const { data: fnData, error: fnError } = await supabase.functions.invoke('process-syllabus', {
        body: { course_id: courseId },
      });

      if (fnError) throw new Error(`Processing failed: ${fnError.message}`);
      if (!fnData?.success) throw new Error(fnData?.error || 'Processing failed');

      setProcessingLog(prev => [...prev, `Done! Extracted ${fnData.events_created} events.`]);

      // 5. Pull updated courses and events into context so all data is visible immediately
      await Promise.all([refreshCourses(), refreshEvents()]);

      // 6. Fetch the updated course to populate the review form
      const { data: updatedCourse } = await supabase
        .from('courses')
        .select('*')
        .eq('id', courseId)
        .single();

      if (updatedCourse) {
        setCourseName(updatedCourse.name || '');
        setCourseCode(updatedCourse.code || '');
        setProfessor(updatedCourse.professor || '');

        const completeness = fnData.completeness as 'complete' | 'partial' | 'minimal' | undefined;
        setExtractionQuality(completeness ?? 'partial');
        setExtractedCount(fnData.events_created ?? 0);
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
      updateCourse(courseId, { name: courseName, code: courseCode, professor, color });
    }
    resetAndClose();
  };

  const handleStartOver = () => {
    setStep(existingCourse ? 'upload' : 'choose');
    setSelectedFile(null);
    setCourseName('');
    setCourseCode('');
    setProfessor('');
    setColor(PRESET_COLORS[0]);
    setCreatedCourseId(null);
    setUploadedFilePath(null);
    setProcessingLog([]);
    setProcessingError(null);
    resetBulk();
  };

  const resetAndClose = () => {
    setStep('choose');
    setSelectedFile(null);
    setCourseName('');
    setCourseCode('');
    setProfessor('');
    setColor(PRESET_COLORS[0]);
    setCreatedCourseId(null);
    setUploadedFilePath(null);
    setProcessingLog([]);
    setProcessingError(null);
    resetBulk();
    onClose();
  };

  const handleCancelAfterError = async () => {
    if (uploadedFilePath) {
      await supabase.storage.from('syllabi').remove([uploadedFilePath]);
    }
    if (createdCourseId) {
      await supabase.from('courses').delete().eq('id', createdCourseId);
      await refreshCourses();
    }
    resetAndClose();
  };

  const handleManualSave = () => {
    if (!courseName) return;

    if (editMode && existingCourse?.id) {
      updateCourse(existingCourse.id, { name: courseName, code: courseCode, professor, color });
      resetAndClose();
      return;
    }

    if (!activeSemester) return;

    addCourse({
      semesterId: activeSemester.id,
      name: courseName,
      code: courseCode,
      professor: professor,
      color: color,
      status: 'processing',
      extractionQuality: undefined,
      extractedCount: 0,
    });

    setStep('manualSuccess');
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
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent className="rounded-2xl max-w-2xl">
        {step === 'choose' && (
          <>
            <DialogHeader>
              <DialogTitle>Add Course</DialogTitle>
              <DialogDescription>
                How would you like to add your course?
              </DialogDescription>
            </DialogHeader>

            <div className="py-6 space-y-4">
              <button
                onClick={() => setStep('upload')}
                className="w-full p-6 rounded-2xl border-2 border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 transition-colors text-left group"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-indigo-100 group-hover:bg-indigo-200 rounded-xl flex items-center justify-center flex-shrink-0">
                    <FileText className="w-6 h-6 text-indigo-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      Upload Syllabus First
                    </h3>
                    <p className="text-sm text-gray-600">
                      Upload your syllabus PDF and we'll automatically extract course details, deadlines, and policies. You can review and edit before saving.
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setStep('manual')}
                className="w-full p-6 rounded-2xl border-2 border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 transition-colors text-left group"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-violet-100 group-hover:bg-violet-200 rounded-xl flex items-center justify-center flex-shrink-0">
                    <PenSquare className="w-6 h-6 text-violet-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      Create Manually
                    </h3>
                    <p className="text-sm text-gray-600">
                      Enter course details manually now. You can upload your syllabus later from the course page.
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setStep('bulk')}
                disabled={!activeSemester}
                className="w-full p-6 rounded-2xl border-2 border-gray-200 hover:border-teal-400 hover:bg-teal-50 transition-colors text-left group disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-teal-100 group-hover:bg-teal-200 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Layers className="w-6 h-6 text-teal-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      Upload Multiple Syllabi
                    </h3>
                    <p className="text-sm text-gray-600">
                      Upload several PDFs at once — we'll detect course names and codes automatically. All courses go into the current semester.
                    </p>
                  </div>
                </div>
              </button>
            </div>

            <div className="flex justify-end pt-4">
              <Button variant="outline" onClick={resetAndClose} className="rounded-lg">
                Cancel
              </Button>
            </div>
          </>
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
              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors ${
                  dragActive
                    ? 'border-indigo-400 bg-indigo-50'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                {!selectedFile ? (
                  <>
                    <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      Drop your syllabus to get started
                    </h3>
                    <p className="text-sm text-gray-600 mb-4">
                      Accepts PDF files only
                    </p>
                    <label htmlFor="file-upload" className="cursor-pointer">
                      <span className="text-sm text-indigo-600 hover:text-indigo-700 underline">
                        Browse files
                      </span>
                      <input
                        id="file-upload"
                        type="file"
                        accept=".pdf,application/pdf"
                        onChange={handleFileInput}
                        className="hidden"
                      />
                    </label>
                  </>
                ) : (
                  <div className="flex items-center justify-between bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      <div className="text-left">
                        <p className="text-sm font-medium text-gray-900">
                          {selectedFile.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {(selectedFile.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedFile(null)}
                      className="rounded-lg"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>

            </div>

            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={existingCourse ? resetAndClose : handleStartOver}
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

        {step === 'manual' && (
          <>
            <DialogHeader>
              <DialogTitle>{editMode ? 'Edit Course' : 'Create Course Manually'}</DialogTitle>
              <DialogDescription>
                {editMode
                  ? 'Update your course details below.'
                  : 'Enter your course details. You can upload a syllabus later.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
              <div>
                <Label htmlFor="courseName">Course Name *</Label>
                <Input
                  id="courseName"
                  value={courseName}
                  onChange={(e) => setCourseName(e.target.value)}
                  placeholder="e.g. Introduction to Computer Science"
                  className="mt-1 rounded-lg"
                  required
                />
              </div>

              <div>
                <Label htmlFor="courseCode">Course Code</Label>
                <Input
                  id="courseCode"
                  value={courseCode}
                  onChange={(e) => setCourseCode(e.target.value)}
                  placeholder="e.g. CS 101"
                  className="mt-1 rounded-lg"
                />
              </div>

              <div>
                <Label htmlFor="professor">Professor</Label>
                <Input
                  id="professor"
                  value={professor}
                  onChange={(e) => setProfessor(e.target.value)}
                  placeholder="e.g. Dr. Jane Smith"
                  className="mt-1 rounded-lg"
                />
              </div>

              <div>
                <Label>Course Color *</Label>
                <div className="grid grid-cols-8 gap-2 mt-2">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`w-10 h-10 rounded-lg transition-all ${
                        color === c ? 'ring-2 ring-offset-2 ring-indigo-600' : ''
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {!editMode && (
                <Alert className="rounded-lg bg-blue-50 border-blue-200">
                  <AlertCircle className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-sm text-blue-800">
                    After creating the course, you can upload your syllabus from the course details page to extract deadlines and events.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <div className="flex gap-3 pt-4">
              {!editMode && (
                <Button variant="outline" onClick={handleStartOver} className="rounded-lg">
                  Back
                </Button>
              )}
              <Button
                onClick={handleManualSave}
                disabled={!courseName}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                {editMode ? 'Save Changes' : 'Create Course'}
              </Button>
            </div>
          </>
        )}

        {step === 'manualSuccess' && (
          <>
            <div className="py-8 text-center">
              <CheckCircle className="w-16 h-16 text-indigo-600 mx-auto mb-6" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Course Created Successfully!
              </h3>
              <p className="text-sm text-gray-600 mb-8">
                Your course has been added to the current semester.
              </p>

              <Alert className="rounded-lg bg-yellow-50 border-yellow-200 text-left mb-6">
                <AlertCircle className="h-4 w-4 text-yellow-600" />
                <AlertDescription className="text-sm text-yellow-800">
                  <strong>Next Step:</strong> Upload your syllabus to enable this course in the AI knowledge base and extract deadlines, exams, and policies.
                </AlertDescription>
              </Alert>
            </div>

            <div className="flex gap-3 pt-4">
              <Button variant="outline" onClick={resetAndClose} className="flex-1 rounded-lg">
                Done
              </Button>
              <Button
                onClick={() => {
                  setStep('upload');
                  setCourseName('');
                  setCourseCode('');
                  setProfessor('');
                }}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload Syllabus
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
              <div>
                <Label htmlFor="courseName">Course Name *</Label>
                <Input
                  id="courseName"
                  value={courseName}
                  onChange={(e) => setCourseName(e.target.value)}
                  className="mt-1 rounded-lg"
                  required
                />
              </div>

              <div>
                <Label htmlFor="courseCode">Course Code</Label>
                <Input
                  id="courseCode"
                  value={courseCode}
                  onChange={(e) => setCourseCode(e.target.value)}
                  placeholder="e.g. CS 101"
                  className="mt-1 rounded-lg"
                />
              </div>

              <div>
                <Label htmlFor="professor">Professor</Label>
                <Input
                  id="professor"
                  value={professor}
                  onChange={(e) => setProfessor(e.target.value)}
                  placeholder="e.g. Dr. Jane Smith"
                  className="mt-1 rounded-lg"
                />
              </div>

              <div>
                <Label>Course Color *</Label>
                <div className="grid grid-cols-8 gap-2 mt-2">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`w-10 h-10 rounded-lg transition-all ${
                        color === c ? 'ring-2 ring-offset-2 ring-indigo-600' : ''
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

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
              <Button variant="outline" onClick={resetAndClose} className="rounded-lg">
                Close
              </Button>
              <Button
                onClick={handleSave}
                disabled={!courseName}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                Save Course
              </Button>
            </div>
          </>
        )}
        {step === 'bulk' && (
          <>
            <DialogHeader>
              <DialogTitle>
                {bulkStep === 'upload' && 'Upload Multiple Syllabi'}
                {bulkStep === 'detecting' && 'Analyzing Syllabi…'}
                {bulkStep === 'review' && 'Review Detected Courses'}
                {bulkStep === 'processing' && 'Creating Courses…'}
              </DialogTitle>
              <DialogDescription>
                {bulkStep === 'upload' && 'Drop your PDFs and we\'ll detect course names and codes automatically.'}
                {bulkStep === 'detecting' && 'Reading each syllabus to extract course information.'}
                {bulkStep === 'review' && 'Review the detected information and make any edits before confirming.'}
                {bulkStep === 'processing' && 'Setting up your courses and uploading syllabi…'}
              </DialogDescription>
            </DialogHeader>

            {bulkStep === 'upload' && (
              <div className="py-4 space-y-4 min-w-0">
                {bulkError && (
                  <Alert className="rounded-lg bg-red-50 border-red-200">
                    <AlertCircle className="h-4 w-4 text-red-600" />
                    <AlertDescription className="text-sm text-red-800">{bulkError}</AlertDescription>
                  </Alert>
                )}

                <div
                  onDragEnter={() => setBulkDragActive(true)}
                  onDragLeave={() => setBulkDragActive(false)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleBulkDrop}
                  onClick={() => bulkFileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-10 text-center transition-colors cursor-pointer overflow-x-hidden ${
                    bulkDragActive
                      ? 'border-teal-400 bg-teal-50'
                      : 'border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                  <h3 className="text-base font-semibold text-gray-900 mb-1">
                    Drop your syllabi here
                  </h3>
                  <p className="text-sm text-gray-500">
                    PDF files only · click to browse
                  </p>
                  <input
                    ref={bulkFileInputRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    multiple
                    onChange={handleBulkFileInput}
                    className="hidden"
                  />
                </div>

                {fileItems.length > 0 && (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {fileItems.map(fi => (
                      <div key={fi.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                          <span className="text-sm text-gray-800 truncate flex-1 min-w-0">{fi.file.name}</span>
                          <span className="text-xs text-gray-400 shrink-0">
                            {(fi.file.size / (1024 * 1024)).toFixed(1)} MB
                          </span>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeFile(fi.id); }}
                          className="text-gray-400 hover:text-gray-600 shrink-0 ml-2"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    className="rounded-lg"
                    onClick={() => { resetBulk(); setStep('choose'); }}
                  >
                    Back
                  </Button>
                  <Button
                    className="flex-1 bg-teal-600 hover:bg-teal-700 rounded-lg"
                    disabled={fileItems.length === 0}
                    onClick={analyze}
                  >
                    Analyze
                    <ChevronRight className="ml-1 w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {bulkStep === 'detecting' && (
              <div className="py-6 space-y-3 min-w-0">
                {fileItems.map(fi => (
                  <div key={fi.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-4 py-3 overflow-hidden">
                    <Loader2 className="w-4 h-4 text-teal-500 animate-spin shrink-0" />
                    <span className="text-sm text-gray-700 truncate min-w-0">{fi.file.name}</span>
                  </div>
                ))}
              </div>
            )}

            {bulkStep === 'review' && (
              // This is the review card
              <div className="py-4 space-y-3 min-w-0">
                <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                  {detectedCourses.map((dc) => (
                    <Card key={dc.id} className="p-3 rounded-xl space-y-2">
                      {dc.error && (
                        <Alert className="py-1.5 bg-amber-50 border-amber-200">
                          <AlertCircle className="h-3 w-3 text-amber-500" />
                          <AlertDescription className="text-xs text-amber-800">
                            Detection failed — fill in the details manually.
                          </AlertDescription>
                        </Alert>
                      )}
                      <div className="flex items-center gap-2 text-xs text-gray-400 overflow-hidden">
                        <FileText className="w-3 h-3 shrink-0" />
                        <span className="truncate min-w-0">{dc.fileItem.file.name}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Course Name</Label>
                          <input
                            value={dc.courseName}
                            onChange={(e) => updateDetectedCourse(dc.id, { courseName: e.target.value })}
                            placeholder="e.g. Calculus II"
                            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Course Code</Label>
                          <input
                            value={dc.courseCode}
                            onChange={(e) => updateDetectedCourse(dc.id, { courseCode: e.target.value })}
                            placeholder="e.g. MATH 202"
                            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                          />
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    className="rounded-lg"
                    onClick={() => { resetBulk(); setStep('choose'); }}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="flex-1 bg-teal-600 hover:bg-teal-700 rounded-lg"
                    onClick={confirm}
                  >
                    Confirm &amp; Add Courses
                    <ChevronRight className="ml-1 w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {bulkStep === 'processing' && (
              <div className="flex flex-col items-center gap-3 py-10">
                <Loader2 className="w-10 h-10 text-teal-500 animate-spin" />
                <p className="text-sm text-gray-600">Creating your courses…</p>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
