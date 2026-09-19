import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './styles.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, AppShell, Badge, Box, Burger, Button, Card, Checkbox, ColorInput, Container, Group, Loader, MantineProvider, Modal, NavLink, Paper, Select, SimpleGrid, Stack, Switch, Text, TextInput, ThemeIcon, Title, Tooltip, UnstyledButton } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IconArrowsHorizontal, IconCalendarMonth, IconChevronLeft, IconChevronRight, IconCloud, IconCloudFog, IconCloudRain, IconCloudSnow, IconCloudStorm, IconGripVertical, IconLayoutDashboard, IconListCheck, IconMoon, IconPlus, IconRefresh, IconSettings, IconSun, IconSunHigh, IconTrash, IconX } from '@tabler/icons-react';

type Event = { id: number; title: string; location: string | null; startAt: string; endAt: string; allDay: boolean; color: string; calendarTitle: string };
type Item = { id: number; text: string; completed: boolean };
type List = { id: number; name: string; color: string; items: Item[] };
type Calendar = { id: number; externalId: string; title: string; color: string; enabled: boolean };
type Source = { id: number; kind: 'public'; label: string; lastSyncAt?: string; lastError?: string; calendars: Calendar[] };
type Layout = Record<string, { order: number; span: number }>;
type DashboardTile = { key: string; title: string; color?: string; content: React.ReactNode; actions?: React.ReactNode };
type WeatherLocation = { query: string; countryCode: string; name: string; latitude: number; longitude: number };
type WeatherForecast = { configured: true; location: WeatherLocation; fetchedAt: string; stale?: boolean; current: { temperature: number; weatherCode: number }; today: { high: number; low: number; precipitationChance: number; weatherCode: number }; daily: Array<{ date: string; high: number; low: number; precipitationChance: number; weatherCode: number }> };
type WeatherResponse = WeatherForecast | { configured: false };
type Settings = { theme: 'light' | 'dark'; layout: Layout; screenRefreshMinutes: number; weatherLocation: WeatherLocation | null };

