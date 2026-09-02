import { DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { FileText, PenSquare, Layers } from 'lucide-react';

interface AddCourseChooserProps {
  onUpload: () => void;
  onCreateManually: () => void;
  onBulkUpload: () => void;
  onCancel: () => void;
}

/** The "how would you like to add your course?" card chooser (SYL-39). */
export function AddCourseChooser({ onUpload, onCreateManually, onBulkUpload, onCancel }: AddCourseChooserProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Add Course</DialogTitle>
        <DialogDescription>
          How would you like to add your course?
        </DialogDescription>
      </DialogHeader>

      <div className="py-6 space-y-4">
        <button
          onClick={onUpload}
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
          onClick={onCreateManually}
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
          onClick={onBulkUpload}
          className="w-full p-6 rounded-2xl border-2 border-gray-200 hover:border-teal-400 hover:bg-teal-50 transition-colors text-left group"
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
                Upload several PDFs at once — we'll detect course names and codes automatically. All courses go into your current semester.
              </p>
            </div>
          </div>
        </button>
      </div>

      <div className="flex justify-end pt-4">
        <Button variant="outline" onClick={onCancel} className="rounded-lg">
          Cancel
        </Button>
      </div>
    </>
  );
}
