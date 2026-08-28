import { describe, expect, it } from 'vitest';
import { getEventTypeColor, getEventTypeLabel } from './eventHelpers';
import type { Event } from '@/lib/types';

const ALL_TYPES: Event['type'][] = [
  'exam', 'deadline', 'quiz', 'presentation', 'project_due', 'no_class', 'other',
];

describe('getEventTypeColor', () => {
  it('maps every event type to its badge classes', () => {
    expect(getEventTypeColor('exam')).toBe('bg-red-100 text-red-800');
    expect(getEventTypeColor('deadline')).toBe('bg-orange-100 text-orange-800');
    expect(getEventTypeColor('quiz')).toBe('bg-yellow-100 text-yellow-800');
    expect(getEventTypeColor('no_class')).toBe('bg-gray-100 text-gray-800');
    expect(getEventTypeColor('presentation')).toBe('bg-purple-100 text-purple-800');
    expect(getEventTypeColor('project_due')).toBe('bg-orange-100 text-orange-800');
    expect(getEventTypeColor('other')).toBe('bg-blue-100 text-blue-800');
  });

  it('returns a non-empty class string for every known type', () => {
    for (const type of ALL_TYPES) {
      expect(getEventTypeColor(type)).toMatch(/^bg-\S+ text-\S+$/);
    }
  });
});

describe('getEventTypeLabel', () => {
  it('maps every event type to its display label', () => {
    expect(getEventTypeLabel('exam')).toBe('Exam');
    expect(getEventTypeLabel('deadline')).toBe('Deadline');
    expect(getEventTypeLabel('quiz')).toBe('Quiz');
    expect(getEventTypeLabel('presentation')).toBe('Presentation');
    expect(getEventTypeLabel('project_due')).toBe('Project');
    expect(getEventTypeLabel('no_class')).toBe('No Class');
    expect(getEventTypeLabel('other')).toBe('Event');
  });
});
