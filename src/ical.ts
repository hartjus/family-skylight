import ICAL from 'ical.js';

export type ParsedCalendarEvent = {
  externalId: string;
  seriesId: string | null;
  recurrenceId: string | null;
  title: string;
  location: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
};

const MAX_OCCURRENCES_PER_SERIES = 20_000;

function eventStatus(event: InstanceType<typeof ICAL.Event>) {
  return String(event.component.getFirstPropertyValue('status') ?? '').toUpperCase();
}

function eventInstance(options: {
  series: InstanceType<typeof ICAL.Event>;
  recurrenceId?: InstanceType<typeof ICAL.Time>;
  item?: InstanceType<typeof ICAL.Event>;
  start: InstanceType<typeof ICAL.Time>;
  end: InstanceType<typeof ICAL.Time>;
}): ParsedCalendarEvent | undefined {
  const item = options.item ?? options.series;
  if (eventStatus(item) === 'CANCELLED') return undefined;
  const recurrenceId = options.recurrenceId?.convertToZone(ICAL.Timezone.utcTimezone).toString() ?? null;
  return {
    externalId: recurrenceId ? `${options.series.uid}::${recurrenceId}` : options.series.uid,
    seriesId: recurrenceId ? options.series.uid : null,
    recurrenceId,
    title: item.summary || options.series.summary || 'Untitled event',
    location: item.location || options.series.location || null,
    startAt: options.start.toJSDate().toISOString(),
    endAt: options.end.toJSDate().toISOString(),
    allDay: options.start.isDate,
  };
}

/**
 * Parses a Google iCal feed and materializes recurring occurrences in the supplied window.
 * The feed remains authoritative: callers replace the calendar cache after a successful parse.
 */
export function parseCalendarEvents(ics: string, recurringWindowStart: Date, recurringWindowEnd: Date): ParsedCalendarEvent[] {
  const root = new ICAL.Component(ICAL.parse(ics));
  const events = root.getAllSubcomponents('vevent').map(component => new ICAL.Event(component));
  const masters = events.filter(event => !event.isRecurrenceException());
  const exceptions = events.filter(event => event.isRecurrenceException());
  const exceptionsByUid = new Map<string, InstanceType<typeof ICAL.Event>[]>();
  for (const exception of exceptions) exceptionsByUid.set(exception.uid, [...(exceptionsByUid.get(exception.uid) ?? []), exception]);

  const output: ParsedCalendarEvent[] = [];
  const startTime = ICAL.Time.fromJSDate(recurringWindowStart, true);
  const endTime = ICAL.Time.fromJSDate(recurringWindowEnd, true);

  for (const master of masters) {
    for (const exception of exceptionsByUid.get(master.uid) ?? []) master.relateException(exception);

    if (!master.isRecurring()) {
      const instance = eventInstance({ series: master, start: master.startDate, end: master.endDate });
      if (instance) output.push(instance);
      continue;
    }

    const iterator = master.iterator();
    let occurrence: InstanceType<typeof ICAL.Time> | null;
    let generated = 0;
    while ((occurrence = iterator.next())) {
      if (++generated > MAX_OCCURRENCES_PER_SERIES) throw new Error(`Recurrence series ${master.uid} exceeds the supported expansion limit`);
      if (occurrence.compare(endTime) >= 0) break;
      const details = master.getOccurrenceDetails(occurrence);
      if (details.endDate.compare(startTime) <= 0) continue;
      const instance = eventInstance({ series: master, recurrenceId: details.recurrenceId, item: details.item, start: details.startDate, end: details.endDate });
      if (instance) output.push(instance);
    }
  }
  return output;
}