const colors = ['#4c6ef5', '#e8590c', '#40c057', '#be4bdb', '#0ca678', '#f08c00'];
const api = async <T,>(url: string, init?: RequestInit): Promise<T> => { const headers = new Headers(init?.headers); if (init?.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json'); const result = await fetch(`/api${url}`, { ...init, headers }); if (!result.ok) throw new Error((await result.json().catch(() => ({})) as { error?: string }).error ?? 'Request failed'); return result.status === 204 ? undefined as T : result.json(); };
const pacificDateKey = (value: Date | string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const pacificDayNumber = (value: Date | string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (type: string) => Number(parts.find(item => item.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'));
};
const pacificIsoDate = (value: Date | string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const endsAtPacificMidnight = (value: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const part = (type: string) => Number(parts.find(item => item.type === type)?.value);
  return part('hour') === 0 && part('minute') === 0 && part('second') === 0;
};
const occursOnPacificDay = (event: Event, day: Date) => {
  const dayNumber = pacificDayNumber(day);
  const startDay = pacificDayNumber(event.startAt);
  const endDay = pacificDayNumber(event.endAt);
  if (event.allDay) return startDay <= dayNumber && dayNumber < endDay;
  const finalDay = endsAtPacificMidnight(event.endAt) ? endDay - 864e5 : endDay;
  return startDay <= dayNumber && dayNumber <= finalDay;
};
const localDate = (value: string) => new Date(value).toLocaleDateString(undefined, { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' });
const eventTime = (event: Event) => event.allDay ? 'All day' : new Date(event.startAt).toLocaleTimeString([], { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const pacificDateTime = (value: string) => new Date(value).toLocaleString([], { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
function usePacificNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval: number | undefined;
    const start = window.setTimeout(() => { setNow(new Date()); interval = window.setInterval(() => setNow(new Date()), 60_000); }, 60_000 - (Date.now() % 60_000) + 20);
    return () => { window.clearTimeout(start); if (interval !== undefined) window.clearInterval(interval); };
  }, []);
  return now;
}
function pacificHour(value: Date) { return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }).format(value)); }
function dashboardClock(value: Date) { return `${value.toLocaleDateString(undefined, { timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric' })} ${value.toLocaleTimeString([], { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' })}`; }
function useRequest<T>(url: string, refreshMinutes?: number, silentErrors = false) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const requestInFlight = useRef<Promise<void> | null>(null);
  const load = useCallback((showLoading = true) => {
    if (requestInFlight.current) return requestInFlight.current;
    const request = (async () => {
      if (showLoading) setLoading(true);
      try { setData(await api<T>(url)); }
      catch (error) { if (!silentErrors) notifications.show({ color: 'red', message: error instanceof Error ? error.message : 'Could not load data' }); }
      finally { if (showLoading) setLoading(false); requestInFlight.current = null; }
    })();
    requestInFlight.current = request;
    return request;
  }, [url, silentErrors]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!refreshMinutes) return;
    let cancelled = false;
    let timer: number | undefined;
    const schedule = (minutes: number) => {
      timer = window.setTimeout(async () => {
        let nextMinutes = minutes;
        try { nextMinutes = (await api<Settings>('/settings')).screenRefreshMinutes; } catch { /* Keep the existing cadence when settings cannot be read. */ }
        await load(false);
        if (!cancelled) schedule(nextMinutes);
      }, minutes * 60_000);
    };
    schedule(refreshMinutes);
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [load, refreshMinutes]);
  return { data, loading, reload: load };
}

const isPastEvent = (event: Event) => !event.allDay && new Date(event.endAt).getTime() < Date.now();
function EventLine({ event, showDate = false, onOpen }: { event: Event; showDate?: boolean; onOpen: (event: Event) => void }) { const isPast = isPastEvent(event); return <UnstyledButton className={`event-line event-card ${isPast ? 'past-event' : ''}`} style={{ backgroundColor: `${event.color}${isPast ? '12' : '24'}`, borderLeftColor: `${event.color}${isPast ? '80' : ''}` }} onClick={() => onOpen(event)}><Text size="sm" fw={600} lineClamp={1}>{event.title}</Text><Text size="xs" c="dimmed">{showDate && `${localDate(event.startAt)} · `}{eventTime(event)}</Text>{event.location && <Text size="xs" c="dimmed" lineClamp={1}>{event.location}</Text>}</UnstyledButton>; }
function EventDetailModal({ event, onClose }: { event: Event | null; onClose: () => void }) { return <Modal opened={Boolean(event)} onClose={onClose} title="Event details" centered>{event && <Stack gap="md"><Box className="event-detail-accent" style={{ background: event.color }} /><Box><Title order={2}>{event.title}</Title><Text c="dimmed">{event.calendarTitle}</Text></Box><Box><Text fw={600}>When</Text><Text>{event.allDay ? `${localDate(event.startAt)} · All day` : `${pacificDateTime(event.startAt)} – ${new Date(event.endAt).toLocaleTimeString([], { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}`}</Text></Box>{event.location && <Box><Text fw={600}>Location</Text><Text>{event.location}</Text></Box>}</Stack>}</Modal>; }
function Empty({ children }: { children: React.ReactNode }) { return <Text c="dimmed" size="sm" py="md">{children}</Text>; }
function weatherCondition(code: number) {
  if (code === 0 || code === 1) return { label: 'Sunny', Icon: IconSun };
  if (code === 2) return { label: 'Partly cloudy', Icon: IconSunHigh };
  if (code === 3) return { label: 'Cloudy', Icon: IconCloud };
  if (code === 45 || code === 48) return { label: 'Foggy', Icon: IconCloudFog };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { label: 'Rain', Icon: IconCloudRain };
  if (code >= 71 && code <= 77) return { label: 'Snow', Icon: IconCloudSnow };
  if (code >= 95) return { label: 'Thunderstorms', Icon: IconCloudStorm };
  return { label: 'Conditions unavailable', Icon: IconCloud };
}
const fahrenheit = (value: number) => `${Math.round(value)}°F`;
function WeatherToday({ weather }: { weather: WeatherResponse | undefined }) {
  if (!weather) return <Text c="dimmed" size="sm">Loading weather…</Text>;
  if (!weather.configured) return <Text c="dimmed" size="sm">Set a weather location in Administration to show today’s forecast.</Text>;
  const { Icon, label } = weatherCondition(weather.current.weatherCode);
  return <Group className="weather-today" gap="sm" wrap="nowrap"><Icon size={42} stroke={1.6} aria-label={label} /><Box><Group gap="xs"><Text fw={700} size="xl">{fahrenheit(weather.current.temperature)}</Text><Text size="sm">{label}</Text></Group><Text size="xs" c="dimmed">High {fahrenheit(weather.today.high)} · Low {fahrenheit(weather.today.low)} · {weather.today.precipitationChance}% precipitation</Text><Text size="xs" c="dimmed">{weather.location.name}{weather.stale ? ' · Showing saved forecast' : ''}</Text></Box></Group>;
}
function WeatherWeek({ weather }: { weather: WeatherForecast }) { return <div className="weather-week">{weather.daily.map(day => { const { Icon, label } = weatherCondition(day.weatherCode); return <Stack key={day.date} className="weather-day" gap={2} align="center"><Text size="xs" fw={700}>{new Date(`${day.date}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short' })}</Text><Icon size={30} stroke={1.6} aria-label={label} /><Text size="xs" fw={600}>{fahrenheit(day.high)}</Text><Text size="xs" c="dimmed">{fahrenheit(day.low)}</Text><Text size="xs" c="dimmed">{day.precipitationChance}%</Text></Stack>; })}</div>; }
function currentPacificWeek() { const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const part = (type: string) => Number(parts.find(item => item.type === type)?.value); const today = new Date(Date.UTC(part('year'), part('month') - 1, part('day'), 12)); const sunday = new Date(today); sunday.setUTCDate(today.getUTCDate() - today.getUTCDay()); return Array.from({ length: 7 }, (_, index) => new Date(sunday.getTime() + index * 864e5)); }
function WeekPanel({ events, weekStart, onOpenEvent }: { events: Event[]; weekStart: Date; onOpenEvent: (event: Event) => void }) { const days = Array.from({ length: 7 }, (_, index) => new Date(weekStart.getTime() + index * 864e5)); return <div className="week-panel">{days.map(day => { const dayKey = pacificDateKey(day); const dayEvents = events.filter(event => occursOnPacificDay(event, day)); return <Box key={dayKey} className={`week-day ${dayKey === pacificDateKey(new Date()) ? 'week-day-today' : ''}`}><Text size="xs" fw={700} tt="uppercase">{day.toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short' })}</Text><Text size="sm" fw={700} mb="xs">{day.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'numeric', day: 'numeric' })}</Text><Stack gap={4}>{dayEvents.length ? dayEvents.map(event => <EventLine key={`${event.id}-${dayKey}`} event={event} onOpen={onOpenEvent} />) : <Text size="xs" c="dimmed">—</Text>}</Stack></Box>; })}</div>; }

function ResizeGrip({ tile, span, onResize }: { tile: DashboardTile; span: number; onResize: (span: number) => void }) {
  const startX = useRef<number | undefined>(undefined);
  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    startX.current = event.clientX;
    const finish = (endEvent: PointerEvent) => {
      const distance = endEvent.clientX - (startX.current ?? endEvent.clientX);
      if (Math.abs(distance) >= 20) onResize(distance > 0 ? 2 : 1);
      window.removeEventListener('pointerup', finish);
    };
    window.addEventListener('pointerup', finish, { once: true });
  };
  return <ActionIcon className="tile-resize-grip" variant="subtle" onPointerDown={onPointerDown} aria-label={`Drag to resize ${tile.title}; currently ${span === 2 ? 'wide' : 'half width'}`}><IconArrowsHorizontal size={18} /></ActionIcon>;
}

function SortableDashboardTile({ tile, span, editing, onResize }: { tile: DashboardTile; span: number; editing: boolean; onResize: (span: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tile.key, disabled: !editing });
  return <Card ref={setNodeRef} className={`dashboard-tile ${isDragging ? 'dashboard-tile-dragging' : ''}`} style={{ gridColumn: `span ${tile.key === 'week' ? 2 : span}`, transform: CSS.Transform.toString(transform), transition }} withBorder>
    <Group justify="space-between" mb="sm">
      <Group gap="xs">{tile.color && <Box className="event-dot" style={{ background: tile.color }} />}<Title order={3}>{tile.title}</Title></Group>
      <Group gap="xs">
        {tile.actions}
        {editing && <Group gap={2}>
          <ActionIcon className="tile-drag-grip" variant="subtle" {...attributes} {...listeners} aria-label={`Drag ${tile.title} tile`}><IconGripVertical size={20} /></ActionIcon>
          {tile.key !== 'week' && <ResizeGrip tile={tile} span={span} onResize={onResize} />}
        </Group>}
      </Group>
    </Group>
    <Stack gap="xs">{tile.content}</Stack>
  </Card>;
}

function Dashboard({ layout, refreshMinutes, saveLayout, onOpenEvent }: { layout: Layout; refreshMinutes: number; saveLayout: (layout: Layout) => Promise<void>; onOpenEvent: (event: Event) => void }) {
  const { data, loading, reload } = useRequest<{ today: Event[]; upcoming: Event[]; week: Event[]; lists: List[]; lastSyncAt?: string; hasSyncError: boolean }>('/dashboard', refreshMinutes);
  const now = usePacificNow();
  const greeting = pacificHour(now) >= 18 ? 'evening' : pacificHour(now) < 12 ? 'morning' : 'afternoon';
  const [weekStart, setWeekStart] = useState(() => currentPacificWeek()[0]);
  const weekStartKey = pacificIsoDate(weekStart);
  const currentWeekStartKey = pacificIsoDate(currentPacificWeek()[0]);
  const { data: weekEvents = [] } = useRequest<Event[]>(`/weeks?start=${encodeURIComponent(weekStartKey)}`, refreshMinutes);
  const { data: weather } = useRequest<WeatherResponse>('/weather', refreshMinutes, true);
  const [editing, setEditing] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const shiftWeek = (amount: number) => setWeekStart(start => new Date(start.getTime() + amount * 7 * 864e5));
  const tiles: DashboardTile[] = useMemo(() => [{ key: 'week', title: 'This week', actions: <Group gap={4}><Button size="compact-xs" variant="default" onClick={() => shiftWeek(-1)}>Prev</Button><Button size="compact-xs" variant="light" disabled={weekStartKey === currentWeekStartKey} onClick={() => setWeekStart(currentPacificWeek()[0])}>Current</Button><Button size="compact-xs" variant="default" onClick={() => shiftWeek(1)}>Next</Button></Group>, content: <WeekPanel events={weekEvents} weekStart={weekStart} onOpenEvent={onOpenEvent} /> }, { key: 'today', title: 'Today', content: <><WeatherToday weather={weather} />{data?.today.length ? data.today.map(e => <EventLine key={e.id} event={e} onOpen={onOpenEvent} />) : <Empty>No events today.</Empty>}</> }, ...(weather?.configured ? [{ key: 'weather-week', title: 'Weekly forecast', content: <><WeatherWeek weather={weather} /><Text component="a" href="https://open-meteo.com/" target="_blank" size="xs" c="dimmed">Weather data by Open-Meteo.com</Text></> }] : []), { key: 'upcoming', title: 'Coming up', content: data?.upcoming.length ? data.upcoming.map(e => <EventLine key={e.id} event={e} showDate onOpen={onOpenEvent} />) : <Empty>No upcoming events this week.</Empty> }, ...((data?.lists ?? []).map(list => ({ key: `list-${list.id}`, title: list.name, color: list.color, content: list.items.length ? list.items.slice(0, 6).map(item => <Text key={item.id} size="sm" td={item.completed ? 'line-through' : undefined} c={item.completed ? 'dimmed' : undefined}>• {item.text}</Text>) : <Empty>No items yet.</Empty> })))], [data, onOpenEvent, weather, weekEvents, weekStart, weekStartKey, currentWeekStartKey]);
  const ordered = [...tiles].sort((a, b) => (layout[a.key]?.order ?? 99) - (layout[b.key]?.order ?? 99));
  const persistLayout = (next: Layout) => { void saveLayout(next).catch(error => notifications.show({ color: 'red', message: error instanceof Error ? error.message : 'Could not save dashboard layout' })); };
  const saveSpan = (key: string, span: number) => {
    const next = { ...layout, [key]: { order: layout[key]?.order ?? ordered.findIndex(tile => tile.key === key), span } };
    persistLayout(next);
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const oldIndex = ordered.findIndex(tile => tile.key === active.id);
    const newIndex = ordered.findIndex(tile => tile.key === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = [...ordered];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    const next = { ...layout };
    reordered.forEach((tile, index) => { next[tile.key] = { order: index, span: tile.key === 'week' ? 2 : layout[tile.key]?.span ?? 1 }; });
    persistLayout(next);
  };
  if (loading) return <Loader />;
  return <Stack gap="lg"><Group justify="space-between"><Box><Group gap="sm" align="baseline"><Title order={1}>Good {greeting}</Title><Text c="dimmed">{dashboardClock(now)}</Text></Group><Text c={data?.hasSyncError ? 'red' : 'dimmed'} size="sm">{data?.hasSyncError ? 'Some calendars could not sync. Showing saved events.' : data?.lastSyncAt ? `Last synced ${pacificDateTime(data.lastSyncAt)}` : 'No calendars connected yet.'}</Text></Box><Group><Button variant={editing ? 'filled' : 'light'} onClick={() => setEditing(!editing)}>{editing ? 'Done arranging' : 'Arrange tiles'}</Button><ActionIcon variant="light" size="lg" onClick={() => void reload()} aria-label="Refresh dashboard"><IconRefresh /></ActionIcon></Group></Group><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}><SortableContext items={ordered.map(tile => tile.key)} strategy={rectSortingStrategy}><div className="masonry">{ordered.map(tile => <SortableDashboardTile key={tile.key} tile={tile} span={tile.key === 'week' ? 2 : layout[tile.key]?.span ?? (tile.key === 'weather-week' ? 2 : 1)} editing={editing} onResize={span => saveSpan(tile.key, span)} />)}</div></SortableContext></DndContext></Stack>;
}

function CalendarPage({ refreshMinutes, onOpenEvent }: { refreshMinutes: number; onOpenEvent: (event: Event) => void }) {
  const current = new Date();
  const [month, setMonth] = useState({ year: current.getFullYear(), index: current.getMonth() });
  const rangeStart = new Date(Date.UTC(month.year, month.index, 1));
  const rangeEnd = new Date(Date.UTC(month.year, month.index + 1, 2));
  const { data: events = [], loading } = useRequest<Event[]>(`/events?from=${encodeURIComponent(rangeStart.toISOString())}&to=${encodeURIComponent(rangeEnd.toISOString())}`, refreshMinutes);
  const first = new Date(Date.UTC(month.year, month.index, 1, 12));
  const cells = Array.from({ length: 42 }, (_, index) => new Date(Date.UTC(month.year, month.index, 1 - first.getUTCDay() + index, 12)));
  const shiftMonth = (amount: number) => { const next = new Date(Date.UTC(month.year, month.index + amount, 1)); setMonth({ year: next.getUTCFullYear(), index: next.getUTCMonth() }); };
  return <Stack gap="lg"><Group justify="space-between"><ActionIcon size="xl" variant="light" onClick={() => shiftMonth(-1)}><IconChevronLeft /></ActionIcon><Title order={1}>{first.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'long', year: 'numeric' })}</Title><ActionIcon size="xl" variant="light" onClick={() => shiftMonth(1)}><IconChevronRight /></ActionIcon></Group>{loading ? <Loader /> : <div className="calendar-grid">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => <Text key={day} className="weekday" fw={700}>{day}</Text>)}{cells.map(day => { const dayKey = pacificDateKey(day); const inMonth = day.getUTCMonth() === month.index; const dayEvents = events.filter(event => occursOnPacificDay(event, day)); return <Paper key={day.toISOString()} withBorder className={`calendar-day ${inMonth ? '' : 'outside-month'}`}><Text fw={700} c={dayKey === pacificDateKey(new Date()) ? 'blue' : undefined}>{day.getUTCDate()}</Text>{dayEvents.slice(0, 4).map(event => { const isPast = isPastEvent(event); return <UnstyledButton key={`${event.id}-${dayKey}`} className={`month-event ${isPast ? 'past-event' : ''}`} style={{ backgroundColor: `${event.color}${isPast ? '12' : '24'}`, borderLeftColor: `${event.color}${isPast ? '80' : ''}` }} onClick={() => onOpenEvent(event)}><Text size="xs" lineClamp={1}>{event.allDay ? '' : `${eventTime(event)} `}{event.title}</Text>{event.location && <Text size="xs" c="dimmed" lineClamp={1}>{event.location}</Text>}</UnstyledButton>; })}</Paper>; })}</div>}</Stack>;
}

function ListsPage() { const { data: lists = [], loading, reload } = useRequest<List[]>('/lists'); const [newItems, setNewItems] = useState<Record<number, string>>({}); const change = async (action: () => Promise<unknown>) => { try { await action(); await reload(); } catch (error) { notifications.show({ color: 'red', message: error instanceof Error ? error.message : 'Could not save' }); } }; if (loading) return <Loader />; return <Stack gap="lg"><Group justify="space-between"><Box><Title order={1}>Shared lists</Title><Text c="dimmed">Keep household tasks in one place.</Text></Box></Group>{lists.length === 0 && <Empty>Create a list from Administration to get started.</Empty>}<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>{lists.map(list => <Card key={list.id} withBorder><Group justify="space-between" mb="sm"><Group><Box className="event-dot" style={{ background: list.color }} /><Title order={3}>{list.name}</Title></Group><Badge color="gray">{list.items.filter(item => !item.completed).length}</Badge></Group><Stack gap="xs">{list.items.map(item => <Group key={item.id} wrap="nowrap"><Checkbox checked={item.completed} onChange={event => void change(() => api(`/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ completed: event.currentTarget.checked }) }))} aria-label={`Mark ${item.text} complete`} /><TextInput className="item-input" variant="unstyled" defaultValue={item.text} onBlur={event => { if (event.currentTarget.value !== item.text) void change(() => api(`/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ text: event.currentTarget.value }) })); }} styles={{ input: { textDecoration: item.completed ? 'line-through' : undefined, color: item.completed ? 'var(--mantine-color-dimmed)' : undefined } }} /><ActionIcon color="red" variant="subtle" onClick={() => void change(() => api(`/items/${item.id}`, { method: 'DELETE' }))}><IconX size={17} /></ActionIcon></Group>)}<Group wrap="nowrap" mt="xs"><TextInput placeholder="Add an item" value={newItems[list.id] ?? ''} onChange={event => setNewItems({ ...newItems, [list.id]: event.currentTarget.value })} onKeyDown={event => { if (event.key === 'Enter' && newItems[list.id]?.trim()) void change(async () => { await api(`/lists/${list.id}/items`, { method: 'POST', body: JSON.stringify({ text: newItems[list.id] }) }); setNewItems({ ...newItems, [list.id]: '' }); }); }} /><ActionIcon size="lg" color="blue" onClick={() => { if (newItems[list.id]?.trim()) void change(async () => { await api(`/lists/${list.id}/items`, { method: 'POST', body: JSON.stringify({ text: newItems[list.id] }) }); setNewItems({ ...newItems, [list.id]: '' }); }); }}><IconPlus /></ActionIcon></Group></Stack></Card>)}</SimpleGrid></Stack>; }

function AdminPage({ refreshMinutes, saveRefreshMinutes, weatherLocation, saveWeatherLocation }: { refreshMinutes: number; saveRefreshMinutes: (minutes: number) => Promise<void>; weatherLocation: WeatherLocation | null; saveWeatherLocation: (query: string, countryCode: string) => Promise<void> }) { const { data: sources = [], reload: reloadSources } = useRequest<Source[]>('/sources'); const { data: lists = [], reload: reloadLists } = useRequest<List[]>('/lists'); const [url, setUrl] = useState(''); const [label, setLabel] = useState(''); const [listName, setListName] = useState(''); const [listColor, setListColor] = useState(colors[2]); const [weatherQuery, setWeatherQuery] = useState(weatherLocation?.query ?? ''); const [weatherCountryCode, setWeatherCountryCode] = useState(weatherLocation?.countryCode ?? 'US'); const [confirm, setConfirm] = useState<List>(); const toast = async (action: () => Promise<unknown>, reload: () => Promise<void>) => { try { await action(); await reload(); } catch (error) { notifications.show({ color: 'red', message: error instanceof Error ? error.message : 'Could not save' }); } };
  const updateRefreshMinutes = async (value: string | null) => { if (!value) return; try { await saveRefreshMinutes(Number(value)); } catch (error) { notifications.show({ color: 'red', message: error instanceof Error ? error.message : 'Could not save refresh interval' }); } };
  const updateWeatherLocation = async () => { try { await saveWeatherLocation(weatherQuery, weatherCountryCode); } catch (error) { notifications.show({ color: 'red', message: error instanceof Error ? error.message : 'Could not save weather location' }); } };
  return <Stack gap="xl"><Box><Title order={1}>Administration</Title><Text c="dimmed">Manage the calendars and shared lists shown at home.</Text></Box><Card withBorder><Title order={3} mb="sm">Display refresh</Title><Select label="Dashboard and Calendar refresh interval" description="Re-reads saved data from this device. Google Calendar syncs separately each hour." data={['1', '5', '15', '30', '60'].map(value => ({ value, label: `${value} minute${value === '1' ? '' : 's'}` }))} value={String(refreshMinutes)} onChange={value => void updateRefreshMinutes(value)} w={280} /></Card><Card withBorder><Title order={3} mb="sm">Weather</Title><Stack gap="sm"><Text size="sm" c="dimmed">Set the household location for the Open-Meteo forecast. Weather data is refreshed on the server and shown in Fahrenheit.</Text><Group align="end"><TextInput label="Postal / ZIP code or city" placeholder="97501 or Portland" value={weatherQuery} onChange={event => setWeatherQuery(event.currentTarget.value)} style={{ flex: 1 }} /><TextInput label="Country code" description="ISO 2-letter code" value={weatherCountryCode} onChange={event => setWeatherCountryCode(event.currentTarget.value.toUpperCase())} w={150} maxLength={2} /><Button onClick={() => void updateWeatherLocation()}>Save location</Button></Group>{weatherLocation && <Text size="xs" c="dimmed">Current location: {weatherLocation.name}</Text>}<Text size="xs" c="dimmed">Weather data by Open-Meteo.com</Text></Stack></Card><Card withBorder><Title order={3} mb="sm">Google Calendar iCal feeds</Title><Stack><Text size="sm" c="dimmed">Paste each calendar’s Secret address in iCal format. It is encrypted when saved and never shown again.</Text><Group align="end"><TextInput label="Secret Google Calendar iCal URL" placeholder="https://calendar.google.com/calendar/ical/.../basic.ics" value={url} onChange={event => setUrl(event.currentTarget.value)} style={{ flex: 1 }} /><TextInput label="Name (optional)" value={label} onChange={event => setLabel(event.currentTarget.value)} /><Button onClick={() => void toast(async () => { await api('/sources/ical', { method: 'POST', body: JSON.stringify({ url, label }) }); setUrl(''); setLabel(''); }, reloadSources)}>Add calendar</Button></Group>{sources.map(source => <Paper key={source.id} p="sm" withBorder><Group justify="space-between"><Box><Text fw={600}>{source.label}</Text><Text size="xs" c={source.lastError ? 'red' : 'dimmed'}>{source.lastError ? `Sync error: ${source.lastError}` : source.lastSyncAt ? `Last synced ${new Date(source.lastSyncAt).toLocaleString()}` : 'Not yet synced'}</Text></Box><Group><ActionIcon variant="light" onClick={() => void toast(() => api(`/sources/${source.id}/sync`, { method: 'POST' }), reloadSources)}><IconRefresh size={18} /></ActionIcon><ActionIcon color="red" variant="subtle" onClick={() => { if (window.confirm(`Remove ${source.label} and its imported events?`)) void toast(() => api(`/sources/${source.id}`, { method: 'DELETE' }), reloadSources); }}><IconTrash size={18} /></ActionIcon></Group></Group><Stack mt="sm">{source.calendars.map(calendar => <Group key={calendar.id} justify="space-between"><Switch checked={calendar.enabled} label={calendar.title} onChange={event => void toast(() => api(`/calendars/${calendar.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: event.currentTarget.checked }) }), reloadSources)} /><ColorInput value={calendar.color} onChange={color => void toast(() => api(`/calendars/${calendar.id}`, { method: 'PATCH', body: JSON.stringify({ color }) }), reloadSources)} swatches={colors} w={150} /></Group>)}</Stack></Paper>)}</Stack></Card><Card withBorder><Title order={3} mb="sm">Shared lists</Title><Group align="end"><TextInput label="List name" value={listName} onChange={event => setListName(event.currentTarget.value)} style={{ flex: 1 }} /><ColorInput label="Color" value={listColor} onChange={setListColor} swatches={colors} /><Button onClick={() => void toast(async () => { await api('/lists', { method: 'POST', body: JSON.stringify({ name: listName, color: listColor }) }); setListName(''); }, reloadLists)}>Create list</Button></Group><Stack mt="md">{lists.map(list => <Group key={list.id} justify="space-between"><Group><Box className="event-dot" style={{ background: list.color }} /><Text>{list.name}</Text></Group><ActionIcon color="red" variant="subtle" onClick={() => setConfirm(list)}><IconTrash /></ActionIcon></Group>)}</Stack></Card><Modal opened={Boolean(confirm)} onClose={() => setConfirm(undefined)} title="Delete shared list"><Text>Delete “{confirm?.name}” and all its items permanently?</Text><Group justify="end" mt="lg"><Button variant="default" onClick={() => setConfirm(undefined)}>Cancel</Button><Button color="red" onClick={() => { if (confirm) void toast(async () => { await api(`/lists/${confirm.id}`, { method: 'DELETE' }); setConfirm(undefined); }, reloadLists); }}>Delete list</Button></Group></Modal></Stack>; }

