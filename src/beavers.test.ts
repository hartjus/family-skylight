import assert from 'node:assert/strict';
import test from 'node:test';
import { beaverSports, completionTime, createBeaversService, gameStatus, normalizeGame, nextScheduleCheck, GAME_REFRESH_MS, type BeaverCache, type ESPNEvent } from './beavers.js';

const now = Date.parse('2026-10-19T03:30:00Z');
const football = beaverSports[0];
function event(name = 'STATUS_IN_PROGRESS', state = 'in', completed = false): ESPNEvent {
  return {
    id: '123', date: new Date(now - 3 * 60 * 60_000).toISOString(),
    competitions: [{
      status: { displayClock: '4:21', period: 3, type: { name, state, completed } },
      competitors: [
        { team: { id: '204', displayName: 'Oregon State Beavers', logos: [{ href: 'https://example.com/beavers.png' }] }, score: { displayValue: '21' } },
        { team: { id: '248', displayName: 'Houston Cougars' }, score: '14' },
      ],
    }],
  };
}
const final = () => event('STATUS_FINAL', 'post', true);

test('normalizes live scores, logos and the football clock', () => {
  const game = normalizeGame(event(), football, now)!;
  assert.equal(game.status, 'Q3 · 4:21 remaining');
  assert.deepEqual(game.teams.map((team) => team.score), ['21', '14']);
  assert.equal(game.teams[0].logo, 'https://example.com/beavers.png');
  assert.equal(game.expiresAt, now + 360_000);
});

test('hides scheduled, postponed, cancelled, suspended and unrelated games', () => {
  for (const name of ['STATUS_SCHEDULED', 'STATUS_POSTPONED', 'STATUS_CANCELED', 'STATUS_SUSPENDED', 'STATUS_DELAYED']) {
    assert.equal(normalizeGame(event(name, name === 'STATUS_SCHEDULED' ? 'pre' : 'in'), football, now), undefined);
  }
  const unrelated = event();
  unrelated.competitions![0].competitors![0].team!.id = '999';
  assert.equal(normalizeGame(unrelated, football, now), undefined);
});

test('keeps halftime visible and formats halves, quarters, overtime and innings', () => {
  const halftime = event('STATUS_HALFTIME');
  halftime.competitions![0].status!.type!.detail = 'Halftime';
  assert.equal(normalizeGame(halftime, football, now)?.status, 'Halftime');
  const status = { displayClock: '2:10', period: 2, type: { name: 'STATUS_IN_PROGRESS' } };
  assert.equal(gameStatus(status, 'Men’s basketball'), '2nd half · 2:10 remaining');
  assert.equal(gameStatus(status, 'Women’s basketball'), 'Q2 · 2:10 remaining');
  assert.equal(gameStatus({ ...status, period: 6 }, 'Football'), 'OT 2 · 2:10 remaining');
  assert.equal(gameStatus({ ...status, type: { ...status.type, detail: 'Top 7th' } }, 'Baseball'), 'Top 7th');
});

test('final visibility expires exactly two hours after completion, without resetting on reload', () => {
  const live = normalizeGame(event(), football, now - 30_000)!;
  const finished = normalizeGame(final(), football, now, live)!;
  assert.equal(finished.finishedAt, now);
  const restored = JSON.parse(JSON.stringify(finished));
  assert.equal(normalizeGame(final(), football, now + 7_199_999, restored)?.expiresAt, now + 7_200_000);
  assert.equal(normalizeGame(final(), football, now + 7_200_000, restored), undefined);
});

test('opening the dashboard does not resurrect old finals or infer a finish from kickoff', () => {
  assert.equal(normalizeGame(final(), football, now), undefined);
  assert.equal(normalizeGame(final(), football, now, undefined, now - 7_200_000), undefined);
  assert.equal(normalizeGame(final(), football, now, undefined, now + 1), undefined);
  assert.ok(normalizeGame(final(), football, now, undefined, now - 60_000));
  const staleLive = normalizeGame(event(), football, now - 420_000)!;
  assert.equal(normalizeGame(final(), football, now, staleLive), undefined);
});

test('uses only an explicit end-of-game wallclock, not modification or scoring timestamps', () => {
  assert.equal(completionTime({ plays: [{ text: 'Touchdown', wallclock: new Date(now).toISOString() }] }), undefined);
  assert.equal(completionTime({ drives: { previous: [{ plays: [
    { type: { text: 'End of Game' }, wallclock: new Date(now).toISOString(), modified: new Date(now + 5000).toISOString() },
  ] }] } }), now);
});

