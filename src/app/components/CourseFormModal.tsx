import { useState } from 'react';
import { useData } from '../context/DataProvider';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { Upload, CheckCircle, AlertCircle } from 'lucide-react';
import { CourseFormFields, type CourseFormValues } from './CourseFormFields';
import { COURSE_COLORS } from '@/lib/courseColors';

export interface CourseModalTarget {
  id: string;
  name: string;
  code: string;
  color: string;
  professor?: string;
}

interface CourseFormModalProps {
  open: boolean;
  onClose: () => void;
  /** When set, the modal edits this course instead of creating a new one. */
  existingCourse?: CourseModalTarget;
  /** Create flow: returns to the caller's chooser. */
  onBack?: () => void;
  /** Create flow: the user wants to upload a syllabus for the course they just created. */
  onUploadSyllabus?: (course: CourseModalTarget) => void;
}

const EMPTY_VALUES: CourseFormValues = { name: '', code: '', professor: '', color: COURSE_COLORS[0] };

/** Manual course create + edit form (SYL-39: split out of AddCourseModal). */
export function CourseFormModal({ open, ...props }: CourseFormModalProps) {
  // Mounted only while open so form state initializes fresh from props each time
  if (!open) return null;
  return <CourseFormModalContent {...props} />;
}

function CourseFormModalContent({ onClose, existingCourse, onBack, onUploadSyllabus }: Omit<CourseFormModalProps, 'open'>) {
  const { addCourse, updateCourse, semesters } = useData();
  const [values, setValues] = useState<CourseFormValues>(() => existingCourse
    ? {
        name: existingCourse.name,
        code: existingCourse.code,
        professor: existingCourse.professor ?? '',
        color: existingCourse.color,
      }
    : EMPTY_VALUES);
  const [createdCourse, setCreatedCourse] = useState<CourseModalTarget | null>(null);
  const [saving, setSaving] = useState(false);

  const activeSemester = semesters.find(s => s.isActive);
  const editMode = !!existingCourse;

  const handleSave = async () => {
    if (!values.name) return;

    if (existingCourse) {
      updateCourse(existingCourse.id, {
        name: values.name,
        code: values.code,
        professor: values.professor,
        color: values.color,
      });
      onClose();
      return;
    }

    if (!activeSemester) return;

    setSaving(true);
    const newId = await addCourse({
      semesterId: activeSemester.id,
      name: values.name,
      code: values.code,
      professor: values.professor,
      color: values.color,
      status: 'processing',
      extractionQuality: undefined,
      extractedCount: 0,
    });
    setSaving(false);
    if (newId) {
      setCreatedCourse({
        id: newId,
        name: values.name,
        code: values.code,
        color: values.color,
        professor: values.professor,
      });
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="rounded-2xl max-w-2xl">
        {!createdCourse ? (
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
              <CourseFormFields values={values} onChange={(updates) => setValues(prev => ({ ...prev, ...updates }))} />

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
              {!editMode && onBack && (
                <Button variant="outline" onClick={onBack} className="rounded-lg">
                  Back
                </Button>
              )}
              <Button
                onClick={handleSave}
                disabled={!values.name || saving}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                {editMode ? 'Save Changes' : 'Create Course'}
              </Button>
            </div>
          </>
        ) : (
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
              <Button variant="outline" onClick={onClose} className="flex-1 rounded-lg">
                Done
              </Button>
              {onUploadSyllabus && (
                <Button
                  onClick={() => onUploadSyllabus(createdCourse)}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Syllabus
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
