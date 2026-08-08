import { describe, expect, it } from 'vitest';

import { cn, daysUntil, formatDate, formatDateTime, formatRelative, initials, mask } from './utils';

describe('cn', () => {
  it('merges class names and deduplicates conflicting Tailwind classes', () => {
    // tailwind-merge keeps the last conflicting utility (px-4) and drops px-2.
    expect(cn('px-2', 'text-sm', 'px-4')).toBe('text-sm px-4');
  });

  it('filters out falsy values', () => {
    expect(cn('a', null, undefined, false, 'b')).toBe('a b');
  });
});

describe('formatDate', () => {
  it('returns an em dash for nullish input', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
  });

  it('returns an em dash for invalid dates', () => {
    expect(formatDate('not-a-date')).toBe('—');
  });

  it('formats a valid date in the en-US long form', () => {
    expect(formatDate('2025-08-02')).toMatch(/Aug 2, 2025/);
  });

  it('accepts a Date object', () => {
    expect(formatDate(new Date('2025-08-02T12:00:00Z'))).toMatch(/Aug 2, 2025/);
  });
});

describe('formatDateTime', () => {
  it('includes the time component', () => {
    expect(formatDateTime('2025-08-02T14:00:00')).toMatch(/Aug 2, 2025/);
    expect(formatDateTime('2025-08-02T14:00:00')).toMatch(/2:00/);
  });
});

describe('formatRelative', () => {
  it('returns "just now" for recent timestamps', () => {
    expect(formatRelative(new Date())).toBe('just now');
  });

  it('reports days in the past', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
    expect(formatRelative(threeDaysAgo)).toMatch(/3 days ago/);
  });
});

describe('daysUntil', () => {
  it('is positive for future dates and negative for past dates', () => {
    expect(daysUntil(new Date(Date.now() + 5 * 86400000))).toBeGreaterThan(0);
    expect(daysUntil(new Date(Date.now() - 5 * 86400000))).toBeLessThan(0);
  });
});

describe('initials', () => {
  it('extracts initials from a full name', () => {
    expect(initials('Jane Alice Doe')).toBe('JA');
  });

  it('handles a single name', () => {
    expect(initials('Madonna')).toBe('M');
  });
});

describe('mask', () => {
  it('masks everything but the last visible characters', () => {
    expect(mask('1234567890')).toBe('••••••7890');
  });

  it('does not expose more characters than the input length', () => {
    expect(mask('ab', 4)).toBe('••');
  });

  it('supports a custom visible length', () => {
    expect(mask('12345678', 2)).toBe('••••••78');
  });
});
