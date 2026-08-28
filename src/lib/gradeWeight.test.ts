import { describe, expect, it } from 'vitest';
import { toPercent } from './gradeWeight';

describe('toPercent', () => {
  it('treats weights in (0, 1] as decimal fractions', () => {
    expect(toPercent(0.15)).toBe(15);
    expect(toPercent(0.5)).toBe(50);
    expect(toPercent(0.333)).toBe(33);
    expect(toPercent(1)).toBe(100); // boundary: 1 means 100%, not 1%
  });

  it('treats weights above 1 as percents already', () => {
    expect(toPercent(15)).toBe(15);
    expect(toPercent(33.4)).toBe(33);
    expect(toPercent(100)).toBe(100);
  });

  it('passes zero through', () => {
    expect(toPercent(0)).toBe(0);
  });
});
