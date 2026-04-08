import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../context/AppContext';
import { useBulkUpload } from '../hooks/useBulkUpload';
import { useCanvasFlow } from '../hooks/useCanvasFlow';
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
import { Card } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import {
  Upload,
  Loader2,
  AlertCircle,
  ChevronRight,
  FileText,
  PenSquare,
  X,
  GraduationCap,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react';

interface AddSemesterModalProps {
  open: boolean;
  onClose: () => void;
}

type ModalStep = 'choose' | 'manual' | 'bulk-upload' | 'canvas';

export function AddSemesterModal({ open, onClose }: AddSemesterModalProps) {
  const navigate = useNavigate();
  const { addSemester } = useApp();
  const [modalStep, setModalStep] = useState<ModalStep>('choose');
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [canvasConnected, setCanvasConnected] = useState<boolean | null>(null);

  const {
    step: bulkStep,
    fileItems,
    detectedCourses,
    createdCourseIds,
    globalError,
    addFiles,
    removeFile,
    reset,
    analyze,
    updateDetectedCourse,
    confirm,
  } = useBulkUpload();

  const canvasFlow = useCanvasFlow();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // Reset everything when modal opens
  useEffect(() => {
    if (open) {
      setModalStep('choose');
      setName('');
      setStartDate('');
      setEndDate('');
      reset();
      canvasFlow.reset();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch Canvas connection status on open
  useEffect(() => {
    if (!open) return;
    setCanvasConnected(null);
    supabase
      .from('profiles_safe')
      .select('has_canvas_connected')
      .single()
      .then(({ data }) => setCanvasConnected(data?.has_canvas_connected ?? false));
  }, [open]);

  // Close modal once courses are created — sidebar banner takes over processing status
  useEffect(() => {
    if (modalStep !== 'bulk-upload' || bulkStep !== 'processing' || createdCourseIds.length === 0) return;
    onClose();
  }, [modalStep, bulkStep, createdCourseIds.length, onClose]);


  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (dropRef.current) dropRef.current.dataset.dragging = 'false';
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
    addFiles(files);
  }, [addFiles]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
    e.target.value = '';
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addSemester({ name, startDate, endDate });
    onClose();
  };

  // Group detected courses by semester for the review step
  const semesterGroups = detectedCourses.reduce<Record<string, typeof detectedCourses>>(
    (acc, dc) => {
      const key = dc.semesterName.trim() || '__unknown__';
      if (!acc[key]) acc[key] = [];
      acc[key].push(dc);
      return acc;
    },
    {}
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="rounded-2xl max-w-xl max-h-[90vh] overflow-y-auto overflow-x-hidden">

        {/* ── Choose ── */}
        {modalStep === 'choose' && (
          <>
            <DialogHeader>
              <DialogTitle>Add Semester</DialogTitle>
              <DialogDescription>
                How would you like to set up your semester?
              </DialogDescription>
            </DialogHeader>

            <div className="py-6 space-y-4">
              <button
                onClick={() => setModalStep('bulk-upload')}
                className="w-full p-6 rounded-2xl border-2 border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 transition-colors text-left group"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-indigo-100 group-hover:bg-indigo-200 rounded-xl flex items-center justify-center flex-shrink-0">
                    <FileText className="w-6 h-6 text-indigo-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      Upload Syllabi
                    </h3>
                    <p className="text-sm text-gray-600">
                      Upload one or more syllabus PDFs and we'll automatically detect the semester, course names, and dates.
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setModalStep('canvas')}
                className="w-full p-6 rounded-2xl border-2 border-gray-200 hover:border-emerald-400 hover:bg-emerald-50 transition-colors text-left group"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-emerald-100 group-hover:bg-emerald-200 rounded-xl flex items-center justify-center flex-shrink-0">
                    <GraduationCap className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      Import from Canvas
                    </h3>
                    <p className="text-sm text-gray-600">
                      Connect to Canvas LMS to automatically detect your courses and find syllabi.
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setModalStep('manual')}
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
                      Enter semester details manually. You can add courses and upload syllabi after.
                    </p>
                  </div>
                </div>
              </button>
            </div>

            <div className="flex justify-end">
              <Button variant="outline" onClick={onClose} className="rounded-lg">
                Cancel
              </Button>
            </div>
          </>
        )}

        {/* ── Manual form ── */}
        {modalStep === 'manual' && (
          <>
            <DialogHeader>
              <DialogTitle>Add Semester</DialogTitle>
              <DialogDescription>
                Create a new semester to organize your courses.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div>
                <Label htmlFor="semesterName">Semester Name</Label>
                <Input
                  id="semesterName"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Spring 2026"
                  className="mt-1 rounded-lg"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="startDate">Start Date</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="mt-1 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="endDate">End Date</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="mt-1 rounded-lg"
                    required
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setModalStep('choose')} className="flex-1 rounded-lg">
                  Back
                </Button>
                <Button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-700 rounded-lg">
                  Add Semester
                </Button>
              </div>
            </form>
          </>
        )}

        {/* ── Bulk upload flow ── */}
        {modalStep === 'bulk-upload' && (
          <>
            <DialogHeader>
              <DialogTitle>Upload Syllabi</DialogTitle>
              <DialogDescription>
                {bulkStep === 'upload' && "Drop your syllabi and we'll detect semester and course info automatically."}
                {bulkStep === 'detecting' && 'Analyzing your syllabi…'}
                {bulkStep === 'review' && 'Review detected info and confirm.'}
                {bulkStep === 'processing' && 'Creating your courses…'}
              </DialogDescription>
            </DialogHeader>

            {globalError && (
              <Alert className="bg-red-50 border-red-200">
                <AlertCircle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800">{globalError}</AlertDescription>
              </Alert>
            )}

            {/* Step 1: Upload */}
            {bulkStep === 'upload' && (
              <div className="space-y-3 overflow-hidden">
                <div
                  ref={dropRef}
                  className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors border-gray-300 hover:border-indigo-400 bg-white data-[dragging=true]:border-indigo-500 data-[dragging=true]:bg-indigo-50"
                  onDragOver={(e) => { e.preventDefault(); if (dropRef.current) dropRef.current.dataset.dragging = 'true'; }}
                  onDragLeave={() => { if (dropRef.current) dropRef.current.dataset.dragging = 'false'; }}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-8 h-8 text-gray-400 mx-auto mb-3" />
                  <p className="text-sm font-medium text-gray-700 mb-1">Drop PDF syllabi here</p>
                  <p className="text-xs text-gray-500">or click to browse</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    multiple
                    className="hidden"
                    onChange={handleFileInput}
                  />
                </div>

                {fileItems.length > 0 && (
                  <Card className="p-2 rounded-lg divide-y divide-gray-100">
                    {fileItems.map((fi) => (
                      <div key={fi.id} className="flex items-center justify-between px-2 py-1.5 overflow-hidden">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          <span className="text-sm text-gray-700 truncate min-w-0">{fi.file.name}</span>
                          <span className="text-xs text-gray-400 shrink-0">
                            {(fi.file.size / (1024 * 1024)).toFixed(1)} MB
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-gray-400 hover:text-red-500 shrink-0"
                          onClick={(e) => { e.stopPropagation(); removeFile(fi.id); }}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </Card>
                )}

                <div className="flex gap-3 pt-2">
                  <Button variant="outline" className="flex-1 rounded-lg" onClick={() => setModalStep('choose')}>
                    Back
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

            {/* Step 2: Detecting */}
            {bulkStep === 'detecting' && (
              <div className="space-y-3 py-2 overflow-hidden">
                {fileItems.map((fi) => (
                  <div key={fi.id} className="flex items-center gap-3 min-w-0 overflow-hidden">
                    <Loader2 className="w-4 h-4 text-indigo-500 animate-spin shrink-0" />
                    <span className="text-sm text-gray-700 truncate min-w-0">{fi.file.name}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Step 3: Review */}
            {bulkStep === 'review' && (
              <div className="space-y-4 overflow-hidden">
                {Object.entries(semesterGroups).map(([semKey, groupCourses]) => (
                  <Card key={groupCourses[0].id} className="p-4 rounded-xl space-y-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Semester</p>

                    <div className="space-y-2">
                      <div>
                        <Label className="text-xs">Semester Name</Label>
                        <Input
                          value={groupCourses[0].semesterName}
                          onChange={(e) => {
                            const val = e.target.value;
                            groupCourses.forEach(dc =>
                              updateDetectedCourse(dc.id, { semesterName: val })
                            );
                          }}
                          placeholder="e.g. Spring 2026"
                          className="mt-1 rounded-lg h-8 text-sm"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Start Date</Label>
                          <Input
                            type="date"
                            value={groupCourses[0].semesterStart}
                            onChange={(e) => {
                              const val = e.target.value;
                              groupCourses.forEach(dc =>
                                updateDetectedCourse(dc.id, { semesterStart: val })
                              );
                            }}
                            className="mt-1 rounded-lg h-8 text-sm"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">End Date</Label>
                          <Input
                            type="date"
                            value={groupCourses[0].semesterEnd}
                            onChange={(e) => {
                              const val = e.target.value;
                              groupCourses.forEach(dc =>
                                updateDetectedCourse(dc.id, { semesterEnd: val })
                              );
                            }}
                            className="mt-1 rounded-lg h-8 text-sm"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-gray-100 pt-3 space-y-3">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Courses</p>
                      {groupCourses.map((dc) => (
                        <div key={dc.id} className="space-y-2">
                          {dc.error && (
                            <Alert className="py-1.5 bg-amber-50 border-amber-200">
                              <AlertCircle className="h-3 w-3 text-amber-500" />
                              <AlertDescription className="text-xs text-amber-800">
                                Detection failed — fill in manually.
                              </AlertDescription>
                            </Alert>
                          )}
                          <div className="flex items-center gap-2 min-w-0 text-xs text-gray-400">
                            <FileText className="w-3 h-3 shrink-0" />
                            <span className="truncate min-w-0">{dc.fileItem.file.name}</span>
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
                ))}

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

            {/* Step 4: Processing (briefly visible while courses are being created) */}
            {bulkStep === 'processing' && (
              <div className="flex flex-col items-center gap-3 py-6">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                <p className="text-sm text-gray-600">Creating your courses…</p>
              </div>
            )}
          </>
        )}

        {/* ── Canvas import flow ── */}
        {modalStep === 'canvas' && (
          <>
            <DialogHeader>
              <DialogTitle>Import from Canvas</DialogTitle>
              <DialogDescription>
                {canvasFlow.step === 'dates' && 'Enter your semester dates to find your Canvas courses.'}
                {canvasFlow.step === 'detecting' && 'Searching Canvas for your courses…'}
                {canvasFlow.step === 'review' && 'Review and confirm your courses before creating them.'}
                {canvasFlow.step === 'processing' && 'Creating your semester and courses…'}
                {canvasFlow.step === 'syllabi' && 'Courses created. Searching Canvas for your syllabi…'}
                {canvasFlow.step === 'downloading' && 'Downloading syllabi and starting processing…'}
              </DialogDescription>
            </DialogHeader>

            {/* Canvas not connected */}
            {canvasConnected === false && (
              <div className="py-6 space-y-4">
                <div className="flex flex-col items-center gap-3 text-center py-4">
                  <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center">
                    <GraduationCap className="w-7 h-7 text-gray-400" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Canvas not connected</p>
                    <p className="text-sm text-gray-500 mt-1">
                      Connect your Canvas account to import courses automatically.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1 rounded-lg" onClick={() => setModalStep('choose')}>
                    Back
                  </Button>
                  <Button
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                    onClick={() => { onClose(); navigate('/settings/canvas'); }}
                  >
                    Connect Canvas
                    <ChevronRight className="ml-1 w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Loading connection status */}
            {canvasConnected === null && (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
              </div>
            )}

            {/* Canvas connected — flow steps */}
            {canvasConnected === true && (
              <>
                {canvasFlow.error && (
                  <Alert className="bg-red-50 border-red-200">
                    <AlertCircle className="h-4 w-4 text-red-600" />
                    <AlertDescription className="text-red-800">{canvasFlow.error}</AlertDescription>
                  </Alert>
                )}

                {/* Step: dates */}
                {canvasFlow.step === 'dates' && (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="canvasSemName">Semester Name</Label>
                      <Input
                        id="canvasSemName"
                        value={canvasFlow.semesterName}
                        onChange={(e) => canvasFlow.setSemesterName(e.target.value)}
                        placeholder="e.g. Spring 2026"
                        className="mt-1 rounded-lg"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="canvasStart">Start Date</Label>
                        <Input
                          id="canvasStart"
                          type="date"
                          value={canvasFlow.startDate}
                          onChange={(e) => canvasFlow.setStartDate(e.target.value)}
                          className="mt-1 rounded-lg"
                        />
                      </div>
                      <div>
                        <Label htmlFor="canvasEnd">End Date</Label>
                        <Input
                          id="canvasEnd"
                          type="date"
                          value={canvasFlow.endDate}
                          onChange={(e) => canvasFlow.setEndDate(e.target.value)}
                          className="mt-1 rounded-lg"
                        />
                      </div>
                    </div>
                    <div className="flex gap-3 pt-2">
                      <Button variant="outline" className="flex-1 rounded-lg" onClick={() => setModalStep('choose')}>
                        Back
                      </Button>
                      <Button
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                        disabled={!canvasFlow.semesterName || !canvasFlow.startDate || !canvasFlow.endDate}
                        onClick={canvasFlow.detect}
                      >
                        Find Courses
                        <ChevronRight className="ml-1 w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Step: detecting */}
                {canvasFlow.step === 'detecting' && (
                  <div className="flex flex-col items-center gap-3 py-8">
                    <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                    <p className="text-sm text-gray-600">Searching Canvas for your courses…</p>
                  </div>
                )}

                {/* Step: review */}
                {canvasFlow.step === 'review' && (
                  <div className="space-y-4 overflow-hidden">
                    {/* Editable semester header */}
                    <Card className="p-4 rounded-xl space-y-3">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Semester</p>
                      <div>
                        <Label className="text-xs">Semester Name</Label>
                        <Input
                          value={canvasFlow.semesterName}
                          onChange={(e) => canvasFlow.setSemesterName(e.target.value)}
                          placeholder="e.g. Spring 2026"
                          className="mt-1 rounded-lg h-8 text-sm"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">Start Date</Label>
                          <Input
                            type="date"
                            value={canvasFlow.startDate}
                            onChange={(e) => canvasFlow.setStartDate(e.target.value)}
                            className="mt-1 rounded-lg h-8 text-sm"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">End Date</Label>
                          <Input
                            type="date"
                            value={canvasFlow.endDate}
                            onChange={(e) => canvasFlow.setEndDate(e.target.value)}
                            className="mt-1 rounded-lg h-8 text-sm"
                          />
                        </div>
                      </div>
                    </Card>

                    {/* Course list */}
                    {canvasFlow.detectedCourses.length === 0 ? (
                      <div className="text-center py-6">
                        <p className="text-sm text-gray-500">No courses found for these dates.</p>
                        <p className="text-xs text-gray-400 mt-1">Try adjusting your date range.</p>
                      </div>
                    ) : (
                      <Card className="p-4 rounded-xl space-y-3">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                          Courses ({canvasFlow.detectedCourses.length})
                        </p>
                        <div className="space-y-4">
                          {canvasFlow.detectedCourses.map((dc, i) => (
                            <div key={dc.canvas_course_id} className="space-y-2 relative">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="absolute -top-1 -right-1 h-6 w-6 text-gray-400 hover:text-red-500"
                                onClick={() => canvasFlow.removeCourse(i)}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                              <div className="grid grid-cols-2 gap-2 pr-6">
                                <div>
                                  <Label className="text-xs">Course Name</Label>
                                  <Input
                                    value={dc.editedName}
                                    onChange={(e) => canvasFlow.updateCourse(i, 'editedName', e.target.value)}
                                    placeholder="Course name"
                                    className="mt-1 rounded-lg h-8 text-sm"
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs">Course Code</Label>
                                  <Input
                                    value={dc.editedCode}
                                    onChange={(e) => canvasFlow.updateCourse(i, 'editedCode', e.target.value)}
                                    placeholder="e.g. MATH 202"
                                    className="mt-1 rounded-lg h-8 text-sm"
                                  />
                                </div>
                              </div>
                              {dc.instructor && (
                                <p className="text-xs text-gray-400">Instructor: {dc.instructor}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}

                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        className="flex-1 rounded-lg"
                        onClick={() => canvasFlow.reset()}
                      >
                        Back
                      </Button>
                      <Button
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                        disabled={canvasFlow.detectedCourses.length === 0}
                        onClick={canvasFlow.confirm}
                      >
                        Confirm &amp; Create
                        <ChevronRight className="ml-1 w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* Step: processing */}
                {canvasFlow.step === 'processing' && (
                  <div className="space-y-3 py-4">
                    {canvasFlow.detectedCourses.map((dc) => {
                      const created = canvasFlow.createdCourseIds.length > 0;
                      return (
                        <div key={dc.canvas_course_id} className="flex items-center gap-3">
                          {created ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                          ) : (
                            <Loader2 className="w-4 h-4 text-emerald-500 animate-spin shrink-0" />
                          )}
                          <span className="text-sm text-gray-700 truncate">
                            {dc.editedName || dc.name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Step: syllabi */}
                {canvasFlow.step === 'syllabi' && (() => {
                  const findStatuses = Object.values(canvasFlow.syllabiResults);
                  const allFindSettled = findStatuses.length > 0 && findStatuses.every(r => r.status !== 'searching');
                  const foundCount = findStatuses.filter(r => r.status === 'found').length;
                  return (
                    <div className="space-y-4 py-2">
                      <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-emerald-900">
                            {canvasFlow.createdCourseIds.length} course{canvasFlow.createdCourseIds.length !== 1 ? 's' : ''} created
                          </p>
                          <p className="text-xs text-emerald-700 mt-0.5">
                            {allFindSettled
                              ? `${foundCount} syllab${foundCount !== 1 ? 'i' : 'us'} found in Canvas`
                              : 'Searching Canvas for your syllabi…'}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {canvasFlow.createdCourseIds.map((courseId, i) => {
                          const dc = canvasFlow.detectedCourses[i];
                          const result = canvasFlow.syllabiResults[courseId];
                          const status = result?.status ?? 'searching';
                          return (
                            <div key={courseId} className="flex items-center gap-3 px-1">
                              {status === 'searching' && (
                                <Loader2 className="w-4 h-4 text-indigo-500 animate-spin shrink-0" />
                              )}
                              {status === 'found' && (
                                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                              )}
                              {status === 'not_found' && (
                                <XCircle className="w-4 h-4 text-amber-400 shrink-0" />
                              )}
                              {status === 'error' && (
                                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                              )}
                              <span className="text-sm text-gray-700 truncate flex-1">
                                {dc?.editedName || dc?.name}
                              </span>
                              {status === 'not_found' && (
                                <span className="text-xs text-amber-500 shrink-0">Not found</span>
                              )}
                              {status === 'error' && (
                                <span className="text-xs text-red-400 shrink-0">Error</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <Button
                        className="w-full bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                        disabled={!allFindSettled}
                        onClick={canvasFlow.downloadSyllabi}
                      >
                        {allFindSettled ? (
                          <>
                            {foundCount > 0 ? 'Download & Process Syllabi' : 'Continue'}
                            <ChevronRight className="ml-1 w-4 h-4" />
                          </>
                        ) : (
                          <>
                            <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                            Searching…
                          </>
                        )}
                      </Button>
                    </div>
                  );
                })()}
                {/* Step: downloading */}
                {canvasFlow.step === 'downloading' && (() => {
                  const dlStatuses = Object.values(canvasFlow.downloadResults);
                  const allDlSettled = dlStatuses.length > 0 && dlStatuses.every(s => s !== 'downloading');
                  return (
                    <div className="space-y-4 py-2">
                      <div className="space-y-2">
                        {canvasFlow.createdCourseIds.map((courseId, i) => {
                          const dc = canvasFlow.detectedCourses[i];
                          const status = canvasFlow.downloadResults[courseId] ?? 'downloading';
                          return (
                            <div key={courseId} className="flex items-center gap-3 px-1">
                              {status === 'downloading' && (
                                <Loader2 className="w-4 h-4 text-emerald-500 animate-spin shrink-0" />
                              )}
                              {status === 'started' && (
                                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                              )}
                              {status === 'error' && (
                                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                              )}
                              {status === 'skipped' && (
                                <XCircle className="w-4 h-4 text-amber-400 shrink-0" />
                              )}
                              <span className="text-sm text-gray-700 truncate flex-1">
                                {dc?.editedName || dc?.name}
                              </span>
                              {status === 'started' && (
                                <span className="text-xs text-emerald-600 shrink-0">Processing started</span>
                              )}
                              {status === 'error' && (
                                <span className="text-xs text-red-400 shrink-0">Download failed</span>
                              )}
                              {status === 'skipped' && (
                                <span className="text-xs text-amber-500 shrink-0">No syllabus found</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {allDlSettled && (
                        <div className="flex items-start gap-3 p-4 bg-indigo-50 border border-indigo-200 rounded-xl">
                          <CheckCircle2 className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                          <p className="text-sm text-indigo-900">
                            Processing has started. You can track progress on the dashboard.
                          </p>
                        </div>
                      )}
                      <Button
                        variant="outline"
                        className="w-full rounded-lg"
                        onClick={onClose}
                      >
                        Done
                      </Button>
                    </div>
                  );
                })()}
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
