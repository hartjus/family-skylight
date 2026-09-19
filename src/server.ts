import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { parseCalendarEvents, type ParsedCalendarEvent } from './ical.js';

type Row = Record<string, unknown>;

const root = process.cwd();
const dataDir = path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'family-skylight.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('oauth','public')),
    label TEXT NOT NULL, calendar_url TEXT, encrypted_tokens TEXT,
    last_sync_at TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS calendars (
    id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL, title TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#4c6ef5',
    enabled INTEGER NOT NULL DEFAULT 1, UNIQUE(source_id, external_id)
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY, calendar_id INTEGER NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL, title TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0, location TEXT, series_id TEXT, recurrence_id TEXT,
    UNIQUE(calendar_id, external_id)
  );
  CREATE INDEX IF NOT EXISTS events_by_start ON events(start_at);
  CREATE TABLE IF NOT EXISTS lists (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#40c057',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS list_items (
    id INTEGER PRIMARY KEY, list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    text TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
const eventColumns = new Set((db.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>).map(column => column.name));
if (!eventColumns.has('location')) db.exec('ALTER TABLE events ADD COLUMN location TEXT');
if (!eventColumns.has('series_id')) db.exec('ALTER TABLE events ADD COLUMN series_id TEXT');
if (!eventColumns.has('recurrence_id')) db.exec('ALTER TABLE events ADD COLUMN recurrence_id TEXT');

const app = Fastify({ logger: true });
await app.register(cors, { origin: process.env.NODE_ENV !== 'production' });

function isoNow() { return new Date().toISOString(); }
function asObject(value: unknown): Row { return (value ?? {}) as Row; }
function id(value: unknown) { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) throw new Error('Invalid id'); return parsed; }
function requiredText(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}
function setting(key: string, fallback: string) { return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value?: string } | undefined)?.value ?? fallback; }
function setSetting(key: string, value: string) { db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }
function deleteSetting(key: string) { db.prepare('DELETE FROM settings WHERE key=?').run(key); }
const screenRefreshOptions = [1, 5, 15, 30, 60];
function screenRefreshMinutes() {
  const value = Number(setting('screen_refresh_minutes', '5'));
  return screenRefreshOptions.includes(value) ? value : 5;
}
function serializeSettings() {
  return { theme: setting('theme', 'dark'), layout: JSON.parse(setting('dashboard_layout', '{}')), screenRefreshMinutes: screenRefreshMinutes(), weatherLocation: JSON.parse(setting('weather_location', 'null')) };
}
type WeatherLocation = { query: string; countryCode: string; name: string; latitude: number; longitude: number };
type WeatherForecast = { configured: true; location: WeatherLocation; fetchedAt: string; stale?: boolean; current: { temperature: number; weatherCode: number }; today: { high: number; low: number; precipitationChance: number; weatherCode: number }; daily: Array<{ date: string; high: number; low: number; precipitationChance: number; weatherCode: number }> };
function weatherLocation() { return JSON.parse(setting('weather_location', 'null')) as WeatherLocation | null; }
function weatherCache() { return JSON.parse(setting('weather_cache', 'null')) as WeatherForecast | null; }
let weatherRefreshInFlight: Promise<WeatherForecast> | undefined;
async function resolveWeatherLocation(query: string, countryCode: string): Promise<WeatherLocation> {
  const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json&countryCode=${encodeURIComponent(countryCode)}`);
  if (!response.ok) throw new Error('Could not look up that weather location');
  const result = await response.json() as { results?: Array<{ name: string; admin1?: string; country?: string; latitude: number; longitude: number }> };
  const match = result.results?.[0];
  if (!match) throw new Error('No weather location matched that postal code or city');
  return { query, countryCode, name: [match.name, match.admin1, match.country].filter(Boolean).join(', '), latitude: match.latitude, longitude: match.longitude };
}
async function refreshWeather(location: WeatherLocation): Promise<WeatherForecast> {
  const query = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), current: 'temperature_2m,weather_code', daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max', temperature_unit: 'fahrenheit', timezone: 'America/Los_Angeles', forecast_days: '7' });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`);
  if (!response.ok) throw new Error('Could not retrieve the weather forecast');
  const result = await response.json() as { current?: { temperature_2m: number; weather_code: number }; daily?: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] } };
  if (!result.current || !result.daily?.time?.length) throw new Error('Weather forecast response was incomplete');
  const daily = result.daily.time.map((date, index) => ({ date, weatherCode: result.daily!.weather_code[index], high: result.daily!.temperature_2m_max[index], low: result.daily!.temperature_2m_min[index], precipitationChance: result.daily!.precipitation_probability_max[index] }));
  return { configured: true, location, fetchedAt: isoNow(), current: { temperature: result.current.temperature_2m, weatherCode: result.current.weather_code }, today: { high: daily[0].high, low: daily[0].low, precipitationChance: daily[0].precipitationChance, weatherCode: daily[0].weatherCode }, daily };
}
async function weatherForecast() {
  const location = weatherLocation();
  if (!location) return { configured: false as const };
  const cached = weatherCache();
  if (cached && cached.location.latitude === location.latitude && cached.location.longitude === location.longitude && Date.now() - new Date(cached.fetchedAt).getTime() < 30 * 60_000) return cached;
  if (!weatherRefreshInFlight) weatherRefreshInFlight = refreshWeather(location).then(forecast => { setSetting('weather_cache', JSON.stringify(forecast)); return forecast; }).finally(() => { weatherRefreshInFlight = undefined; });
  try { return await weatherRefreshInFlight; }
  catch (error) { if (cached) return { ...cached, stale: true }; throw error; }
}
function pacificDateKey(value: Date | string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function pacificParts(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const part = (type: string) => Number(parts.find(item => item.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}
function pacificMidnight(year: number, month: number, day: number) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day));
  const offsetName = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'longOffset' }).formatToParts(utcGuess).find(item => item.type === 'timeZoneName')?.value ?? 'GMT-08:00';
  const offset = offsetName.match(/GMT([+-])(\d{2}):(\d{2})/);
  const minutes = offset ? (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === '+' ? 1 : -1) : -480;
  return new Date(utcGuess.getTime() - minutes * 60_000);
}
function recurrenceWindow(now = new Date()) {
  const current = pacificParts(now);
  const sixMonthsAgo = new Date(Date.UTC(current.year, current.month - 7, 1));
  const endParts = new Date(Date.UTC(current.year, current.month + 11, current.day));
  return { start: pacificMidnight(sixMonthsAgo.getUTCFullYear(), sixMonthsAgo.getUTCMonth() + 1, 1), end: pacificMidnight(endParts.getUTCFullYear(), endParts.getUTCMonth() + 1, endParts.getUTCDate()) };
}
function pacificWeekWindow(now = new Date()) {
  const parts = pacificParts(now);
  const today = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const sunday = new Date(today); sunday.setUTCDate(today.getUTCDate() - today.getUTCDay());
  const saturdayAfter = new Date(sunday); saturdayAfter.setUTCDate(sunday.getUTCDate() + 7);
  return { start: pacificMidnight(sunday.getUTCFullYear(), sunday.getUTCMonth() + 1, sunday.getUTCDate()), end: pacificMidnight(saturdayAfter.getUTCFullYear(), saturdayAfter.getUTCMonth() + 1, saturdayAfter.getUTCDate()) };
}
function pacificWeekWindowForDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('start must be a YYYY-MM-DD date');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3]) || date.getUTCDay() !== 0) throw new Error('start must be a valid Sunday');
  const end = new Date(date); end.setUTCDate(date.getUTCDate() + 7);
  return { start: pacificMidnight(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()), end: pacificMidnight(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate()) };
}
function fail(reply: { code: (n: number) => { send: (x: unknown) => unknown } }, error: unknown) {
  const message = error instanceof Error ? error.message : 'Unexpected error';
  return reply.code(message === 'Invalid id' ? 404 : 400).send({ error: message });
}

