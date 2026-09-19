# Family Skylight contributor guide

## Stack and commands

- TypeScript, React, Mantine, Fastify, SQLite, and `ical.js`.
- Use `npm run dev` for local development, `npm test` for the iCal parser tests, and `npm run build` before handoff.
- Keep the production API lightweight for Raspberry Pi 3 deployment; avoid adding background services or heavy runtime dependencies without a clear need.

## Calendar integration

- Google Calendar secret iCal feeds are the source of truth. Family Skylight is read-only for calendar events.
- Never log, return, or display a saved secret iCal URL. Encrypt it before SQLite storage using `SKYLIGHT_ENCRYPTION_KEY`.
- Recurring occurrences are generated at sync time from the first Pacific day of the month six calendar months ago through 12 calendar months ahead. Preserve `RRULE`, `RDATE`, `EXDATE`, overrides, cancellations, and Pacific-time/DST behavior.
- Keep sync failures non-destructive: retain the last successful event cache and expose the source error.

## Product conventions

- Display event times in `America/Los_Angeles`; the visible abbreviation may be PST or PDT depending on daylight saving time.
- Maintain touch-friendly controls and desktop pointer support.
- Use the existing API client helper for JSON requests; do not set `Content-Type` for bodyless requests.
- Success actions should update quietly; reserve toast notifications for failures that need attention.

## Data and verification

- Use migrations guarded by `PRAGMA table_info` for SQLite schema additions so existing local databases remain usable.
- Add or update focused tests whenever iCal parsing, recurrence behavior, or cache semantics change.
- Do not commit generated `data/`, `dist/`, `node_modules/`, or `.env` files.
