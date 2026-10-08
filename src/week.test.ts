import assert from 'node:assert/strict';
import test from 'node:test';
import { pacificWeekWindowForDate } from './week.js';

test('builds a week window from a Monday start so Sunday events are included', () => {
  const window = pacificWeekWindowForDate('2026-10-05');
  assert.equal(window.start.toISOString(), '2026-10-05T07:00:00.000Z');
  assert.equal(window.end.toISOString(), '2026-10-12T07:00:00.000Z');
});

test('rejects malformed or impossible calendar dates', () => {
  assert.throws(() => pacificWeekWindowForDate('2026-10-05T00:00:00Z'), /YYYY-MM-DD/);
  assert.throws(() => pacificWeekWindowForDate('2026-02-30'), /valid calendar date/);
});
