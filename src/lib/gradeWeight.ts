/**
 * Normalize a grading-component weight to an integer percent.
 * Weights may be decimals (0.15) or percents (15) depending on extraction run.
 * Canonical source — imported by CourseDetail and CourseQuickInfoCards.
 */
export function toPercent(w: number): number {
  return w > 0 && w <= 1 ? Math.round(w * 100) : Math.round(w);
}
