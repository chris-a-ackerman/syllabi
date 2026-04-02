import { useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
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
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Alert, AlertDescription } from '../components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Upload, Check, X, Loader2, AlertCircle, ChevronRight, FileText, RefreshCw } from 'lucide-react';

interface BulkUploadModalProps {
  open: boolean;
  onClose: () => void;
}

export function BulkUploadModal({ open, onClose }: BulkUploadModalProps) {
  const { courses: allCourses, semesters, refreshCourses } = useApp();
  const {
    step, fileItems, detectedCourses, createdCourseIds, globalError,
    addFiles, removeFile, reset, analyze, updateDetectedCourse, confirm, retryProcessing,
  } = useBulkUpload();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset state whenever the modal opens
  useEffect(() => {
    if (open) reset();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll during processing
  useEffect(() => {
    if (step !== 'processing') return;
    pollingRef.current = setInterval(() => { refreshCourses(); }, 3000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [step, refreshCourses]);

  // Close automatically when all courses are done
  useEffect(() => {
    if (step !== 'processing' || createdCourseIds.length === 0) return;
    const created = allCourses.filter(c => createdCourseIds.includes(c.id));
    const allDone =
      created.length === createdCourseIds.length &&
      created.every(c => c.status === 'ready' || c.status === 'failed');
    if (!allDone) return;
    if (pollingRef.current) clearInterval(pollingRef.current);
    const t = setTimeout(() => onClose(), 5000);
    return () => clearTimeout(t);
  }, [step, allCourses, createdCourseIds, onClose]);

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

  // When user picks an existing semester from the dropdown, propagate name to all courses in group
  const handleExistingSemesterSelect = (semKey: string, semesterId: string) => {
    if (semesterId === '__new__') return;
    const sem = semesters.find(s => s.id === semesterId);
    if (!sem) return;
    const groupCourses = semesterGroups[semKey] ?? [];
    groupCourses.forEach(dc =>
      updateDetectedCourse(dc.id, {
        semesterName: sem.name,
        semesterStart: sem.startDate,
        semesterEnd: sem.endDate,
      })
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="rounded-2xl max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload Multiple Courses</DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Drop your syllabi and we\'ll detect course info automatically.'}
            {step === 'detecting' && 'Analyzing your syllabi…'}
            {step === 'review' && 'Review detected info and confirm.'}
            {step === 'processing' && 'Creating your courses and processing syllabi.'}
          </DialogDescription>
        </DialogHeader>

        {globalError && (
          <Alert className="bg-red-50 border-red-200">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">{globalError}</AlertDescription>
          </Alert>
        )}

        {/* ── Step 1: Upload ── */}
        {step === 'upload' && (
          <div className="space-y-3">
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
                  <div key={fi.id} className="flex items-center justify-between px-2 py-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      <span className="text-sm text-gray-700 truncate">{fi.file.name}</span>
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
        {step === 'detecting' && (
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
        {step === 'review' && (
          <div className="space-y-4">
            {Object.entries(semesterGroups).map(([semKey, groupCourses]) => {
              const matchedSem = semesters.find(s => s.name === groupCourses[0].semesterName);
              return (
                <Card key={semKey} className="p-4 rounded-xl space-y-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Semester</p>

                  {/* Existing semester dropdown */}
                  {semesters.length > 0 && (
                    <div>
                      <Label className="text-xs">Use existing semester</Label>
                      <Select
                        value={matchedSem?.id ?? '__new__'}
                        onValueChange={(val) => handleExistingSemesterSelect(semKey, val)}
                      >
                        <SelectTrigger className="mt-1 rounded-lg h-8 text-sm">
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

                  {/* Only show name/date fields when creating new */}
                  {!matchedSem && (
                    <div className="space-y-2">
                      <div>
                        <Label className="text-xs">Semester Name</Label>
                        <Input
                          value={groupCourses[0].semesterName}
                          onChange={(e) => {
                            const name = e.target.value;
                            groupCourses.forEach(dc =>
                              updateDetectedCourse(dc.id, { semesterName: name })
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
                  )}

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
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <FileText className="w-3 h-3" />
                          <span className="truncate">{dc.fileItem.file.name}</span>
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
        {step === 'processing' && (
          <div className="space-y-3">
            {createdCourseIds.map((courseId) => {
              const course = allCourses.find(c => c.id === courseId);
              return (
                <div key={courseId} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-gray-900">{course?.code || '—'}</p>
                    <p className="text-xs text-gray-500 truncate">{course?.name}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-4 shrink-0">
                    {(!course || course.status === 'processing') && (
                      <span className="flex items-center gap-1 text-xs text-indigo-600">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Processing
                      </span>
                    )}
                    {course?.status === 'ready' && (
                      <span className="flex items-center gap-1 text-xs text-green-600">
                        <Check className="w-3.5 h-3.5" />
                        Done
                      </span>
                    )}
                    {course?.status === 'failed' && (
                      <>
                        <span className="flex items-center gap-1 text-xs text-red-600">
                          <X className="w-3.5 h-3.5" />
                          Failed
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs rounded-lg px-2"
                          onClick={() => retryProcessing(courseId)}
                        >
                          <RefreshCw className="w-3 h-3 mr-1" />
                          Retry
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            <Button variant="outline" className="w-full rounded-lg mt-2" onClick={onClose}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
