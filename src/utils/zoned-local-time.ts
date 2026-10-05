export interface ZonedTimeCandidate {
  date: Date;
  offset: string;
}

export interface ZonedLocalTimeResult {
  candidates: ZonedTimeCandidate[];
  error: 'invalid_time_zone' | 'invalid_local_time' | 'nonexistent_local_time' | null;
}

export function resolveZonedLocalTime(
  value: string,
  timeZone: string,
): ZonedLocalTimeResult {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return { candidates: [], error: 'invalid_local_time' };
  }
  const nominal = new Date(`${value}:00Z`);
  if (
    !Number.isFinite(nominal.getTime()) ||
    nominal.toISOString().slice(0, 16) !== value
  ) {
    return { candidates: [], error: 'invalid_local_time' };
  }
  let formatter: Intl.DateTimeFormat;
  let offsetFormatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    offsetFormatter = new Intl.DateTimeFormat('en', {
      timeZone,
      timeZoneName: 'longOffset',
    });
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }
    return { candidates: [], error: 'invalid_time_zone' };
  }
  const wallTime = (date: Date): string => {
    const parts = Object.fromEntries(
      formatter.formatToParts(date).map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  };
  // Sample both sides of a transition, then round-trip each possible offset.
  // Never let Date's local parser normalize a missing hour or choose a fold.
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const probe = new Date(nominal.getTime() + hours * 3600000);
    offsets.add(new Date(`${wallTime(probe)}:00Z`).getTime() - probe.getTime());
  }
  const candidates: ZonedTimeCandidate[] = [];
  for (const offset of offsets) {
    const date = new Date(nominal.getTime() - offset);
    if (wallTime(date) === value) {
      const name = offsetFormatter
        .formatToParts(date)
        .find((part) => part.type === 'timeZoneName');
      // Intl always supplies the requested timeZoneName part.
      /* v8 ignore next -- @preserve */
      candidates.push({ date, offset: name?.value.replace('GMT', 'UTC') ?? 'UTC' });
    }
  }
  candidates.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { candidates, error: candidates.length ? null : 'nonexistent_local_time' };
}
