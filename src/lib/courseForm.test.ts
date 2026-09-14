import { describe, expect, it } from 'vitest';
import { COURSE_COLORS, courseColorAt, nextCourseColor } from './courseColors';
import { initialFormValues } from './courseForm';

// SYL-62: UploadSyllabusModal used to start every form from a constant
// (color: COURSE_COLORS[0]) — re-uploads recoloured the course indigo and
// every single-PDF course was created indigo.

describe('initialFormValues', () => {
  it('seeds name, code, professor and colour from the existing course', () => {
    const values = initialFormValues({
      id: 'c1',
      name: 'Organic Chemistry I',
      code: 'CHEM 201',
      professor: 'Dr. Rivera',
      color: COURSE_COLORS[6],
    });
    expect(values).toEqual({
      name: 'Organic Chemistry I',
      code: 'CHEM 201',
      professor: 'Dr. Rivera',
      color: COURSE_COLORS[6],
    });
  });

  it('keeps a non-palette colour on an existing course rather than resetting it', () => {
    const values = initialFormValues({ id: 'c1', name: 'X', code: 'X 1', professor: '', color: '#123456' });
    expect(values.color).toBe('#123456');
  });

  it('starts a new course blank with the first palette colour when the semester is empty', () => {
    expect(initialFormValues()).toEqual({ name: '', code: '', professor: '', color: COURSE_COLORS[0] });
    expect(initialFormValues(undefined, [])).toEqual({ name: '', code: '', professor: '', color: COURSE_COLORS[0] });
  });

  it('gives two consecutive single uploads different colours', () => {
    const first = initialFormValues(undefined, []);
    const second = initialFormValues(undefined, [{ color: first.color }]);
    const third = initialFormValues(undefined, [{ color: first.color }, { color: second.color }]);
    expect(second.color).not.toBe(first.color);
    expect(third.color).not.toBe(first.color);
    expect(third.color).not.toBe(second.color);
    expect([first.color, second.color, third.color]).toEqual(COURSE_COLORS.slice(0, 3));
  });

  it('ignores the existing courses when targeting an existing course', () => {
    const target = { id: 'c1', name: 'X', code: 'X 1', professor: '', color: COURSE_COLORS[3] };
    expect(initialFormValues(target, [{ color: COURSE_COLORS[3] }]).color).toBe(COURSE_COLORS[3]);
  });
});

describe('nextCourseColor', () => {
  it('picks the first palette colour not already used in the semester', () => {
    // A gap left by a deleted course is reused before moving further along.
    expect(nextCourseColor([{ color: COURSE_COLORS[0] }, { color: COURSE_COLORS[2] }])).toBe(COURSE_COLORS[1]);
  });

  it('wraps around by count once every palette colour is taken', () => {
    const all = COURSE_COLORS.map(color => ({ color }));
    expect(nextCourseColor(all)).toBe(COURSE_COLORS[0]);
    expect(nextCourseColor([...all, { color: COURSE_COLORS[0] }])).toBe(COURSE_COLORS[1]);
  });
});

describe('courseColorAt', () => {
  it('rotates through the palette the way the bulk flow does', () => {
    expect(courseColorAt(0)).toBe(COURSE_COLORS[0]);
    expect(courseColorAt(COURSE_COLORS.length - 1)).toBe(COURSE_COLORS[COURSE_COLORS.length - 1]);
    expect(courseColorAt(COURSE_COLORS.length)).toBe(COURSE_COLORS[0]);
  });
});