function App() {
  const { data: settings, loading, reload } = useRequest<Settings>('/settings');
  const [page, setPage] = useState('dashboard');
  const [menuCollapsed, setMenuCollapsed] = useState(false);
  const [mobileMenuOpened, setMobileMenuOpened] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const saveLayout = async (layout: Layout) => { await api('/settings', { method: 'PATCH', body: JSON.stringify({ layout }) }); await reload(); };
  const toggleTheme = async () => { await api('/settings', { method: 'PATCH', body: JSON.stringify({ theme: settings?.theme === 'dark' ? 'light' : 'dark' }) }); await reload(); };
  const saveRefreshMinutes = async (screenRefreshMinutes: number) => { await api('/settings', { method: 'PATCH', body: JSON.stringify({ screenRefreshMinutes }) }); await reload(); };
  const saveWeatherLocation = async (query: string, countryCode: string) => { await api('/weather/location', { method: 'POST', body: JSON.stringify({ query, countryCode }) }); await reload(); };
  if (loading || !settings) return <MantineProvider><Container py="xl"><Loader /></Container></MantineProvider>;
  const pages: Record<string, React.ReactNode> = { dashboard: <Dashboard layout={settings.layout} refreshMinutes={settings.screenRefreshMinutes} saveLayout={saveLayout} onOpenEvent={setSelectedEvent} />, calendar: <CalendarPage refreshMinutes={settings.screenRefreshMinutes} onOpenEvent={setSelectedEvent} />, lists: <ListsPage />, admin: <AdminPage refreshMinutes={settings.screenRefreshMinutes} saveRefreshMinutes={saveRefreshMinutes} weatherLocation={settings.weatherLocation} saveWeatherLocation={saveWeatherLocation} /> };
  const navigation = [{ key: 'dashboard', label: 'Dashboard', icon: IconLayoutDashboard }, { key: 'calendar', label: 'Calendar', icon: IconCalendarMonth }, { key: 'lists', label: 'Shared lists', icon: IconListCheck }, { key: 'admin', label: 'Admin', icon: IconSettings }];
  return <MantineProvider forceColorScheme={settings.theme} theme={{ primaryColor: 'indigo', defaultRadius: 'md' }}>
    <Notifications />
    <AppShell header={{ height: { base: 56, sm: 0 } }} navbar={{ width: menuCollapsed ? 72 : 220, breakpoint: 'sm', collapsed: { mobile: !mobileMenuOpened } }} padding="md">
      <AppShell.Header hiddenFrom="sm"><Group h="100%" px="md" justify="space-between"><Group gap="sm"><Burger opened={mobileMenuOpened} onClick={() => setMobileMenuOpened(opened => !opened)} aria-label={mobileMenuOpened ? 'Close menu' : 'Open menu'} /><ThemeIcon size="md" radius="xl"><IconCalendarMonth size={18} /></ThemeIcon><Text fw={800}>Family Skylight</Text></Group></Group></AppShell.Header>
      <AppShell.Navbar p={menuCollapsed ? 'xs' : 'md'}>
        {menuCollapsed ? <Stack align="center" gap="md" mb="xl"><ThemeIcon size="lg" radius="xl"><IconCalendarMonth /></ThemeIcon><ActionIcon variant="light" size="lg" onClick={() => setMenuCollapsed(false)} aria-label="Expand menu"><IconChevronRight size={20} /></ActionIcon></Stack> : <Group justify="space-between" mb="xl" wrap="nowrap"><Group gap="xs" wrap="nowrap"><ThemeIcon size="lg" radius="xl"><IconCalendarMonth /></ThemeIcon><Text fw={800}>Family Skylight</Text></Group><ActionIcon variant="subtle" onClick={() => setMenuCollapsed(true)} aria-label="Collapse menu"><IconChevronLeft size={20} /></ActionIcon></Group>}
        <Stack gap="xs" align={menuCollapsed ? 'center' : 'stretch'}>{navigation.map(item => menuCollapsed ? <Tooltip key={item.key} label={item.label} position="right"><ActionIcon size={44} variant={page === item.key ? 'light' : 'subtle'} color={page === item.key ? 'blue' : 'gray'} onClick={() => { setPage(item.key); setMobileMenuOpened(false); }} aria-label={item.label}><item.icon size={22} /></ActionIcon></Tooltip> : <NavLink key={item.key} active={page === item.key} label={item.label} leftSection={<item.icon size={20} />} onClick={() => { setPage(item.key); setMobileMenuOpened(false); }} />)}</Stack>
        <Box mt="auto">{menuCollapsed ? <Tooltip label={settings.theme === 'dark' ? 'Light theme' : 'Dark theme'} position="right"><ActionIcon size={44} variant="subtle" onClick={() => void toggleTheme()} aria-label={settings.theme === 'dark' ? 'Light theme' : 'Dark theme'}>{settings.theme === 'dark' ? <IconSun size={20} /> : <IconMoon size={20} />}</ActionIcon></Tooltip> : <Button fullWidth variant="subtle" leftSection={settings.theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />} onClick={() => void toggleTheme()}>{settings.theme === 'dark' ? 'Light theme' : 'Dark theme'}</Button>}</Box>
      </AppShell.Navbar>
      <AppShell.Main><Container size="xl" py="md">{pages[page]}</Container></AppShell.Main>
    </AppShell>
    <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
  </MantineProvider>;
}

document.getElementById('root')!.replaceChildren();
import('react-dom/client').then(({ createRoot }) => createRoot(document.getElementById('root')!).render(<App />));
