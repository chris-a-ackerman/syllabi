import { useState } from 'react';
import { useApp } from '../context/AppContext';
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

interface AddSemesterModalProps {
  open: boolean;
  onClose: () => void;
}

export function AddSemesterModal({ open, onClose }: AddSemesterModalProps) {
  const { addSemester } = useApp();
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addSemester({
      name,
      startDate,
      endDate,
    });
    setName('');
    setStartDate('');
    setEndDate('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="rounded-2xl max-w-md">
        <DialogHeader>
          <DialogTitle>Add Semester</DialogTitle>
          <DialogDescription>
            Create a new semester to organize your courses.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
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
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 rounded-lg">
              Cancel
            </Button>
            <Button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-700 rounded-lg">
              Add Semester
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}