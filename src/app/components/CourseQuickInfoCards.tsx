import { parseISO, format } from 'date-fns';
import { Card } from './ui/card';
import type { Course, Event } from '../context/AppContext';

interface CourseQuickInfoCardsProps {
  course: Course;
  events: Event[];
}

// Replicates the toPercent helper used in CourseDetail grading tab (line ~399).
// Weights may be decimals (0.15) or percents (15) depending on extraction run.
function toPercent(w: number): number {
  return w > 0 && w <= 1 ? Math.round(w * 100) : Math.round(w);
}

export function CourseQuickInfoCards({ course, events }: CourseQuickInfoCardsProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Future events only (date >= today, date must be non-null)
  const futureEvents = events.filter(e => {
    if (!e.date) return false;
    const d = parseISO(e.date);
    return d >= today;
  });

  // Card 1: Next deadline — soonest future event of any type
  const nextDeadline = futureEvents.length > 0 ? futureEvents[0] : null;

  // Card 2: Next exam — soonest future event with type exam or quiz
  const nextExam = futureEvents.find(e => e.type === 'exam' || e.type === 'quiz') ?? null;

  // Card 3: Grade weight for next deadline's category
  let gradeWeightDisplay: string = '—';
  if (nextDeadline?.category) {
    const components = course.grading_rules?.components ?? [];
    const normalizedCategory = nextDeadline.category.trim().toLowerCase();
    const match = components.find(
      c => c.name.trim().toLowerCase() === normalizedCategory
    );
    if (match != null) {
      gradeWeightDisplay = `${toPercent(match.weight)}%`;
    }
  }

  // Card 4: Office hours
  const officeHours = course.schedule?.instructor?.office_hours ?? null;

  const cards = [
    {
      label: 'Next deadline',
      primary: nextDeadline ? nextDeadline.title : '—',
      secondary: nextDeadline?.date ? format(parseISO(nextDeadline.date), 'MMM d') : null,
    },
    {
      label: 'Next exam',
      primary: nextExam ? nextExam.title : '—',
      secondary: nextExam?.date ? format(parseISO(nextExam.date), 'MMM d') : null,
    },
    {
      label: 'Grade weight',
      primary: gradeWeightDisplay,
      secondary:
        gradeWeightDisplay !== '—' && nextDeadline?.category
          ? nextDeadline.category
          : null,
    },
    {
      label: 'Office hours',
      primary: officeHours ?? '—',
      secondary: null,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {cards.map(card => (
        <Card
          key={card.label}
          className="p-4 rounded-xl shadow-sm gap-1"
        >
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            {card.label}
          </p>
          <p
            className={`font-semibold text-gray-900 leading-snug break-words ${
              card.primary === '—' ? 'text-gray-400' : 'text-gray-900'
            }`}
          >
            {card.primary}
          </p>
          {card.secondary && (
            <p className="text-sm text-gray-500">{card.secondary}</p>
          )}
        </Card>
      ))}
    </div>
  );
}
