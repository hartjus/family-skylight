export const beaverSports = [
  { path: 'football/college-football', label: 'Football', teamId: '204' },
  { path: 'baseball/college-baseball', label: 'Baseball', teamId: '113' },
  { path: 'basketball/mens-college-basketball', label: 'Men’s basketball', teamId: '204' },
  { path: 'basketball/womens-college-basketball', label: 'Women’s basketball', teamId: '204' },
] as const;
export type BeaverTeam = { id: string; name: string; score: string; logo?: string };
export type BeaverGame = {
  id: string; sport: string; teams: BeaverTeam[]; status: string; completed: boolean;
  updatedAt: number; expiresAt: number; finishedAt?: number; link: string;
};
type Status = { displayClock?: string; period?: number; type?: { name?: string; state?: string; completed?: boolean; detail?: string; shortDetail?: string } };
type Competitor = { team?: { id?: string; displayName?: string; abbreviation?: string; logo?: string; logos?: { href: string }[] }; score?: string | number | { displayValue?: string; value?: number } };
export type ESPNEvent = { id: string; date: string; competitions?: { status?: Status; competitors?: Competitor[] }[] };
type TrackedGame = { event: ESPNEvent; checkedAt: number; done: boolean };
export type BeaverCache = Record<string, { checkedAt: number; games: BeaverGame[]; scheduleDate?: string; tracked?: TrackedGame[] }>;
const TWO_HOURS = 2 * 60 * 60_000;
export const GAME_REFRESH_MS = 5 * 60_000;
const LIVE_LEASE = GAME_REFRESH_MS + 60_000;

export function gameStatus(status: Status, sport: string) {
  const type = status.type;
  if (type?.completed) return type.shortDetail || 'Final';
  if (type?.name !== 'STATUS_IN_PROGRESS') return type?.detail || type?.shortDetail || 'In progress';
  if (sport === 'Baseball') return type.detail || type.shortDetail || `Inning ${status.period ?? ''}`;
  const period = status.period ?? 0;
  const regulation = sport === 'Men’s basketball' ? 2 : 4;
  const phase = period > regulation ? `OT${period - regulation > 1 ? ` ${period - regulation}` : ''}`
    : sport === 'Men’s basketball' ? `${period === 1 ? '1st' : '2nd'} half` : `Q${period}`;
  return [phase, status.displayClock && `${status.displayClock} remaining`].filter(Boolean).join(' · ');
}

// Only explicit end-of-game plays count; a scoring play or data modification time is not a finish time.
export function completionTime(summary: unknown): number | undefined {
  const times: number[] = [];
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, any>;
    if (typeof row.wallclock === 'string' && /end of (game|match)|game (over|ended)/i.test(`${row.type?.text ?? ''} ${row.text ?? ''}`)) {
      const time = Date.parse(row.wallclock);
      if (Number.isFinite(time)) times.push(time);
    }
    for (const child of Object.values(row)) if (child && typeof child === 'object') visit(child);
  }
  visit(summary);
  return times.length ? Math.max(...times) : undefined;
}

export function normalizeGame(event: ESPNEvent, sport: typeof beaverSports[number], now: number, previous?: BeaverGame, endedAt?: number): BeaverGame | undefined {
  const competition = event.competitions?.[0];
  const status = competition?.status;
  const type = status?.type;
  const competitors = competition?.competitors ?? [];
  if (!competitors.some((entry) => String(entry.team?.id) === sport.teamId) || competitors.length !== 2 || !status) return;
  const completed = type?.completed === true && type.state === 'post' && /FINAL|FULL_TIME|END_OF_GAME/.test(type.name ?? '');
  const live = type?.state === 'in' && !/POSTPONED|CANCELED|CANCELLED|SUSPENDED|DELAYED/.test(type.name ?? '');
  if (!completed && !live) return;
  const finishedAt = completed ? previous?.finishedAt ?? endedAt ??
    (previous && !previous.completed && now - previous.updatedAt <= LIVE_LEASE ? now : undefined) : undefined;
  // Do not give an old final a new two-hour window just because the dashboard was opened.
  if (completed && (finishedAt === undefined || finishedAt > now || now >= finishedAt + TWO_HOURS)) return;
  return {
    id: `${sport.path}:${event.id}`, sport: sport.label, completed,
    teams: competitors.map(({ team, score }) => ({
      id: String(team?.id), name: team?.displayName || team?.abbreviation || 'Team',
      score: typeof score === 'object' ? String(score.displayValue ?? score.value ?? '—') : String(score ?? '—'),
      logo: [team?.logo, team?.logos?.[0]?.href].find((url) => url?.startsWith('https://')),
    })),
    status: gameStatus(status, sport.label), updatedAt: now,
    expiresAt: completed ? finishedAt! + TWO_HOURS : now + LIVE_LEASE,
    finishedAt, link: `https://www.espn.com/${sport.path.split('/')[1]}/game/_/gameId/${encodeURIComponent(event.id)}`,
  };
}