function encryptionKey() {
  const raw = process.env.SKYLIGHT_ENCRYPTION_KEY;
  if (!raw) throw new Error('SKYLIGHT_ENCRYPTION_KEY is required before adding a secret iCal URL');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('SKYLIGHT_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return key;
}
function encrypt(value: unknown) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const content = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), content: content.toString('base64') });
}
function decrypt(value: string) {
  const payload = JSON.parse(value) as { iv: string; tag: string; content: string };
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.content, 'base64')), decipher.final()]).toString('utf8'));
}
function secretGoogleIcalUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/(^|\.)google\.com$/.test(url.hostname) || !url.pathname.includes('/calendar/ical/')) throw new Error('Provide a valid HTTPS secret Google Calendar iCal URL');
  return url.toString();
}
// Upgrade the earlier MVP's plaintext public-feed URLs when a persistent key is configured.
if (process.env.SKYLIGHT_ENCRYPTION_KEY) {
  const legacySources = db.prepare("SELECT id, calendar_url FROM sources WHERE kind='public' AND calendar_url IS NOT NULL").all() as Array<{ id: number; calendar_url: string }>;
  for (const source of legacySources) db.prepare('UPDATE sources SET encrypted_tokens=?, calendar_url=NULL WHERE id=?').run(encrypt(source.calendar_url), source.id);
}
function serializeSources() {
  return db.prepare(`SELECT s.id, s.kind, s.label, s.last_sync_at AS lastSyncAt, s.last_error AS lastError,
    json_group_array(json_object('id', c.id, 'externalId', c.external_id, 'title', c.title, 'color', c.color, 'enabled', c.enabled)) AS calendars
    FROM sources s LEFT JOIN calendars c ON c.source_id=s.id GROUP BY s.id ORDER BY s.id DESC`).all().map((row: any) => ({ ...row, calendars: JSON.parse(row.calendars).filter((c: { id: number | null }) => c.id !== null).map((c: any) => ({ ...c, enabled: Boolean(c.enabled) })) }));
}
function eventRows(from: string, to: string) {
  return db.prepare(`SELECT e.id, e.title, e.location, e.start_at AS startAt, e.end_at AS endAt, e.all_day AS allDay, c.color, c.title AS calendarTitle
    FROM events e JOIN calendars c ON c.id=e.calendar_id WHERE c.enabled=1 AND e.end_at >= ? AND e.start_at < ? ORDER BY e.start_at`).all(from, to)
    .map((event: any) => ({ ...event, allDay: Boolean(event.allDay) }));
}
function replaceCalendarEvents(calendarId: number, events: ParsedCalendarEvent[]) {
  const upsert = db.prepare(`INSERT INTO events(calendar_id,external_id,series_id,recurrence_id,title,location,start_at,end_at,all_day) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(calendar_id,external_id) DO UPDATE SET series_id=excluded.series_id,recurrence_id=excluded.recurrence_id,title=excluded.title,location=excluded.location,start_at=excluded.start_at,end_at=excluded.end_at,all_day=excluded.all_day`);
  const tx = db.transaction(() => { db.prepare('DELETE FROM events WHERE calendar_id=?').run(calendarId); for (const event of events) upsert.run(calendarId, event.externalId, event.seriesId, event.recurrenceId, event.title, event.location, event.startAt, event.endAt, Number(event.allDay)); });
  tx();
}
async function syncSource(sourceId: number) {
  const source = db.prepare('SELECT * FROM sources WHERE id=?').get(sourceId) as any;
  if (!source) throw new Error('Source not found');
  try {
    if (source.kind !== 'public') throw new Error('OAuth sources are no longer supported. Remove this source and add its secret iCal URL instead.');
    const response = await fetch(decrypt(source.encrypted_tokens)); if (!response.ok) throw new Error(`Calendar request failed (${response.status})`);
    const calendar = db.prepare('SELECT id FROM calendars WHERE source_id=? LIMIT 1').get(sourceId) as { id: number } | undefined;
    if (!calendar) throw new Error('No calendar configured for this source');
    const window = recurrenceWindow();
    replaceCalendarEvents(calendar.id, parseCalendarEvents(await response.text(), window.start, window.end));
    db.prepare('UPDATE sources SET last_sync_at=?, last_error=NULL WHERE id=?').run(isoNow(), sourceId);
  } catch (error) { db.prepare('UPDATE sources SET last_error=? WHERE id=?').run(error instanceof Error ? error.message : 'Sync failed', sourceId); throw error; }
}

