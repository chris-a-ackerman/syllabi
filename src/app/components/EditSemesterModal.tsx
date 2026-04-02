import { useState, useEffect } from 'react';
import { useApp, type Semester } from '../context/AppContext';
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

interface EditSemesterModalProps {
  open: boolean;
  onClose: () => void;
  semester: Semester;
}

export function EditSemesterModal({ open, onClose, semester }: EditSemesterModalProps) {
  const { courses, updateSemester, deleteSemester } = useApp();
  const [name, setName] = useState(semester.name);
  const [startDate, setStartDate] = useState(semester.startDate);
  const [endDate, setEndDate] = useState(semester.endDate);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync form fields when the semester prop changes (e.g. switching which semester to edit)
  useEffect(() => {
    setName(semester.name);
    setStartDate(semester.startDate);
    setEndDate(semester.endDate);
    setConfirmDelete(false);
  }, [semester.id]);

  const courseCount = courses.filter(c => c.semesterId === semester.id).length;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSemester(semester.id, { name, startDate, endDate });
    onClose();
  };

  const handleDelete = async () => {
    await deleteSemester(semester.id);
    onClose();
  };

  const handleClose = () => {
    setConfirmDelete(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="rounded-2xl max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Semester</DialogTitle>
          <DialogDescription>
            Update the semester name and dates.
          </DialogDescription>
        </DialogHeader>

        {!confirmDelete ? (
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <Label htmlFor="editSemesterName">Semester Name</Label>
              <Input
                id="editSemesterName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Spring 2026"
                className="mt-1 rounded-lg"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="editStartDate">Start Date</Label>
                <Input
                  id="editStartDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mt-1 rounded-lg"
                  required
                />
              </div>
              <div>
                <Label htmlFor="editEndDate">End Date</Label>
                <Input
                  id="editEndDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="mt-1 rounded-lg"
                  required
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-4">
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={() => setConfirmDelete(true)}
              >
                Delete Semester
              </Button>
              <div className="flex gap-3">
                <Button type="button" variant="outline" onClick={handleClose} className="rounded-lg">
                  Cancel
                </Button>
                <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 rounded-lg">
                  Save Changes
                </Button>
              </div>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-800">
              <p className="font-semibold mb-1">This cannot be undone.</p>
              {courseCount > 0 ? (
                <p>
                  This will permanently delete <span className="font-semibold">{semester.name}</span> along
                  with {courseCount} {courseCount === 1 ? 'course' : 'courses'} and all their events,
                  grading data, and notes.
                </p>
              ) : (
                <p>
                  This will permanently delete <span className="font-semibold">{semester.name}</span>.
                </p>
              )}
            </div>
            <div className="flex gap-3 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleDelete}
                className="rounded-lg bg-red-600 hover:bg-red-700 text-white"
              >
                Delete Everything
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