test('checks schedules once, shares requests, and refreshes simultaneous games every five minutes', async () => {
  let cache: BeaverCache = {};
  let time = now;
  let schedules = 0;
  let summaries = 0;
  let failed = false;
  const fetcher = (async (url: string) => {
    const game = event();
    if (url.includes('college-baseball')) game.competitions![0].competitors![0].team!.id = '113';
    if (url.includes('/schedule')) {
      schedules++;
      return new Response(JSON.stringify({ events: [game] }));
    }
    summaries++;
    if (failed) throw new Error('offline');
    return new Response(JSON.stringify({ header: { competitions: game.competitions } }));
  }) as typeof fetch;
  const service = createBeaversService(() => structuredClone(cache), (next) => { cache = next; }, fetcher, () => time);
  const [first, second] = await Promise.all([service(), service()]);
  assert.equal(schedules, 4);
  assert.equal(summaries, 4);
  assert.equal(first.games.length, 4);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.games.map((game) => game.id)).size, 4);
  assert.equal(first.nextCheckAt, now + GAME_REFRESH_MS);
  time += GAME_REFRESH_MS - 1;
  await service();
  assert.equal(summaries, 4);
  time++;
  await service();
  assert.equal(summaries, 8);
  assert.equal(schedules, 4);
  failed = true;
  time += GAME_REFRESH_MS;
  assert.equal((await service()).games.length, 4);
  time += 60_000;
  assert.equal((await service()).games.length, 0);
  assert.equal(summaries, 12);
  assert.equal(schedules, 4);
});

test('restores persisted finals after a server restart even if ESPN is unavailable', async () => {
  const finished = normalizeGame(final(), football, now, undefined, now - 60_000)!;
  let cache: BeaverCache = { [football.path]: { checkedAt: now - 60_000, games: [finished] } };
  let time = now;
  const fetcher = (async () => { throw new Error('offline'); }) as typeof fetch;
  const service = createBeaversService(() => structuredClone(cache), (next) => { cache = next; }, fetcher, () => time);
  assert.equal((await service()).games.length, 1);
  time = finished.expiresAt;
  assert.equal((await service()).games.length, 0);
});


test('baseball uses Oregon State’s baseball ID, not the football ID belonging to VCU', () => {
  assert.equal(normalizeGame(event(), beaverSports[1], now), undefined);
  const baseball = event();
  baseball.competitions![0].competitors![0].team!.id = '113';
  assert.ok(normalizeGame(baseball, beaverSports[1], now));
});


test('daily discovery waits for 6 a.m. Pacific and is not repeated after restart', async () => {
  let time = Date.parse('2026-10-19T12:59:59Z');
  let cache: BeaverCache = {};
  let calls = 0;
  const fetcher = (async () => { calls++; return new Response(JSON.stringify({ events: [] })); }) as typeof fetch;
  const makeService = () => createBeaversService(() => structuredClone(cache), (next) => { cache = next; }, fetcher, () => time);
  let service = makeService();
  assert.equal((await service()).nextCheckAt, Date.parse('2026-10-19T13:00:00Z'));
  assert.equal(calls, 0);
  time += 1000;
  assert.equal((await service()).games.length, 0);
  assert.equal(calls, 4);
  service = makeService();
  time += 8 * 60 * 60_000;
  assert.equal((await service()).nextCheckAt, Date.parse('2026-10-20T13:00:00Z'));
  assert.equal(calls, 4);
  time = Date.parse('2026-10-20T13:00:00Z');
  await service();
  assert.equal(calls, 8);
});

test('6 a.m. follows Pacific DST rather than a fixed 24-hour interval', () => {
  assert.equal(nextScheduleCheck(Date.parse('2026-03-07T14:00:00Z')), Date.parse('2026-03-08T13:00:00Z'));
  assert.equal(nextScheduleCheck(Date.parse('2026-10-31T13:00:00Z')), Date.parse('2026-11-01T14:00:00Z'));
});

test('waits until a scheduled start, stops updates after final, and keeps the final for two hours', async () => {
  let cache: BeaverCache = {};
  let time = Date.parse('2026-10-18T13:00:00Z');
  const start = Date.parse('2026-10-18T20:00:00Z');
  let summaries = 0;
  let finished = false;
  const fetcher = (async (url: string) => {
    const game = finished ? final() : event();
    game.date = new Date(start).toISOString();
    if (url.includes('/schedule')) return new Response(JSON.stringify({ events: url.includes('football') ? [game] : [] }));
    summaries++;
    return new Response(JSON.stringify({ header: { competitions: game.competitions } }));
  }) as typeof fetch;
  const service = createBeaversService(() => structuredClone(cache), (next) => { cache = next; }, fetcher, () => time);
  assert.equal((await service()).nextCheckAt, start);
  assert.equal(summaries, 0);
  time = start;
  assert.equal((await service()).games.length, 1);
  assert.equal(summaries, 1);
  time += GAME_REFRESH_MS;
  finished = true;
  const result = await service();
  assert.equal(result.games[0].completed, true);
  assert.equal(result.games[0].expiresAt, time + 7_200_000);
  time += GAME_REFRESH_MS;
  await service();
  assert.equal(summaries, 2);
  time = result.games[0].expiresAt;
  assert.equal((await service()).games.length, 0);
  assert.equal(summaries, 2);
});

test('failed schedule discovery is not retried that day', async () => {
  let cache: BeaverCache = {};
  let time = now;
  let calls = 0;
  const fetcher = (async () => { calls++; throw new Error('offline'); }) as typeof fetch;
  const service = createBeaversService(() => structuredClone(cache), (next) => { cache = next; }, fetcher, () => time);
  await service();
  time += GAME_REFRESH_MS;
  await service();
  assert.equal(calls, 4);
});