app.get('/api/health', async () => ({ ok: true }));
app.get('/api/settings', async () => serializeSettings());
app.patch('/api/settings', async (request, reply) => { try {
  const body = asObject(request.body);
  if (body.theme && !['light', 'dark'].includes(String(body.theme))) throw new Error('Theme must be light or dark');
  if (body.screenRefreshMinutes !== undefined) {
    const minutes = Number(body.screenRefreshMinutes);
    if (!Number.isInteger(minutes) || !screenRefreshOptions.includes(minutes)) throw new Error('Screen refresh interval must be 1, 5, 15, 30, or 60 minutes');
    setSetting('screen_refresh_minutes', String(minutes));
  }
  if (body.theme) setSetting('theme', String(body.theme));
  if (body.layout) setSetting('dashboard_layout', JSON.stringify(body.layout));
  return serializeSettings();
} catch (error) { return fail(reply, error); } });
app.post('/api/weather/location', async (request, reply) => { try {
  const body = asObject(request.body);
  const query = requiredText(body.query, 'Postal code or city');
  const countryCode = typeof body.countryCode === 'string' && /^[A-Za-z]{2}$/.test(body.countryCode.trim()) ? body.countryCode.trim().toUpperCase() : 'US';
  const location = await resolveWeatherLocation(query, countryCode);
  setSetting('weather_location', JSON.stringify(location));
  deleteSetting('weather_cache');
  return location;
} catch (error) { return fail(reply, error); } });
app.get('/api/weather', async (_request, reply) => { try { return await weatherForecast(); } catch (error) { return fail(reply, error); } });
app.get('/api/sources', async () => serializeSources());
app.post('/api/sources/ical', async (request, reply) => { try { const body = asObject(request.body); const url = secretGoogleIcalUrl(requiredText(body.url, 'Secret Google Calendar iCal URL')); const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : 'Google Calendar'; const result = db.prepare('INSERT INTO sources(kind,label,encrypted_tokens) VALUES(?,?,?)').run('public', label, encrypt(url)); db.prepare('INSERT INTO calendars(source_id,external_id,title,color) VALUES(?,?,?,?)').run(result.lastInsertRowid, `ical-${result.lastInsertRowid}`, label, '#4c6ef5'); await syncSource(Number(result.lastInsertRowid)); return reply.code(201).send(serializeSources().find((source: any) => source.id === result.lastInsertRowid)); } catch (error) { return fail(reply, error); } });
app.post('/api/sources/:id/sync', async (request, reply) => { try { await syncSource(id((request.params as Row).id)); return { ok: true }; } catch (error) { return fail(reply, error); } });
app.delete('/api/sources/:id', async (request, reply) => { try { const result = db.prepare('DELETE FROM sources WHERE id=?').run(id((request.params as Row).id)); if (!result.changes) throw new Error('Invalid id'); return reply.code(204).send(); } catch (error) { return fail(reply, error); } });
app.patch('/api/calendars/:id', async (request, reply) => { try { const calendarId = id((request.params as Row).id); const body = asObject(request.body); const result = db.prepare('UPDATE calendars SET color=COALESCE(?,color), enabled=COALESCE(?,enabled) WHERE id=?').run(typeof body.color === 'string' ? body.color : null, typeof body.enabled === 'boolean' ? Number(body.enabled) : null, calendarId); if (!result.changes) throw new Error('Invalid id'); if (body.enabled === true) { const calendar = db.prepare('SELECT source_id FROM calendars WHERE id=?').get(calendarId) as { source_id: number }; await syncSource(calendar.source_id); } return { ok: true }; } catch (error) { return fail(reply, error); } });
app.get('/api/lists', async () => db.prepare(`SELECT l.id,l.name,l.color,COALESCE(json_group_array(json_object('id',i.id,'text',i.text,'completed',i.completed,'createdAt',i.created_at)) FILTER (WHERE i.id IS NOT NULL), '[]') items FROM lists l LEFT JOIN list_items i ON i.list_id=l.id GROUP BY l.id ORDER BY l.id`).all().map((list: any) => ({ ...list, items: JSON.parse(list.items).map((item: any) => ({ ...item, completed: Boolean(item.completed) })) })));
app.post('/api/lists', async (request, reply) => { try { const body = asObject(request.body); const result = db.prepare('INSERT INTO lists(name,color) VALUES(?,?)').run(requiredText(body.name, 'List name'), typeof body.color === 'string' ? body.color : '#40c057'); return reply.code(201).send({ id: result.lastInsertRowid }); } catch (error) { return fail(reply, error); } });
app.patch('/api/lists/:id', async (request, reply) => { try { const body = asObject(request.body); const result = db.prepare('UPDATE lists SET name=COALESCE(?,name),color=COALESCE(?,color) WHERE id=?').run(typeof body.name === 'string' ? requiredText(body.name, 'List name') : null, typeof body.color === 'string' ? body.color : null, id((request.params as Row).id)); if (!result.changes) throw new Error('Invalid id'); return { ok: true }; } catch (error) { return fail(reply, error); } });
app.delete('/api/lists/:id', async (request, reply) => { try { const result = db.prepare('DELETE FROM lists WHERE id=?').run(id((request.params as Row).id)); if (!result.changes) throw new Error('Invalid id'); return reply.code(204).send(); } catch (error) { return fail(reply, error); } });
app.post('/api/lists/:id/items', async (request, reply) => { try { const result = db.prepare('INSERT INTO list_items(list_id,text) VALUES(?,?)').run(id((request.params as Row).id), requiredText(asObject(request.body).text, 'Item text')); return reply.code(201).send({ id: result.lastInsertRowid }); } catch (error) { return fail(reply, error); } });
app.patch('/api/items/:id', async (request, reply) => { try { const body = asObject(request.body); const result = db.prepare('UPDATE list_items SET text=COALESCE(?,text),completed=COALESCE(?,completed) WHERE id=?').run(typeof body.text === 'string' ? requiredText(body.text, 'Item text') : null, typeof body.completed === 'boolean' ? Number(body.completed) : null, id((request.params as Row).id)); if (!result.changes) throw new Error('Invalid id'); return { ok: true }; } catch (error) { return fail(reply, error); } });
app.delete('/api/items/:id', async (request, reply) => { try { const result = db.prepare('DELETE FROM list_items WHERE id=?').run(id((request.params as Row).id)); if (!result.changes) throw new Error('Invalid id'); return reply.code(204).send(); } catch (error) { return fail(reply, error); } });
app.get('/api/events', async (request, reply) => { try { const query = request.query as Row; const from = requiredText(query.from, 'from'); const to = requiredText(query.to, 'to'); return eventRows(from, to); } catch (error) { return fail(reply, error); } });
app.get('/api/weeks', async (request, reply) => { try { const window = pacificWeekWindowForDate(requiredText((request.query as Row).start, 'start')); return eventRows(window.start.toISOString(), window.end.toISOString()); } catch (error) { return fail(reply, error); } });
app.get('/api/dashboard', async () => { const now = new Date(); const today = pacificDateKey(now); const weekWindow = pacificWeekWindow(now); const week = eventRows(weekWindow.start.toISOString(), weekWindow.end.toISOString()); const nearbyEvents = eventRows(new Date(now.getTime() - 2 * 864e5).toISOString(), new Date(now.getTime() + 9 * 864e5).toISOString()); const lists = await app.inject({ method: 'GET', url: '/api/lists' }); return { today: nearbyEvents.filter(event => pacificDateKey(event.startAt) === today), upcoming: nearbyEvents.filter(event => { const eventDay = pacificDateKey(event.startAt); return eventDay > today && eventDay < pacificDateKey(weekWindow.end); }), week, lists: JSON.parse(lists.body), lastSyncAt: (db.prepare('SELECT MAX(last_sync_at) AS value FROM sources').get() as any).value, hasSyncError: Boolean((db.prepare('SELECT COUNT(*) AS count FROM sources WHERE last_error IS NOT NULL').get() as any).count) }; });

if (process.env.NODE_ENV === 'production' && fs.existsSync(path.join(root, 'dist'))) {
  await app.register(fastifyStatic, { root: path.join(root, 'dist'), wildcard: false });
  app.get('/*', (_request, reply) => reply.sendFile('index.html'));
}

setTimeout(() => { const run = () => Promise.allSettled((db.prepare('SELECT id FROM sources').all() as Array<{ id: number }>).map(source => syncSource(source.id))); void run(); setInterval(run, 60 * 60 * 1000); }, 5_000);
await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
