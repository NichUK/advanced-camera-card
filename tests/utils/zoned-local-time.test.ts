import { describe, expect, it, vi } from 'vitest';

import { resolveZonedLocalTime } from '../../src/utils/zoned-local-time';

describe('explicit timezone date selection', () => {
  it('resolves seconds inside a recording while retaining explicit DST decisions', () => {
    expect(
      resolveZonedLocalTime(
        '2026-10-02T14:35:07',
        'Europe/Paris',
      ).candidates[0].date.toISOString(),
    ).toBe('2026-10-02T12:35:07.000Z');
    expect(resolveZonedLocalTime('2026-03-29T02:30:07', 'Europe/Paris').error).toBe(
      'nonexistent_local_time',
    );
    expect(
      resolveZonedLocalTime('2026-10-25T02:30:07', 'Europe/Paris').candidates.map(
        (item) => item.date.toISOString(),
      ),
    ).toEqual(['2026-10-25T00:30:07.000Z', '2026-10-25T01:30:07.000Z']);
    expect(resolveZonedLocalTime('2026-10-02T14:35:99', 'Europe/Paris').error).toBe(
      'invalid_local_time',
    );
  });
  it('does not hide unexpected formatter failures', () => {
    const failure = new Error('unexpected formatter failure');
    const formatter = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function () {
      throw failure;
    });
    try {
      expect(() => resolveZonedLocalTime('2026-10-02T12:00', 'UTC')).toThrow(failure);
    } finally {
      formatter.mockRestore();
    }
  });
  it('resolves the same instant independently of browser timezone', () => {
    for (const [value, zone] of [
      ['2026-10-02T14:35', 'Europe/Paris'],
      ['2026-10-02T13:35', 'Europe/London'],
      ['2026-10-02T08:35', 'America/New_York'],
      ['2026-10-02T12:35', 'UTC'],
    ]) {
      const result = resolveZonedLocalTime(value, zone);
      expect(result.error).toBeNull();
      expect(result.candidates.map((candidate) => candidate.date.toISOString())).toEqual(
        ['2026-10-02T12:35:00.000Z'],
      );
    }
  });
  it('rejects nonexistent Paris spring-forward time', () => {
    expect(resolveZonedLocalTime('2026-03-29T02:30', 'Europe/Paris')).toEqual({
      candidates: [],
      error: 'nonexistent_local_time',
    });
  });
  it('returns both repeated Paris instants with explicit offsets', () => {
    const result = resolveZonedLocalTime('2026-10-25T02:30', 'Europe/Paris');
    expect(
      result.candidates.map((candidate) => [
        candidate.date.toISOString(),
        candidate.offset,
      ]),
    ).toEqual([
      ['2026-10-25T00:30:00.000Z', 'UTC+02:00'],
      ['2026-10-25T01:30:00.000Z', 'UTC+01:00'],
    ]);
  });
  it('handles half-hour zones and a half-hour rollback', () => {
    expect(
      resolveZonedLocalTime(
        '2026-10-02T18:05',
        'Asia/Kolkata',
      ).candidates[0].date.toISOString(),
    ).toBe('2026-10-02T12:35:00.000Z');
    expect(
      resolveZonedLocalTime('2026-04-05T01:45', 'Australia/Lord_Howe').candidates,
    ).toHaveLength(2);
  });
  it('rejects malformed values, normalized dates and unknown zones', () => {
    for (const value of ['', '2026-02-30T12:00', '2026-10-02T25:00', '2026-1-1T12:00']) {
      expect(resolveZonedLocalTime(value, 'Europe/Paris').error).toBe(
        'invalid_local_time',
      );
    }
    expect(resolveZonedLocalTime('2026-10-02T12:00', 'Invalid/Zone').error).toBe(
      'invalid_time_zone',
    );
  });
});
