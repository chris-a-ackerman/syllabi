import { Input } from './ui/input';
import { Label } from './ui/label';
import { COURSE_COLORS } from '@/lib/courseColors';

export interface CourseFormValues {
  name: string;
  code: string;
  professor: string;
  color: string;
}

interface CourseFormFieldsProps {
  values: CourseFormValues;
  onChange: (updates: Partial<CourseFormValues>) => void;
}

/**
 * The course field set shared by the manual create/edit form and the
 * post-upload review form (SYL-39: previously two divergent copies inside
 * AddCourseModal).
 */
export function CourseFormFields({ values, onChange }: CourseFormFieldsProps) {
  return (
    <>
      <div>
        <Label htmlFor="courseName">Course Name *</Label>
        <Input
          id="courseName"
          value={values.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. Introduction to Computer Science"
          className="mt-1 rounded-lg"
          required
        />
      </div>

      <div>
        <Label htmlFor="courseCode">Course Code</Label>
        <Input
          id="courseCode"
          value={values.code}
          onChange={(e) => onChange({ code: e.target.value })}
          placeholder="e.g. CS 101"
          className="mt-1 rounded-lg"
        />
      </div>

      <div>
        <Label htmlFor="professor">Professor</Label>
        <Input
          id="professor"
          value={values.professor}
          onChange={(e) => onChange({ professor: e.target.value })}
          placeholder="e.g. Dr. Jane Smith"
          className="mt-1 rounded-lg"
        />
      </div>

      <div>
        <Label>Course Color *</Label>
        <div className="grid grid-cols-5 gap-2 mt-2">
          {COURSE_COLORS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ color: c })}
              className={`w-10 h-10 rounded-lg transition-all ${
                values.color === c ? 'ring-2 ring-offset-2 ring-indigo-600' : ''
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
    </>
  );
}
