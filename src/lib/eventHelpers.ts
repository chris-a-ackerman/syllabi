import type { Event } from '@/app/context/AppContext';

/**
 * Returns Tailwind color classes for an event-type badge.
 * Canonical source — imported by Agenda, CourseDetail, and DeadlineUrgencyBanner.
 */
export function getEventTypeColor(type: string): string {
  switch (type) {
    case 'exam':         return 'bg-red-100 text-red-800';
    case 'deadline':     return 'bg-orange-100 text-orange-800';
    case 'quiz':         return 'bg-yellow-100 text-yellow-800';
    case 'no_class':     return 'bg-gray-100 text-gray-800';
    case 'presentation': return 'bg-purple-100 text-purple-800';
    case 'project_due':  return 'bg-orange-100 text-orange-800';
    default:             return 'bg-blue-100 text-blue-800';
  }
}

/**
 * Returns a human-readable label for an event type.
 * Canonical source — imported by Agenda, CourseDetail, and DeadlineUrgencyBanner.
 */
export function getEventTypeLabel(type: Event['type']): string {
  switch (type) {
    case 'exam':         return 'Exam';
    case 'deadline':     return 'Deadline';
    case 'quiz':         return 'Quiz';
    case 'presentation': return 'Presentation';
    case 'project_due':  return 'Project';
    case 'no_class':     return 'No Class';
    default:             return 'Event';
  }
}