function pacificDay(now: number) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function sixAm(day: string) {
  const candidate = Date.parse(`${day}T14:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23',
  }).format(candidate));
  return candidate - (hour - 6) * 60 * 60_000;
}
export function nextScheduleCheck(now: number) {
  const day = pacificDay(now);
  if (now < sixAm(day)) return sixAm(day);
  const tomorrow = new Date(Date.parse(`${day}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
  return sixAm(tomorrow);
}

export function createBeaversService(read: () => BeaverCache, write: (cache: BeaverCache) => void, fetcher: typeof fetch = fetch, clock = Date.now) {
  let pending: Promise<void> | undefined;
  async function json(url: string) {
    const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Sports feed unavailable');
    return response.json();
  }
  async function refresh() {
    const cache = read();
    const now = clock();
    const day = pacificDay(now);
    let changed = false;
    await Promise.all(beaverSports.map(async (sport) => {
      const entry = cache[sport.path] ?? { checkedAt: 0, games: [] };
      cache[sport.path] = entry;
      if (now >= sixAm(day) && entry.scheduleDate !== day) {
        // Persist the attempt even on failure: schedule discovery runs once per Pacific day.
        entry.scheduleDate = day;
        changed = true;
        try {
          const schedule = await json(`https://site.api.espn.com/apis/site/v2/sports/${sport.path}/teams/${sport.teamId}/schedule`);
          if (!Array.isArray(schedule.events)) throw new Error('Invalid sports feed');
          const tracked = new Map((entry.tracked ?? []).filter((game) =>
            !game.done && Date.parse(game.event.date) >= now - 36 * 60 * 60_000,
          ).map((game) => [game.event.id, game]));
          for (const event of schedule.events as ESPNEvent[]) {
            if (Number.isFinite(Date.parse(event.date)) && pacificDay(Date.parse(event.date)) === day) {
              if (!tracked.has(event.id)) tracked.set(event.id, { event, checkedAt: 0, done: false });
            }
          }
          entry.tracked = [...tracked.values()];
        } catch { /* Keep known games without retrying today's schedule discovery. */ }
      }
      const games = new Map(entry.games.map((game) => [game.id, game]));
      await Promise.all((entry.tracked ?? []).map(async (tracked) => {
        const start = Date.parse(tracked.event.date);
        if (tracked.done || now < start || now - tracked.checkedAt < GAME_REFRESH_MS) return;
        changed = true;
        if (start < now - 36 * 60 * 60_000) { tracked.done = true; return; }
        tracked.checkedAt = now;
        try {
          const summary = await json(`https://site.api.espn.com/apis/site/v2/sports/${sport.path}/summary?event=${encodeURIComponent(tracked.event.id)}`);
          const competition = summary.header?.competitions?.[0];
          if (!competition?.status?.type || !Array.isArray(competition.competitors)) throw new Error('Invalid game details');
          const event: ESPNEvent = { ...tracked.event, competitions: [competition] };
          const id = `${sport.path}:${event.id}`;
          const game = normalizeGame(event, sport, now, games.get(id), completionTime(summary));
          if (game) games.set(id, game); else games.delete(id);
          tracked.done = competition.status.type.completed === true || /CANCELED|CANCELLED|POSTPONED/.test(competition.status.type.name ?? '');
        } catch { /* A short-lived saved score may be used until the next five-minute update. */ }
      }));
      entry.games = [...games.values()].filter((game) => now < game.expiresAt);
      entry.checkedAt = now;
    }));
    if (changed) write(cache);
  }
  return async () => {
    if (!pending) pending = refresh().finally(() => { pending = undefined; });
    await pending;
    const now = clock();
    const entries = Object.values(read());
    const due = entries.flatMap((entry) => (entry.tracked ?? []).filter((game) => !game.done).map((game) =>
      Math.max(Date.parse(game.event.date), game.checkedAt + GAME_REFRESH_MS),
    ));
    return {
      games: entries.flatMap((entry) => entry.games).filter((game) => now < game.expiresAt),
      nextCheckAt: Math.max(now + 1000, Math.min(nextScheduleCheck(now), ...due)),
    };
  };
}
