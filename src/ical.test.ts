import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCalendarEvents } from './ical.js';

const windowStart = new Date('2026-09-01T00:00:00.000Z');
const windowEnd = new Date('2027-09-01T00:00:00.000Z');

test('expands recurring events and honors exclusions and moved overrides', () => {
  const ics = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:weekly-family-event\r
DTSTART:20260907T170000Z\r
DTEND:20260907T180000Z\r
SUMMARY:School pickup\r
LOCATION:Front office\r
RRULE:FREQ=WEEKLY;COUNT=4\r
EXDATE:20260914T170000Z\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:weekly-family-event\r
RECURRENCE-ID:20260921T170000Z\r
DTSTART:20260921T190000Z\r
DTEND:20260921T200000Z\r
SUMMARY:Late school pickup\r
LOCATION:Side entrance\r
END:VEVENT\r
END:VCALENDAR`;
  const events = parseCalendarEvents(ics, windowStart, windowEnd);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(event => event.title), ['School pickup', 'Late school pickup', 'School pickup']);
  assert.deepEqual(events.map(event => event.startAt), ['2026-09-07T17:00:00.000Z', '2026-09-21T19:00:00.000Z', '2026-09-28T17:00:00.000Z']);
  assert.equal(events[1].location, 'Side entrance');
  assert.equal(events[1].seriesId, 'weekly-family-event');
});

test('keeps recurring instances inside the requested twelve-month window', () => {
  const ics = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:daily-event\r
DTSTART:20260830T170000Z\r
DTEND:20260830T180000Z\r
SUMMARY:Daily event\r
RRULE:FREQ=DAILY;COUNT=500\r
END:VEVENT\r
END:VCALENDAR`;
  const events = parseCalendarEvents(ics, windowStart, windowEnd);
  assert.equal(events[0].startAt, '2026-09-01T17:00:00.000Z');
  assert.equal(events.at(-1)?.startAt, '2027-08-31T17:00:00.000Z');
  assert.equal(events.length, 365);
});

test('includes recurring instances from six previous calendar months when requested', () => {
  const ics = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:monthly-history\r
DTSTART:20260115T170000Z\r
DTEND:20260115T180000Z\r
SUMMARY:Monthly history\r
RRULE:FREQ=MONTHLY;COUNT=24\r
END:VEVENT\r
END:VCALENDAR`;
  const events = parseCalendarEvents(ics, new Date('2026-03-01T00:00:00.000Z'), windowEnd);
  assert.equal(events[0].startAt, '2026-03-15T17:00:00.000Z');
  assert.equal(events.some(event => event.startAt === '2026-02-15T17:00:00.000Z'), false);
});

test('does not materialize cancelled recurrence exceptions', () => {
  const ics = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:cancelled-instance\r
DTSTART:20260901T170000Z\r
DTEND:20260901T180000Z\r
SUMMARY:Weekly event\r
RRULE:FREQ=WEEKLY;COUNT=2\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:cancelled-instance\r
RECURRENCE-ID:20260908T170000Z\r
DTSTART:20260908T170000Z\r
DTEND:20260908T180000Z\r
STATUS:CANCELLED\r
END:VEVENT\r
END:VCALENDAR`;
  const events = parseCalendarEvents(ics, windowStart, windowEnd);
  assert.equal(events.length, 1);
  assert.equal(events[0].startAt, '2026-09-01T17:00:00.000Z');
});

test('preserves Pacific wall-clock time across daylight-saving time', () => {
  const ics = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:pacific-dst\r
DTSTART;TZID=America/Los_Angeles:20260308T090000\r
DTEND;TZID=America/Los_Angeles:20260308T100000\r
SUMMARY:Sunday activity\r
RRULE:FREQ=WEEKLY;COUNT=2\r
END:VEVENT\r
END:VCALENDAR`;
  const events = parseCalendarEvents(ics, new Date('2026-03-01T00:00:00.000Z'), new Date('2026-04-01T00:00:00.000Z'));
  assert.deepEqual(events.map(event => event.startAt), ['2026-03-08T16:00:00.000Z', '2026-03-15T16:00:00.000Z']);
});
