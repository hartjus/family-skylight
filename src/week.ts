function pacificMidnight(year: number, month: number, day: number) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day));
  const offsetName = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'longOffset' }).formatToParts(utcGuess).find(item => item.type === 'timeZoneName')?.value ?? 'GMT-08:00';
  const offset = offsetName.match(/GMT([+-])(\d{2}):(\d{2})/);
  const minutes = offset ? (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === '+' ? 1 : -1) : -480;
  return new Date(utcGuess.getTime() - minutes * 60_000);
}

export function pacificWeekWindowForDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('start must be a YYYY-MM-DD date');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) throw new Error('start must be a valid calendar date');
  const end = new Date(date);
  end.setUTCDate(date.getUTCDate() + 7);
  return {
    start: pacificMidnight(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()),
    end: pacificMidnight(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate()),
  };
}
